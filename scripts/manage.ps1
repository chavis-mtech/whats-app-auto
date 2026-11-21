param(
  [ValidateSet('Start','Stop','Status','Install','Uninstall')][string]$Action='Start',
  [switch]$NoBrowser,
  [string]$DataDirectory=$env:WAA_DATA_DIR,
  [int]$Port=4318
)
$ErrorActionPreference='Stop'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $DataDirectory) { $DataDirectory=Join-Path $env:LOCALAPPDATA 'WhatsAppAuto' }
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be 1024-65535.' }
$nodePath=Join-Path $appRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath=(Get-Command node.exe -ErrorAction Stop).Source }
$nodePath=[IO.Path]::GetFullPath($nodePath)
$serverPath=Join-Path $appRoot 'src/server.mjs'
$pidFile=Join-Path $DataDirectory 'launcher.json'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$accountName=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$sha=[Security.Cryptography.SHA256]::Create()
$identity=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("$sid|$DataDirectory")))).Replace('-','').Substring(0,12)
$taskName="WhatsAppAuto-$identity"
$mutex=New-Object Threading.Mutex($false,"Local\WhatsAppAuto-$identity")
if (-not $mutex.WaitOne(15000)) { throw 'Another launcher action is in progress. Try again.' }
function Get-OwnedProcess {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $record=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $candidate=Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)"
  if (-not $candidate) { return $null }
  $expectedScript='"'+$serverPath+'"'
  if ($candidate.ExecutablePath -ne $nodePath -or -not $candidate.CommandLine.Contains($expectedScript)) { throw 'PID ownership could not be verified. No process was stopped.' }
  return $candidate
}
try {
  if ($Action -eq 'Install') {
    $script=Join-Path $PSScriptRoot 'manage.ps1'
    $arguments="-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Action Start -NoBrowser -Port $Port -DataDirectory `"$DataDirectory`""
    $taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $appRoot
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $accountName
    $principal=New-ScheduledTaskPrincipal -UserId $accountName -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts local WhatsApp Auto at sign-in. Only a user-enabled confirmed linked session can auto-resume; no unattended pairing.' -Force -ErrorAction Stop | Out-Null
    if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop)) { throw 'The scheduled task was not created.' }
    Write-Output 'Background startup installed for the current Windows user. Start.cmd opens it now.'
    return
  }
  if ($Action -eq 'Uninstall') {
    $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Write-Output 'Background startup removed. Your data is retained. Use Stop.cmd to stop a running app.'
    return
  }
  $process=Get-OwnedProcess
  if ($Action -eq 'Status') { if ($process) { Write-Output "Running: process $($process.ProcessId)" } else { Write-Output 'Stopped.' }; return }
  if ($Action -eq 'Stop') {
    if ($process) { Stop-Process -Id $process.ProcessId -ErrorAction Stop; Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile }
    Write-Output 'Application stopped. Persistent data was retained. Interrupted sends are marked unknown on next start.'
    return
  }
  if ($process) {
    $record=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$($record.port)" }
    Write-Output "Already running: http://127.0.0.1:$($record.port)"
    return
  }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is already occupied. The existing service was not changed." }
  New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
  & icacls.exe $DataDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Private data folder permissions could not be applied.' }
  $previousDirectory=$env:WAA_DATA_DIR;$previousPort=$env:WAA_PORT
  try {
    $env:WAA_DATA_DIR=$DataDirectory;$env:WAA_PORT=[string]$Port
    $process=Start-Process -FilePath $nodePath -ArgumentList @('"'+$serverPath+'"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataDirectory 'startup.log') -RedirectStandardError (Join-Path $DataDirectory 'error.log') -PassThru
  } finally { $env:WAA_DATA_DIR=$previousDirectory;$env:WAA_PORT=$previousPort }
  @{pid=$process.Id;port=$Port;root=$appRoot} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
  $ready=$false
  for ($attempt=0;$attempt -lt 40;$attempt++) {
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) { throw 'Application exited. See the private error.log for the startup reason.' }
    try { $health=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 1; if ($health.app -eq 'whatsapp-auto') { $ready=$true;break } } catch {}
  }
  if (-not $ready) { throw 'Application did not become ready. Use Status.cmd and inspect the private startup/error logs.' }
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
  Write-Output "Ready: http://127.0.0.1:$Port"
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
