import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../src/store.mjs';
import {targetJid,publicIP,fetchJSON,attachment,passwordHash,verifyPassword} from '../src/security.mjs';
import {validateJob,nextRun,createJobs} from '../src/jobs.mjs';
import {createApplication} from '../src/server.mjs';
import {WhatsAppProvider} from '../src/provider.mjs';

test('security validates recipients, secret hashes and attachment boundaries',()=>{
  assert.equal(targetJid('66800000001@s.whatsapp.net'),'66800000001@s.whatsapp.net');
  assert.throws(()=>targetJid('status@broadcast'));assert.throws(()=>targetJid('hello'));
  const hash=passwordHash('long-test-password');assert(verifyPassword('long-test-password',hash));assert(!verifyPassword('wrong-password',hash));
  assert.equal(attachment({base64:'aGk=',fileName:'../secret.txt'}).fileName,'.._secret.txt');assert.throws(()=>attachment({base64:'bad!'}));assert.throws(()=>attachment({base64:''}));
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicIP(ip),false,ip);
  assert(publicIP('8.8.8.8'));assert(publicIP('2606:4700:4700::1111'));
});
test('JSON fetch blocks schemes, unlisted hosts and rebinding/private DNS before connecting',async()=>{
  await assert.rejects(()=>fetchJSON('http://example.com', ['example.com']));
  await assert.rejects(()=>fetchJSON('https://127.0.0.1', ['127.0.0.1']));
  await assert.rejects(()=>fetchJSON('https://example.com', []));
  await assert.rejects(()=>fetchJSON('https://example.com',['example.com'],async()=>[{address:'127.0.0.1',family:4}]));
  await assert.rejects(()=>fetchJSON('https://example.com',['example.com'],async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]));
});
test('schedule calculations use IANA timezone and validate source loops',()=>{
  const now=Date.parse('2026-11-21T01:00:00Z');assert.equal(nextRun({schedule:'daily',time:'09:00',timezone:'Asia/Bangkok'},now),Date.parse('2026-11-21T02:00:00Z'));
  assert.equal(nextRun({schedule:'interval',minutes:15},now),now+900000);
  assert.throws(()=>validateJob({name:'loop',target:'66800000001@s.whatsapp.net',source:'inbox',inboxJid:'66800000001@s.whatsapp.net',template:'{{data}}'}));
});
function fixture(overrides={}) {
  let time=1000000,calls=0,saves=0;
  const state={settings:{},targets:[{jid:'66800000001@s.whatsapp.net',mode:'demo'}],runs:[],jobs:[],messages:[]};
  const store={state,async save(){saves++;}};
  const provider={mode:'demo',ready:()=>true,async send(){calls++;return {id:'mock-id',status:'simulated'};},...overrides};
  const jobs=createJobs({store,provider,now:()=>time,fetchData:async()=>({total:12500}),submissionTimeout:25});
  const job={id:'job-1',name:'test',target:state.targets[0].jid,mode:'demo',enabled:true,source:'text',template:'hello',schedule:'interval',minutes:1,nextAt:time,cursor:0};state.jobs.push(job);
  return {state,store,provider,jobs,job,get calls(){return calls;},get saves(){return saves;},setTime:x=>time=x};
}
test('persisted idempotency returns identical receipt and refuses changed content',async()=>{
  const f=fixture();const first=await f.jobs.submit(f.job.target,{text:'hello'},{key:'same-key-123'});const second=await f.jobs.submit(f.job.target,{text:'hello'},{key:'same-key-123'});
  assert.equal(first.id,second.id);assert.equal(f.calls,1);assert.equal(first.status,'simulated');
  await assert.rejects(()=>f.jobs.submit(f.job.target,{text:'different'},{key:'same-key-123'}),/different content/);
});
test('scheduler advances due slot, does not replay overdue intervals and excludes own/history messages',async()=>{
  const f=fixture();await f.jobs.tick();await f.jobs.tick();assert.equal(f.calls,1);assert.equal(f.job.nextAt,1060000);
  f.job.source='inbox';f.job.inboxJid='66800000002@s.whatsapp.net';f.job.template='Report: {{data}}';f.state.messages=[{id:'1',mode:'demo',jid:f.job.inboxJid,time:1000001,text:'inbound',fromMe:false},{id:'2',mode:'demo',jid:f.job.inboxJid,time:1000002,text:'ours',fromMe:true},{id:'3',mode:'demo',jid:f.job.inboxJid,time:1000003,text:'history',history:true}];
  const preview=await f.jobs.preview(f.job);assert.equal(preview.text,'Report: inbound');await f.jobs.run(f.job,{manual:true});assert.equal(f.job.cursor,1);const skipped=await f.jobs.run(f.job,{manual:true});assert.equal(skipped.status,'skipped');assert.equal(f.calls,2);
});
test('source JSON templates resolve fields and cannot traverse prototype properties',async()=>{
  const f=fixture();f.job.source='json';f.job.url='https://example.com';f.job.template='Total {{json.total}} {{json.constructor.name}}';assert.equal((await f.jobs.preview(f.job)).text,'Total 12500 ');
});
test('preparation errors retry at 1/2 minutes then pause, with no provider submission',async()=>{
  const f=fixture();f.job.source='inbox';f.job.inboxJid='66800000002@s.whatsapp.net';f.job.template='{{data}}';f.state.messages=[{seq:1,mode:'demo',jid:f.job.inboxJid,text:'x'.repeat(16001),fromMe:false}];await f.jobs.tick();assert.equal(f.job.retryAt,1060000);assert.equal(f.calls,0);f.setTime(1060000);await f.jobs.tick();assert.equal(f.job.retryAt,1180000);f.setTime(1180000);await f.jobs.tick();assert.equal(f.job.enabled,false);assert.equal(f.calls,0);
});
test('offline ticks wait indefinitely without consuming schedule or preparation retry budget',async()=>{
  let ready=false;const f=fixture({ready:()=>ready});for(let index=0;index<10;index++){f.setTime(1000000+index*600000);await f.jobs.tick();}assert.equal(f.job.enabled,true);assert.equal(f.job.failures,undefined);assert.equal(f.job.nextAt,1000000);assert.equal(f.calls,0);ready=true;await f.jobs.tick();assert.equal(f.calls,1);assert.equal(f.job.enabled,true);
});
test('disconnect during source preparation preserves inbox cursor and due time',async()=>{
  let ready=true,release;const f=fixture({ready:()=>ready});f.job.source='json';f.job.url='https://example.com';f.job.template='{{data}}';
  const jobs=createJobs({store:f.store,provider:f.provider,now:()=>1000000,fetchData:()=>new Promise(r=>release=r)});const run=jobs.run(f.job);await new Promise(r=>setImmediate(r));ready=false;release({total:5});assert.equal((await run).status,'waiting_for_connection');assert.equal(f.job.nextAt,1000000);assert.equal(f.job.failures,undefined);assert.equal(f.job.cursor,0);assert.equal(f.calls,0);
});
test('disconnect before provider invocation restores committed inbox slot and can retry safely',async()=>{
  let ready=true;const f=fixture({ready:()=>ready});f.job.source='inbox';f.job.inboxJid='66800000002@s.whatsapp.net';f.job.template='{{data}}';f.state.messages=[{seq:1,mode:'demo',jid:f.job.inboxJid,text:'preserved',fromMe:false}];f.store.save=async()=>{ready=false;};
  const first=await f.jobs.run(f.job);assert.equal(first.status,'not_submitted');assert.equal(f.job.cursor,0);assert.equal(f.job.nextAt,1000000);assert.equal(f.job.enabled,true);assert.equal(f.calls,0);
  ready=true;f.store.save=async()=>{};const second=await f.jobs.run(f.job);assert.equal(second.status,'simulated');assert.equal(f.job.cursor,1);assert.equal(f.calls,1);
});
test('ambiguous provider failures and timeouts are not automatically retried',async()=>{
  const f=fixture({async send(){throw new Error('socket closed after acceptance');}});const r=await f.jobs.run(f.job);assert.equal(r.status,'unknown');assert.equal(f.job.enabled,false);await f.jobs.tick();assert.equal(f.state.runs.length,1);
  const slow=fixture({send:()=>new Promise(()=>{})});assert.equal((await slow.jobs.run(slow.job)).status,'unknown');
});
test('overlap guard prevents concurrent sends',async()=>{
  let release;const f=fixture({send:()=>new Promise(r=>release=r)});const pending=f.jobs.run(f.job);await new Promise(r=>setTimeout(r,2));await assert.rejects(()=>f.jobs.run(f.job),/already running/);release({id:'test',status:'simulated'});await pending;assert.equal(f.state.runs.length,1);
});
test('inbox batches consume earliest messages without dropping equal-timestamp items',async()=>{
  const f=fixture();f.job.source='inbox';f.job.inboxJid='66800000002@s.whatsapp.net';f.job.template='{{data}}';
  f.state.messages=Array.from({length:21},(_,i)=>({id:String(i),seq:i+1,mode:'demo',jid:f.job.inboxJid,time:1000001,text:`message-${i+1}`,fromMe:false}));
  const first=await f.jobs.preview(f.job);assert(first.text.startsWith('message-1\n'));assert(!first.text.includes('message-21'));assert.equal(first.cursor,20);
  await f.jobs.run(f.job,{manual:true});assert.equal(f.job.cursor,20);assert.equal((await f.jobs.preview(f.job)).text,'message-21');await f.jobs.run(f.job,{manual:true});assert.equal(f.job.cursor,21);
});
test('reserved submission lane rejects competing manual send while inbox cursor is committed',async()=>{
  const f=fixture();f.job.source='inbox';f.job.inboxJid='66800000002@s.whatsapp.net';f.job.template='{{data}}';f.state.messages=[{id:'new',seq:1,mode:'demo',jid:f.job.inboxJid,time:1000001,text:'must not lose',fromMe:false}];
  let release,entered;const committed=new Promise(r=>entered=r);f.store.save=()=>{entered();return new Promise(r=>release=r);};
  const running=f.jobs.run(f.job);await committed;
  await assert.rejects(()=>f.jobs.submit(f.job.target,{text:'competitor'},{key:'competing-key'}),/in progress/);assert.equal(f.state.runs.length,1);assert.equal(f.job.cursor,1);
  f.store.save=async()=>{};release();await running;assert.equal(f.calls,1);assert.equal(f.state.runs[0].status,'simulated');
});
test('store persists state, excludes second process, and converts interrupted submission to unknown',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'waa-store-'));try{let store=await openStore(directory);await assert.rejects(()=>openStore(directory),/already in use/);store.state.runs.push({id:'interrupted',status:'submitting'});await store.save();await store.close();store=await openStore(directory);assert.equal(store.state.runs[0].status,'unknown');assert.equal(JSON.parse(await readFile(join(directory,'state.json'),'utf8')).runs[0].status,'unknown');await store.close();}finally{await rm(directory,{recursive:true,force:true});}
});
test('real Baileys adapter dependencies load without connecting or accessing a session',async()=>{
  const module=await import('@whiskeysockets/baileys');assert.equal(typeof module.default,'function');assert.equal(typeof module.useMultiFileAuthState,'function');assert.equal(typeof module.normalizeMessageContent,'function');
});
test('stale live group result is discarded after disconnect and missing account never activates provider',async()=>{
  const f=fixture();f.state.settings={mode:'live',expectedPhone:''};const provider=new WhatsAppProvider(f.store,'unused');await assert.rejects(()=>provider.connect(),/เบอร์สากล/);assert.equal(provider.active,false);
  provider.active=true;provider.status='connected';let release;provider.socket={groupFetchAllParticipating:()=>new Promise(r=>release=r),end(){}};const pending=provider.refreshGroups();provider.disconnect();release({'120363000000001@g.us':{id:'120363000000001@g.us',subject:'stale group',participants:[]}});assert.deepEqual(await pending,[]);assert.deepEqual(provider.groups,[]);
});
test('HTTP app enforces browser/API isolation and completes synthetic messaging/jobs/export/restart flow',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'waa-http-'));let app=await createApplication({directory,port:0});let origin=`http://127.0.0.1:${app.port}`;let cookie='';
  const call=async(path,method='GET',body,headers={})=>{const response=await fetch(origin+'/api'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json',origin}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};};
  try {
    assert.equal((await call('/state')).status,401);
    assert.equal((await call('/setup','POST',{password:'a-long-test-password'},{origin:'https://evil.example'})).status,403);
    const setup=await call('/setup','POST',{password:'a-long-test-password'});assert.equal(setup.status,200);cookie=setup.cookie.split(';')[0];
    assert.equal((await call('/state')).data.provider.status,'disconnected');assert.equal((await call('/connect','POST',{})).data.status,'demo');
    const state=(await call('/state')).data;assert.equal(state.groups.length,2);assert(!JSON.stringify(state).includes('passwordHash'));assert(!JSON.stringify(state).includes(app.store.state.token));
    assert.equal((await call('/targets','POST',{jid:state.contacts[0].id,name:'Demo contact'})).status,201);
    const key={'idempotency-key':'http-test-key-1'};const send=await call('/send','POST',{target:state.contacts[0].id,text:'Test synthetic message'},key);assert.equal(send.data.status,'simulated');
    assert.equal((await call('/send','POST',{target:state.contacts[0].id,text:'Test synthetic message'},key)).data.id,send.data.id);
    assert.equal((await call('/send','POST',{target:state.contacts[0].id,file:{base64:'SGVsbG8=',fileName:'test.txt',mimetype:'text/plain',caption:'Synthetic file'}},{'idempotency-key':'http-file-key-1'})).data.status,'simulated');
    const job=await call('/jobs','POST',{name:'HTTP job',target:state.contacts[0].id,template:'Daily hello',schedule:'interval',minutes:60,enabled:false});assert.equal(job.status,201);
    assert.equal((await call('/jobs/'+job.data.id+'/run','POST',{})).data.status,'simulated');
    const token=(await call('/token','POST',{password:'a-long-test-password'})).data.token;assert(token);
    assert.equal((await call('/export')).status,200);assert(!JSON.stringify((await call('/export')).data).includes(token));
    cookie='';assert.equal((await call('/state','GET',undefined,{authorization:'Bearer '+token})).status,200);
    assert.equal((await call('/token','POST',{password:'a-long-test-password'},{authorization:'Bearer '+token})).status,403);
    const wrongHost=await new Promise(resolve=>{http.get(origin+'/api/state',{headers:{host:'evil.example',authorization:'Bearer '+token}},r=>{r.resume();resolve(r.statusCode);});});assert.equal(wrongHost,403);
    await app.close();app=await createApplication({directory,port:0});origin=`http://127.0.0.1:${app.port}`;
    assert.equal(app.provider.status,'disconnected');assert.equal(app.store.state.jobs.length,1);assert.equal(app.store.state.runs.length,3);
    const replay=await call('/send','POST',{target:state.contacts[0].id,text:'Test synthetic message'},{authorization:'Bearer '+token,...key});assert.equal(replay.data.id,send.data.id);
    assert.equal((await call('/settings','PUT',{mode:'live',timezone:'Asia/Bangkok',allowedHosts:[],retention:500,expectedPhone:'66800000000'},{authorization:'Bearer '+token})).status,200);
    const live=(await call('/state','GET',undefined,{authorization:'Bearer '+token})).data;assert.equal(live.targets.length,0);assert.equal(live.contacts.length,0);assert.equal(live.messages.length,0);assert.equal(live.jobs.length,0);
    assert.equal((await call('/demo/incoming','POST',{jid:'66800000001@s.whatsapp.net'},{authorization:'Bearer '+token})).status,403);
  } finally {await app.close();await rm(directory,{recursive:true,force:true});}
});
