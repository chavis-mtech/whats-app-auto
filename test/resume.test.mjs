import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {openStore} from '../src/store.mjs';
import {WhatsAppProvider} from '../src/provider.mjs';
import {createApplication} from '../src/server.mjs';
const phone='66800000000';
const creds={registered:true,me:{id:phone+':12@s.whatsapp.net'}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function mockModule(auth=creds,user=phone) {
  const tracker={loads:0,sockets:[],sends:0};
  tracker.load=async()=>{tracker.loads++;return {
    default:()=>{const socket={ev:new EventEmitter(),user:{id:user+'@s.whatsapp.net'},ended:false,end(){this.ended=true;},async groupFetchAllParticipating(){return {};},async sendMessage(){tracker.sends++;return {key:{id:'offline-mock-message'}};}};tracker.sockets.push(socket);return socket;},
    useMultiFileAuthState:async()=>({state:{creds:auth},saveCreds:async()=>{}}),DisconnectReason:{loggedOut:401},jidNormalizedUser:id=>id.replace(/:\d+(?=@)/,''),normalizeMessageContent:x=>x
  };};return tracker;
}
async function fixture(options={}) {
  const directory=await mkdtemp(join(tmpdir(),'waa-resume-'));const store=await openStore(directory);
  Object.assign(store.state.settings,{mode:options.mode||'live',expectedPhone:phone,autoResume:options.enabled??true});store.state.confirmedAccount=options.confirmed??phone;
  if(options.file!==false){await mkdir(join(directory,'auth'));await writeFile(join(directory,'auth','creds.json'),JSON.stringify(options.creds||creds));}
  await store.save();return {directory,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test('startup auto-resume defaults off, and neither opted-out nor demo lifecycle loads a live adapter',async()=>{
  const plain=await mkdtemp(join(tmpdir(),'waa-default-'));const fresh=await openStore(plain);assert.equal(fresh.state.settings.autoResume,false);await fresh.close();await rm(plain,{recursive:true,force:true});
  for(const options of [{enabled:false},{mode:'demo'}]){const f=await fixture(options),mock=mockModule();try{const provider=new WhatsAppProvider(f.store,f.directory,{loadBaileys:mock.load});assert.equal((await provider.resumeOnStartup()).attempted,false);assert.equal(mock.loads,0);assert.equal(provider.active,false);}finally{await f.close();}}
});
test('unpaired, invalid, unconfirmed and mismatched saved sessions disable auto-resume before socket construction',async()=>{
  for(const options of [{file:false},{creds:{registered:false,me:creds.me}},{creds:{registered:true,me:{id:'66999999999@s.whatsapp.net'}}},{confirmed:''},{creds:{registered:true,me:{id:phone+'@lid'}}}]){
    const f=await fixture(options),mock=mockModule();try{const provider=new WhatsAppProvider(f.store,f.directory,{loadBaileys:mock.load});assert.equal((await provider.resumeOnStartup()).attempted,false);assert.equal(mock.loads,0);assert.equal(f.store.state.settings.autoResume,false);assert.equal(provider.qr,'');assert.equal(provider.status,'needs_pairing');}finally{await f.close();}
  }
});
test('session swap after preflight is blocked before a socket is created',async()=>{
  const f=await fixture(),mock=mockModule({registered:false});try{const provider=new WhatsAppProvider(f.store,f.directory,{loadBaileys:mock.load});await provider.resumeOnStartup();assert.equal(mock.loads,1);assert.equal(mock.sockets.length,0);assert.equal(provider.active,false);assert.equal(f.store.state.settings.autoResume,false);}finally{await f.close();}
});
test('unattended QR, logged-out state and wrong connected sender disable resume without exposing pairing',async()=>{
  for(const kind of ['qr','logout','wrong']){
    const f=await fixture(),mock=mockModule(creds,kind==='wrong'?'66999999999':phone);try{const provider=new WhatsAppProvider(f.store,f.directory,{loadBaileys:mock.load});await provider.resumeOnStartup();const socket=mock.sockets[0];socket.ev.emit('connection.update',kind==='qr'?{qr:'DO-NOT-EXPOSE'}:kind==='logout'?{connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}}:{connection:'open'});await f.store.save();await flush();assert.equal(f.store.state.settings.autoResume,false);assert.equal(provider.active,false);assert.equal(provider.qr,'');assert.equal(mock.sends,0);}finally{await f.close();}
  }
});
test('opted-in restart resumes the confirmed live session and due jobs through an entirely mocked provider',async()=>{
  const f=await fixture();f.store.state.targets.push({jid:'66800000001@s.whatsapp.net',name:'Approved mock only',mode:'live'});f.store.state.jobs.push({id:'resume-job',name:'Resume job',target:'66800000001@s.whatsapp.net',mode:'live',enabled:true,source:'text',template:'Offline mock only',schedule:'interval',minutes:60,nextAt:Date.now()-1000,cursor:0});await f.store.save();await f.store.close();
  const mock=mockModule();let app;
  try {
    app=await createApplication({directory:f.directory,port:0,providerFactory:(store,directory)=>new WhatsAppProvider(store,directory,{loadBaileys:mock.load})});assert.equal(mock.sockets.length,1);assert.equal(mock.sends,0);assert.equal(app.provider.status,'connecting');const due=app.store.state.jobs[0].nextAt;for(let index=0;index<10;index++)await app.jobs.tick();assert.equal(app.store.state.jobs[0].nextAt,due);assert.equal(app.store.state.jobs[0].enabled,true);assert.equal(app.store.state.jobs[0].failures,undefined);mock.sockets[0].ev.emit('connection.update',{connection:'open'});await app.store.save();await flush();assert.equal(app.provider.status,'connected');await app.jobs.tick();assert.equal(mock.sends,1);assert.equal(app.store.state.runs[0].status,'submitted');await app.close();
    app=await createApplication({directory:f.directory,port:0,providerFactory:(store,directory)=>new WhatsAppProvider(store,directory,{loadBaileys:mock.load})});assert.equal(mock.sockets.length,2);assert.equal(app.store.state.settings.autoResume,true);
    const response=await fetch(`http://127.0.0.1:${app.port}/api/disconnect`,{method:'POST',headers:{authorization:'Bearer '+app.store.state.token,'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);assert.equal(app.store.state.settings.autoResume,false);await app.close();
    app=await createApplication({directory:f.directory,port:0,providerFactory:(store,directory)=>new WhatsAppProvider(store,directory,{loadBaileys:mock.load})});assert.equal(mock.sockets.length,2);assert.equal(app.provider.status,'disconnected');
  } finally {if(app)await app.close();await rm(f.directory,{recursive:true,force:true});}
});
test('settings cannot opt in before confirmed live connection, and session reset clears opt-in and confirmation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'waa-resume-api-'));const mock=mockModule();const app=await createApplication({directory,port:0,providerFactory:(store,d)=>new WhatsAppProvider(store,d,{loadBaileys:mock.load})});
  const request=async(path,method,data)=>fetch(`http://127.0.0.1:${app.port}/api${path}`,{method,headers:{authorization:'Bearer '+app.store.state.token,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
  try{
    const settings={mode:'live',expectedPhone:phone,autoResume:false,timezone:'Asia/Bangkok',retention:500,allowedHosts:[]};assert.equal((await request('/settings','PUT',settings)).status,200);assert.equal((await request('/settings','PUT',{...settings,autoResume:true})).status,409);
    await app.provider.connect();mock.sockets[0].ev.emit('connection.update',{connection:'open'});await app.store.save();await flush();assert.equal((await request('/settings','PUT',{...settings,autoResume:true})).status,200);assert.equal(app.store.state.settings.autoResume,true);
    assert.equal((await request('/session','DELETE')).status,200);assert.equal(app.store.state.settings.autoResume,false);assert.equal(app.store.state.confirmedAccount,'');assert.equal(app.provider.active,false);await assert.rejects(()=>access(join(directory,'auth')));
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
