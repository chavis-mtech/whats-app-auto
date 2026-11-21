const validJid=value=>typeof value==='string'&&/^(?:[0-9]{6,20}@s\.whatsapp\.net|[0-9]{5,30}(?:-[0-9]{5,20})?@g\.us|[0-9]{5,30}@lid)$/.test(value);
export function allowedExampleTargets(state) {
  return (state?.targets||[]).filter(target=>target.mode===state?.provider?.mode&&validJid(target.jid));
}
export function exampleSelectionScope(state) {
  return JSON.stringify([state?.provider?.mode,allowedExampleTargets(state).map(target=>[target.jid,target.name]).sort((a,b)=>a[0].localeCompare(b[0]))]);
}
export function createApiExamples({origin,state,target=''}) {
  const url=new URL(origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\d+$/.test(url.port)||Number(url.port)<1||Number(url.port)>65535||url.origin!==origin)throw new Error('Examples require the current local application origin.');
  if(target&&!allowedExampleTargets(state).some(item=>item.jid===target))throw new Error('Select a recipient explicitly allowed in this mode.');
  const literal=value=>"'"+value.replaceAll("'","''")+"'";
  const endpoint=url.origin+'/api/send';
  const json=JSON.stringify({target:target||'<recipient-jid>',text:'ทดสอบ API จาก WhatsApp Auto'},null,2);
  const powershell=`$secureToken = Read-Host 'API token' -AsSecureString
$token = [Net.NetworkCredential]::new('', $secureToken).Password
$target = ${target?literal(target):"Read-Host 'Recipient JID'"}
$text = Read-Host 'Message text (Thai supported)'
$key = [guid]::NewGuid().ToString()
$body = @{ target=$target; text=$text } | ConvertTo-Json
$headers = @{ Authorization="Bearer $token"; 'Idempotency-Key'=$key }
$request = @{
  Uri=${literal(endpoint)}; Method='Post'; Headers=$headers
  ContentType='application/json; charset=utf-8'
  Body=[Text.Encoding]::UTF8.GetBytes($body)
}
Invoke-RestMethod @request`;
  const http=`POST ${endpoint}
Authorization: Bearer <token>
Idempotency-Key: <unique-key-keep-for-retry>
Content-Type: application/json; charset=utf-8

${json}`;
  return {powershell,http,json,endpoint};
}
