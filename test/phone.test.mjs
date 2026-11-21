import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {normalizeExpectedPhone,verifiedIdentityPhone} from '../src/phone.mjs';
import {openStore} from '../src/store.mjs';
import {WhatsAppProvider} from '../src/provider.mjs';
import {createApplication} from '../src/server.mjs';
const local='0912345678',phone='66912345678';
const settle=async store=>{await store.save();await new Promise(resolve=>setImmediate(resolve));};
function fakeBaileys(identity,credentials={registered:true,me:{id:phone+':2@s.whatsapp.net'}}){const tracker={sockets:[],loads:0};tracker.load=async()=>{tracker.loads++;return {default:()=>{const socket={ev:new EventEmitter(),user:identity,end(){this.ended=true;},async groupFetchAllParticipating(){return {};}};tracker.sockets.push(socket);return socket;},useMultiFileAuthState:async()=>({state:{creds:credentials},saveCreds:async()=>{}}),DisconnectReason:{loggedOut:401},jidNormalizedUser:id=>id.replace(/:\d+(?=@)/,''),normalizeMessageContent:x=>x};};return tracker;}
test('phone settings canonicalize only documented Thai mobile forms and preserve other international numbers',()=>{
  for(const input of [local,phone,'+'+phone,'  +66 (91) 234-5678  '])assert.equal(normalizeExpectedPhone(input),phone);
  assert.equal(normalizeExpectedPhone('0812345678'),'66812345678');assert.equal(normalizeExpectedPhone('0612345678'),'66612345678');
  for(const input of ['14155550100','447700900123','919876543210'])assert.equal(normalizeExpectedPhone(input),input);
  assert.equal(normalizeExpectedPhone('',{allowEmpty:true}),'');
  for(const input of ['+0912345678','0712345678','0066912345678','660912345678','091234567','09123456789','66912345678@s.whatsapp.net','+66+912345678','66912345678 ext2'])assert.throws(()=>normalizeExpectedPhone(input));
});
test('account identity uses exact international PN fields and never treats raw LID digits as a phone',()=>{
  assert.equal(verifiedIdentityPhone({id:phone+':19@s.whatsapp.net'}),phone);assert.equal(verifiedIdentityPhone({id:phone+'@c.us'}),phone);
  assert.equal(verifiedIdentityPhone({id:phone+'@lid'}),'');assert.equal(verifiedIdentityPhone({id:phone+':3@lid'}),'');
  assert.equal(verifiedIdentityPhone({id:'12345678912345@lid',phoneNumber:phone+'@s.whatsapp.net'}),phone);
  for(const identity of [{id:local+'@s.whatsapp.net'},{id:phone+'@g.us'},{phoneNumber:phone+'@s.whatsapp.net'},{id:phone+'@s.whatsapp.net',phoneNumber:'66899999999@s.whatsapp.net'},{id:phone+'@lid',phoneNumber:phone}])assert.equal(verifiedIdentityPhone(identity),'');
});
test('manual same-account connection accepts Thai settings plus PN device JID and rejects different or unverified identities',async()=>{
  for(const identity of [{id:phone+':9@s.whatsapp.net'},{id:'12345678912345@lid',phoneNumber:phone+'@s.whatsapp.net'},{id:'66899999999@s.whatsapp.net'},{id:phone+'@lid'}]){
    const directory=await mkdtemp(join(tmpdir(),'waa-phone-manual-'));const store=await openStore(directory);Object.assign(store.state.settings,{mode:'live',expectedPhone:local});const mock=fakeBaileys(identity),provider=new WhatsAppProvider(store,directory,{loadBaileys:mock.load});
    try{await provider.connect();mock.sockets[0].ev.emit('connection.update',{connection:'open'});await settle(store);const accepted=identity.id.endsWith('@s.whatsapp.net')&&identity.id.startsWith(phone)||!!identity.phoneNumber;assert.equal(provider.status,accepted?'connected':'disconnected');assert.equal(store.state.settings.expectedPhone,phone);assert.equal(store.state.confirmedAccount,accepted?phone:'');if(!accepted){assert.equal(provider.ready(),false);assert.match(provider.lastError,/ยังไม่ต้องลบเซสชัน/);}provider.disconnect();}finally{await store.close();await rm(directory,{recursive:true,force:true});}
  }
});
test('legacy local expected settings migrate without touching auth and resume only with exact previously confirmed PN',async()=>{
  for(const confirmed of [phone,local,'']){
    const directory=await mkdtemp(join(tmpdir(),'waa-phone-persisted-'));let store=await openStore(directory);Object.assign(store.state.settings,{mode:'live',expectedPhone:local,autoResume:true});store.state.confirmedAccount=confirmed;await store.save();await store.close();await mkdir(join(directory,'auth'));const credentials={registered:true,me:{id:phone+':7@s.whatsapp.net'}};const serialized=JSON.stringify(credentials);await writeFile(join(directory,'auth','creds.json'),serialized);store=await openStore(directory);const mock=fakeBaileys({id:phone+'@s.whatsapp.net'},credentials),provider=new WhatsAppProvider(store,directory,{loadBaileys:mock.load});
    try{assert.equal(store.state.settings.expectedPhone,phone);assert.equal(await readFile(join(directory,'auth','creds.json'),'utf8'),serialized);await provider.resumeOnStartup();assert.equal(mock.sockets.length,confirmed===phone?1:0);if(confirmed===phone){mock.sockets[0].ev.emit('connection.update',{connection:'open'});await settle(store);assert.equal(provider.status,'connected');}else{assert.equal(store.state.settings.autoResume,false);assert.equal(provider.ready(),false);}provider.disconnect();}finally{await store.close();await rm(directory,{recursive:true,force:true});}
  }
});
test('settings API stores canonical phone and equivalent spelling does not invalidate a valid confirmed session',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'waa-phone-api-'));const mock=fakeBaileys({id:phone+'@s.whatsapp.net'});const app=await createApplication({directory,port:0,providerFactory:(store,d)=>new WhatsAppProvider(store,d,{loadBaileys:mock.load})});
  const put=async expectedPhone=>fetch(`http://127.0.0.1:${app.port}/api/settings`,{method:'PUT',headers:{authorization:'Bearer '+app.store.state.token,'content-type':'application/json'},body:JSON.stringify({mode:'live',expectedPhone,autoResume:false,timezone:'Asia/Bangkok',retention:500,allowedHosts:[]})});
  try{assert.equal((await put(local)).status,200);assert.equal(app.store.state.settings.expectedPhone,phone);await app.provider.connect();mock.sockets[0].ev.emit('connection.update',{connection:'open'});await settle(app.store);assert.equal((await put('+'+phone)).status,200);assert.equal(app.provider.status,'connected');assert.equal(app.store.state.confirmedAccount,phone);assert.equal(mock.sockets.length,1);assert.equal((await put('0712345678')).status,400);assert.equal(app.provider.status,'connected');}finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
