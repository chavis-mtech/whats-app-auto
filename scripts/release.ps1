param([string]$Version='1.0.3')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $root
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$releaseRoot=Join-Path $root 'release'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$stage=Join-Path $releaseRoot "WhatsAppAuto-$Version-win-x64"
if (Test-Path -LiteralPath $stage) { throw "Stage already exists; move it aside before rebuilding: $stage" }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($name in @('src','public','docs','test','scripts','package.json','package-lock.json','README.md','THIRD-PARTY-NOTICES.md','Start.cmd','Stop.cmd','Status.cmd','Install-Background.cmd','Uninstall-Background.cmd')) {
  if ($name -eq 'scripts') { New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') | Out-Null; foreach($scriptName in @('manage.ps1','build.mjs','release.ps1','SHASUMS256.txt')) {Copy-Item -LiteralPath (Join-Path $root "scripts/$scriptName") -Destination (Join-Path $stage "scripts/$scriptName")} }
  else { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage -Recurse }
}
# Install only locked runtime dependencies into the clean release, never copy a working data folder.
Push-Location $stage
try { & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency installation failed.' } } finally { Pop-Location }
$runtimeVersion='24.20.0'
$nodeArchive=Join-Path $PSScriptRoot "node-v$runtimeVersion-win-x64.zip"
$expected='6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
if (-not (Test-Path -LiteralPath $nodeArchive)) { Invoke-WebRequest -Uri "https://nodejs.org/dist/v$runtimeVersion/node-v$runtimeVersion-win-x64.zip" -OutFile $nodeArchive }
if ((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Official Node ZIP SHA256 mismatch.' }
$extraction=Join-Path $releaseRoot "node-v$runtimeVersion-verified"
if (-not (Test-Path -LiteralPath $extraction)) { Expand-Archive -LiteralPath $nodeArchive -DestinationPath $extraction }
$official=Join-Path $extraction "node-v$runtimeVersion-win-x64"
New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') | Out-Null
Copy-Item -LiteralPath (Join-Path $official 'node.exe') -Destination (Join-Path $stage 'runtime/node.exe')
Copy-Item -LiteralPath (Join-Path $official 'LICENSE') -Destination (Join-Path $stage 'runtime/NODE-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'SHASUMS256.txt') -Destination (Join-Path $stage 'runtime/OFFICIAL-SHASUMS256.txt')
$forbidden=Get-ChildItem -LiteralPath $stage -Force | Where-Object { $_.Name -in @('data','auth','.env','state.json','launcher.json','instance.lock','AGENTS.md') }
if ($forbidden) { throw 'Forbidden private artifact in release.' }
$manifest=Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
  [PSCustomObject]@{path=$_.FullName.Substring($stage.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
@{version=$Version;platform='win-x64';node=$runtimeVersion;officialNodeZipSHA256=$expected;files=$manifest} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'MANIFEST.json') -Encoding UTF8
$zip=Join-Path $releaseRoot "WhatsAppAuto-$Version-win-x64.zip"
if (Test-Path -LiteralPath $zip) { throw 'Release ZIP already exists.' }
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII
Write-Output "Portable release ready: $zip"
