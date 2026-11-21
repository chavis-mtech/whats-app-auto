import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createApplication} from '../src/server.mjs';
import {createApiExamples} from '../public/api-examples.js';
const exec=promisify(execFile),contact='66800000001@s.whatsapp.net',group='120363000000001@g.us';
async function executeCopiedPowerShell(code,{directory,token,target,text}){
  const script=join(directory,'copied-example.ps1'),harness=join(directory,'execute-example.ps1');
  const literal=value=>"'"+value.replaceAll("'","''")+"'",base64=value=>Buffer.from(value,'utf8').toString('base64');
  await writeFile(script,'\ufeff'+code,'utf8');
  await writeFile(harness,'\ufeff'+`$ErrorActionPreference='Stop'
function Read-Host {
  param([string]$Prompt,[switch]$AsSecureString)
  if ($Prompt -eq 'API token') { return ConvertTo-SecureString ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(token)}'))) -AsPlainText -Force }
  if ($Prompt -eq 'Recipient JID') { return ${literal(target)} }
  if ($Prompt -eq 'Message text (Thai supported)') { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(text)}')) }
  throw 'Unexpected prompt.'
}
$first = . ${literal(script)}
if ($first.status -ne 'simulated') { throw 'Copied request did not simulate.' }
$repeat = Invoke-RestMethod @request
if ($repeat.id -ne $first.id) { throw 'Same-key retry returned another receipt.' }
Write-Output 'Copied PowerShell and same-key retry passed.'
`,'utf8');
  // Let native Windows PowerShell construct its own module path instead of inheriting the parent's PowerShell Core modules.
  const childEnvironment={...process.env};delete childEnvironment.PSModulePath;
  const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',harness],{timeout:20000,windowsHide:true,env:childEnvironment});assert.match(result.stdout,/Copied PowerShell and same-key retry passed/);
}
test('API page copies exact prompted/selected examples, executes copied PowerShell and HTTP in isolated demo, and resets stale selections',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'waa-api-ui-')),app=await createApplication({directory,port:0}),browser=await chromium.launch({headless:true});const origin=`http://127.0.0.1:${app.port}`;const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(origin);await page.getByLabel('สร้างรหัสผ่าน').fill('synthetic-ui-api-password');await page.getByLabel('ยืนยันรหัสผ่าน').fill('synthetic-ui-api-password');await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน',exact:true}).click();await page.getByRole('button',{name:'เชื่อมต่อ API',exact:true}).click();
    await page.getByText('ยังไม่มีผู้รับที่อนุญาต ไปที่ “ผู้ติดต่อและกลุ่ม” เพื่อเพิ่มผู้รับก่อนทดสอบส่ง',{exact:true}).waitFor();assert.equal(await page.locator('#api-target').inputValue(),'');
    const defaultExamples=createApiExamples({origin,state:{provider:{mode:'demo'},targets:[]}});assert.equal(await page.locator('#api-powershell').textContent(),defaultExamples.powershell);assert.equal(await page.locator('#api-json').textContent(),defaultExamples.json);
    await page.getByRole('button',{name:'คัดลอก PowerShell',exact:true}).click();const copiedDefault=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(copiedDefault.replaceAll('\r\n','\n'),defaultExamples.powershell);assert.equal(app.store.state.runs.length,0);assert(!(await page.locator('#content').textContent()).includes(app.store.state.token));
    await app.provider.connect();app.store.state.targets.push({jid:contact,name:'Contact <img src=x onerror=alert(1)>',mode:'demo'},{jid:group,name:'ทีมตัวอย่าง API',mode:'demo'},{jid:'66800000002@s.whatsapp.net',name:'Live only',mode:'live'});await app.store.save();await page.waitForFunction(()=>document.querySelector('#api-target')?.options.length===3);assert.equal(await page.locator('#api-target').inputValue(),'');assert.equal(await page.locator('#api-target').textContent().then(text=>text.includes('Live only')),false);assert.equal(await page.locator('#content img').count(),0);
    const defaultText='ข้อความไทย default: “ปลอดภัย” $(throw \'injected\')';await executeCopiedPowerShell(copiedDefault,{directory,token:app.store.state.token,target:contact,text:defaultText});assert.equal(app.store.state.runs.length,1);assert(app.store.state.messages.some(message=>message.text===defaultText));
    await page.locator('#api-target').selectOption(contact);assert.equal(await page.locator('#api-powershell').textContent(),createApiExamples({origin,state:{provider:{mode:'demo'},targets:app.store.state.targets},target:contact}).powershell);
    await page.locator('#api-target').selectOption(group);const selected=createApiExamples({origin,state:{provider:{mode:'demo'},targets:app.store.state.targets},target:group});for(const [label,key] of [['คัดลอก PowerShell','powershell'],['คัดลอก HTTP','http'],['คัดลอก JSON','json']]){await page.getByRole('button',{name:label,exact:true}).click();assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replaceAll('\r\n','\n'),selected[key]);}
    assert.equal(app.store.state.runs.length,1);const groupText='ข้อความไทย group: hello "quoted" ` $value';await executeCopiedPowerShell(selected.powershell,{directory,token:app.store.state.token,target:contact,text:groupText});assert.equal(app.store.state.runs.length,2);assert.equal(app.store.state.runs[0].target,group);assert(app.store.state.messages.some(message=>message.text===groupText));
    const [head,payload]=selected.http.split('\n\n');assert.equal(head.split('\n')[0],`POST ${origin}/api/send`);assert.deepEqual(JSON.parse(payload),JSON.parse(selected.json));const headers={authorization:'Bearer '+app.store.state.token,'content-type':'application/json; charset=utf-8','idempotency-key':randomUUID()};const response=await fetch(origin+'/api/send',{method:'POST',headers,body:payload});assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.status,'simulated');const repeat=await fetch(origin+'/api/send',{method:'POST',headers,body:payload});assert.equal((await repeat.json()).id,receipt.id);assert.equal(app.store.state.runs.length,3);assert(app.store.state.messages.some(message=>message.text==='ทดสอบ API จาก WhatsApp Auto'));
    await page.evaluate(()=>document.querySelector('#toast').style.display='none');await mkdir(resolve('docs/screenshots'),{recursive:true});await page.screenshot({path:resolve('docs/screenshots/api.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    app.store.state.targets=app.store.state.targets.filter(target=>target.jid!==group);await app.store.save();await page.waitForFunction(()=>document.querySelector('#api-target')?.value===''&&document.querySelector('#api-target')?.options.length===2);assert.match(await page.locator('#api-powershell').textContent(),/\$target = Read-Host 'Recipient JID'/);
    app.provider.disconnect();app.store.state.settings.mode='live';await app.store.save();await page.waitForFunction(()=>document.querySelector('#api-target')?.textContent.includes('Live only'));assert.equal(await page.locator('#api-target').inputValue(),'');assert.equal(app.provider.active,false);assert.deepEqual(errors,[]);
  }finally{await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
});
