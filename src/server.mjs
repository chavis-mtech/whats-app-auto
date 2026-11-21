import http from 'node:http';
import { readFile,rm,mkdir } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { openStore } from './store.mjs';
import { assert,same,passwordHash,verifyPassword,targetJid,fetchJSON,attachment } from './security.mjs';
import { WhatsAppProvider } from './provider.mjs';
import { createJobs,validateJob,nextRun } from './jobs.mjs';
import { normalizeExpectedPhone } from './phone.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function createApplication({directory=process.env.WAA_DATA_DIR||join(process.env.LOCALAPPDATA||join(homedir(),'.local','share'),'WhatsAppAuto'),port=Number(process.env.WAA_PORT||4318),providerFactory}={}) {
  assert(Number.isInteger(port)&&port>=0&&port<=65535,'Invalid WAA_PORT.');
  const store=await openStore(directory);const provider=providerFactory?providerFactory(store,directory):new WhatsAppProvider(store,directory);
  const jobs=createJobs({store,provider,fetchData:url=>fetchJSON(url,store.state.settings.allowedHosts)});
  const sessions=new Map();const attempts=new Map();let actualPort=port;let closing=false;
  const publicDir=join(root,'public');
  async function body(req) {assert(req.headers['content-type']?.startsWith('application/json'),'Use Content-Type: application/json.',415);let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;assert(size<=14500000,'Request is too large.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(new Error('Invalid JSON body.'),{status:400});}}
  const view=()=>({provider:provider.info(),settings:store.state.settings,targets:store.state.targets.filter(t=>t.mode===provider.mode),jobs:store.state.jobs.filter(j=>j.mode===provider.mode),runs:store.state.runs.slice(0,300).map(({hash,key,...run})=>run),contacts:store.state.contacts.filter(c=>provider.mode==='demo'?c.source==='demo':c.source!=='demo'),groups:provider.groups,messages:store.state.messages.filter(m=>m.mode===provider.mode).slice(-300),version:'1.0.3'});
  const server=http.createServer(async(req,res)=>{
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const send=(status,value,extra={})=>{res.writeHead(status,{...headers,...extra});res.end(typeof value==='string'?value:JSON.stringify(value));};
    try {
      assert(req.headers.host===`127.0.0.1:${actualPort}`,'Open the application using 127.0.0.1 and its configured port.',403);
      const origin=`http://127.0.0.1:${actualPort}`;
      if(req.headers.origin)assert(req.headers.origin===origin,'Cross-origin requests are blocked.',403);
      assert(!req.headers['sec-fetch-site']||!['cross-site'].includes(req.headers['sec-fetch-site']),'Cross-site requests are blocked.',403);
      const url=new URL(req.url,origin);const path=url.pathname;const method=req.method;
      if(path==='/api/health'&&method==='GET')return send(200,{ok:true,app:'whatsapp-auto',version:'1.0.3'});
      const cookie=/(?:^|;\s*)waa=([^;]+)/.exec(req.headers.cookie||'')?.[1];const session=cookie&&sessions.get(cookie);
      const browser=!!session&&session>Date.now();
      const bearer=req.headers.authorization?.startsWith('Bearer ')&&same(req.headers.authorization.slice(7),store.state.token);
      if(path==='/api/auth'&&method==='GET')return send(200,{setup:!store.state.passwordHash,authenticated:browser});
      if((path==='/api/setup'||path==='/api/login')&&method==='POST'){
        const input=await body(req);const key='local';const entry=attempts.get(key)||{count:0,until:0};assert(entry.until<=Date.now(),'Too many attempts. Wait one minute.',429);
        assert(typeof input.password==='string'&&input.password.length>=12&&input.password.length<=128,'Password must be 12–128 characters.');
        if(path==='/api/setup'){assert(!store.state.passwordHash,'Setup is already complete.',409);store.state.passwordHash=passwordHash(input.password);await store.save();}
        else if(!verifyPassword(input.password,store.state.passwordHash)){entry.count++;if(entry.count>=5){entry.until=Date.now()+60000;entry.count=0;}attempts.set(key,entry);throw Object.assign(new Error('Incorrect password.'),{status:401});}
        attempts.delete(key);const token=randomBytes(32).toString('base64url');sessions.set(token,Date.now()+8*3600000);return send(200,{ok:true},{'set-cookie':`waa=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`});
      }
      if(path.startsWith('/api/')){
        assert(browser||bearer,'Sign in or supply a Bearer API token.',401);
        if(!['GET','HEAD'].includes(method))assert(bearer||req.headers.origin===origin,'Browser changes require the application origin.',403);
        if(path==='/api/logout'&&method==='POST'){sessions.delete(cookie);return send(200,{ok:true},{'set-cookie':'waa=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
        if(path==='/api/state'&&method==='GET')return send(200,view());
        if(path==='/api/settings'&&method==='PUT'){
          assert(!jobs.isBusy(),'Wait for the active task to finish.',409);const input=await body(req);assert(!jobs.isBusy(),'Wait for the active task to finish.',409);
          assert(['demo','live'].includes(input.mode),'Invalid mode.');assert(Array.isArray(input.allowedHosts)&&input.allowedHosts.length<=30&&input.allowedHosts.every(h=>typeof h==='string'&&h.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)),'Use up to 30 exact lowercase public hostnames.');
          assert(Number.isInteger(input.retention)&&input.retention>=50&&input.retention<=5000,'Message retention must be 50–5000.');
          input.expectedPhone=normalizeExpectedPhone(input.expectedPhone||'',{allowEmpty:true});
          try{new Intl.DateTimeFormat('en',{timeZone:input.timezone});}catch{assert(false,'Invalid timezone.');}
          const changedAccount=store.state.settings.mode!==input.mode||store.state.settings.expectedPhone!==input.expectedPhone;
          const autoResume=input.autoResume===true&&!changedAccount;
          if(autoResume)assert(input.mode==='live'&&store.state.confirmedAccount===input.expectedPhone&&(store.state.settings.autoResume||provider.status==='connected'&&provider.account===input.expectedPhone),'Connect and confirm the expected live account before enabling automatic resume.',409);
          if(changedAccount){provider.disconnect();store.state.confirmedAccount='';for(const j of store.state.jobs)j.enabled=false;}
          store.state.settings={mode:input.mode,allowedHosts:input.allowedHosts,retention:input.retention,timezone:input.timezone,expectedPhone:input.expectedPhone||'',autoResume};store.state.messages=store.state.messages.slice(-input.retention);await store.save();return send(200,{ok:true});
        }
        if(path==='/api/token'&&method==='POST'){assert(browser,'API tokens can be revealed only in the local browser.',403);const input=await body(req);assert(verifyPassword(input.password,store.state.passwordHash),'Incorrect password.',401);if(input.rotate){store.state.token=randomBytes(32).toString('base64url');await store.save();}return send(200,{token:store.state.token});}
        if(path==='/api/password'&&method==='PUT'){const input=await body(req);assert(verifyPassword(input.current,store.state.passwordHash),'Incorrect password.',401);assert(typeof input.password==='string'&&input.password.length>=12&&input.password.length<=128,'New password must be 12–128 characters.');store.state.passwordHash=passwordHash(input.password);sessions.clear();await store.save();return send(200,{ok:true});}
        if(path==='/api/connect'&&method==='POST')return send(200,await provider.connect());
        if(path==='/api/disconnect'&&method==='POST'){provider.disconnect();store.state.settings.autoResume=false;await store.save();return send(200,{ok:true});}
        if(path==='/api/session'&&method==='DELETE'){assert(!jobs.isBusy(),'Wait for the active send to finish.',409);provider.disconnect();store.state.settings.autoResume=false;store.state.confirmedAccount='';for(const j of store.state.jobs)j.enabled=false;await provider.authWrites;await rm(join(directory,'auth'),{recursive:true,force:true});await store.save();return send(200,{ok:true});}
        if(path==='/api/qr'&&method==='GET'){assert(provider.qr,'No QR is currently available.',404);return send(200,await QRCode.toString(provider.qr,{type:'svg',margin:2,width:260}),{'content-type':'image/svg+xml','cache-control':'no-store'});}
        if(path==='/api/groups/refresh'&&method==='POST')return send(200,await provider.refreshGroups());
        if(path==='/api/contacts'&&method==='GET')return send(200,{scope:provider.info().contactsScope,items:view().contacts});
        if(path==='/api/groups'&&method==='GET')return send(200,provider.groups);
        if(path==='/api/messages'&&method==='GET')return send(200,view().messages.filter(m=>!url.searchParams.get('jid')||m.jid===url.searchParams.get('jid')));
        if(path==='/api/messages'&&method==='DELETE'){store.state.messages=[];await store.save();return send(200,{ok:true});}
        if(path==='/api/demo/incoming'&&method==='POST'){assert(provider.mode==='demo','Synthetic injection is available only in demo mode.',403);const input=await body(req);await provider.capture({id:randomBytes(12).toString('hex'),jid:targetJid(input.jid),text:String(input.text||'ข้อความตัวอย่างใหม่').slice(0,12000),time:Date.now(),fromMe:false,mode:'demo'});return send(201,{ok:true});}
        if(path==='/api/targets'&&method==='POST'){const input=await body(req);const jid=targetJid(input.jid);assert(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=100,'Destination name is required.');if(!store.state.targets.some(t=>t.jid===jid&&t.mode===provider.mode)){assert(store.state.targets.length<1000,'Too many destinations.');store.state.targets.push({jid,name:input.name.trim(),mode:provider.mode});await store.save();}return send(201,{ok:true});}
        if(path.startsWith('/api/targets/')&&method==='DELETE'){const jid=decodeURIComponent(path.slice(13));store.state.targets=store.state.targets.filter(t=>!(t.jid===jid&&t.mode===provider.mode));for(const j of store.state.jobs)if(j.target===jid&&j.mode===provider.mode)j.enabled=false;await store.save();return send(200,{ok:true});}
        if(path==='/api/send'&&method==='POST'){const input=await body(req);const target=targetJid(input.target);let payload;if(input.file)payload=attachment(input.file);else{assert(typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=16000,'Text is required (maximum 16000).');payload={text:input.text};}return send(200,await jobs.submit(target,payload,{key:req.headers['idempotency-key']}));}
        if(path==='/api/jobs'&&method==='GET')return send(200,view().jobs);
        if(path==='/api/runs'&&method==='GET')return send(200,view().runs);
        if(path==='/api/export'&&method==='GET')return send(200,{...view(),exportedAt:new Date().toISOString()},{'content-disposition':'attachment; filename="whatsapp-auto-export.json"'});
        if(path==='/api/jobs/preview'&&method==='POST'){const job=validateJob(await body(req));return send(200,await jobs.preview(job));}
        if(path==='/api/jobs'&&method==='POST'){assert(store.state.jobs.length<200,'Maximum 200 tasks.');const job=validateJob(await body(req));assert(store.state.targets.some(t=>t.jid===job.target&&t.mode===provider.mode),'Allow the destination first.',403);job.mode=provider.mode;job.nextAt=nextRun(job);job.cursor=store.state.messageSequence;store.state.jobs.push(job);await store.save();return send(201,job);}
        const match=/^\/api\/jobs\/([^/]+)(?:\/(run|toggle))?$/.exec(path);
        if(match){const job=store.state.jobs.find(j=>j.id===match[1]&&j.mode===provider.mode);assert(job,'Task not found.',404);assert(!jobs.isBusy(),'Wait for the current task to finish.',409);
          if(method==='DELETE'){store.state.jobs=store.state.jobs.filter(j=>j.id!==job.id);await store.save();return send(200,{ok:true});}
          if(method==='PUT'&&!match[2]){const updated=validateJob(await body(req));assert(store.state.targets.some(t=>t.jid===updated.target&&t.mode===provider.mode),'Allow destination first.',403);Object.assign(job,updated,{id:job.id,cursor:store.state.messageSequence,nextAt:nextRun(updated),failures:0,retryAt:null,mode:provider.mode});await store.save();return send(200,job);}
          if(method==='POST'&&match[2]==='run')return send(200,await jobs.run(job,{manual:true}));
          if(method==='POST'&&match[2]==='toggle'){assert(!(job.schedule==='once'&&Date.parse(job.at)<=Date.now()),'Edit the expired one-time date before enabling.');job.enabled=!job.enabled;job.retryAt=null;job.failures=0;job.nextAt=nextRun(job);await store.save();return send(200,job);}
        }
        return send(404,{error:'API route not found.'});
      }
      assert(method==='GET'||method==='HEAD','Method not allowed.',405);
      const assets={'/':'index.html','/app.js':'app.js','/api-examples.js':'api-examples.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
      assert(assets[path],'Page not found.',404);const extension=assets[path].split('.').pop();const content=await readFile(join(publicDir,assets[path]));
      res.writeHead(200,{...headers,'content-type':{html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'}[extension]});res.end(method==='HEAD'?undefined:content);
    } catch(error){if(!res.headersSent)send(error.status||500,{error:error.status?error.message:'The operation could not complete. Check local storage and try again.'});else res.end();}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});actualPort=server.address().port;
  await provider.resumeOnStartup?.();
  const timer=setInterval(()=>jobs.tick().catch(()=>{}),2000);timer.unref();
  const close=async()=>{if(closing)return;closing=true;clearInterval(timer);provider.disconnect();await new Promise(resolve=>server.close(resolve));await store.close();};
  return {server,store,provider,jobs,port:actualPort,directory,close};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const app=await createApplication();console.log(`WhatsApp Auto is ready: http://127.0.0.1:${app.port}\nAutomatic resume defaults off; enabled confirmed live sessions may resume scheduled jobs.\nPrivate state: ${app.directory}`);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));}
  catch(error){console.error(`Startup failed: ${error.message}`);process.exitCode=1;}
}
