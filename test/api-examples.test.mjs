import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedExampleTargets,exampleSelectionScope,createApiExamples} from '../public/api-examples.js';
const contact='66800000001@s.whatsapp.net',group='120363000000001@g.us';
const state={provider:{mode:'live'},targets:[{jid:contact,name:"A 'quoted' <contact>",mode:'live'},{jid:group,name:'Group',mode:'live'},{jid:'66800000002@s.whatsapp.net',name:'Demo only',mode:'demo'}]};
test('API example defaults prompt target/text and masked token without embedding secrets or a recipient',()=>{
  const example=createApiExamples({origin:'http://127.0.0.1:4327',state});
  assert.match(example.powershell,/\$target = Read-Host 'Recipient JID'/);assert.match(example.powershell,/Read-Host 'API token' -AsSecureString/);assert.match(example.powershell,/\[Net.NetworkCredential\]::new/);assert.match(example.powershell,/UTF8.GetBytes\(\$body\)/);
  assert(!example.powershell.includes(contact));assert(!example.powershell.includes(group));assert.deepEqual(JSON.parse(example.json),{target:'<recipient-jid>',text:'ทดสอบ API จาก WhatsApp Auto'});assert(example.http.startsWith('POST http://127.0.0.1:4327/api/send\n'));assert(example.http.includes('Authorization: Bearer <token>'));assert(example.http.includes('Idempotency-Key: <unique-key-keep-for-retry>'));
});
test('selected contact/group examples use only validated current-mode allowlisted JIDs and never recipient names',()=>{
  for(const target of [contact,group]){const example=createApiExamples({origin:'http://127.0.0.1:4318',state,target});assert(example.powershell.includes(`$target = '${target}'`));assert.equal(JSON.parse(example.json).target,target);assert(!example.powershell.includes('quoted'));assert(!example.http.includes('<contact>'));}
  assert.throws(()=>createApiExamples({origin:'http://127.0.0.1:4318',state,target:'66800000002@s.whatsapp.net'}));assert.throws(()=>createApiExamples({origin:'http://127.0.0.1:4318',state,target:"';throw 'injected'"}));
  assert.equal(allowedExampleTargets({...state,targets:[...state.targets,{mode:'live',jid:"';throw 'injected'",name:'bad'}]}).length,2);
});
test('origin validation and selection scope prevent foreign code destinations and stale mode/allowlist selection',()=>{
  for(const origin of ['https://example.com','http://localhost:4318','http://127.0.0.1:4318/path','http://127.0.0.1:4318?x=1','http://user@127.0.0.1:4318'])assert.throws(()=>createApiExamples({origin,state}));
  const scope=exampleSelectionScope(state);assert.notEqual(scope,exampleSelectionScope({...state,provider:{mode:'demo'}}));assert.notEqual(scope,exampleSelectionScope({...state,targets:state.targets.slice(1)}));assert.equal(scope,exampleSelectionScope({...state,targets:[...state.targets].reverse()}));
});
