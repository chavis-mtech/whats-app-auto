import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {createApplication} from '../src/server.mjs';
test('Fastify owns HTTP lifecycle while preserving auth, early origin checks, trusted schemas, size limits and private headers',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'waa-framework-')),app=await createApplication({directory,port:0}),origin=`http://127.0.0.1:${app.port}`,authorization='Bearer '+app.store.state.token;
 try{assert.match(app.framework.version,/^5\./);const health=await fetch(origin+'/api/health');assert.equal(health.status,200);assert.equal(health.headers.get('x-frame-options'),'DENY');assert.match(health.headers.get('content-security-policy'),/frame-ancestors 'none'/);const unauth=await fetch(origin+'/api/send',{method:'POST',headers:{'content-type':'application/json'},body:'not-json'});assert.equal(unauth.status,401);
 const send=(body,headers={})=>fetch(origin+'/api/send',{method:'POST',headers:{authorization,'content-type':'application/json',...headers},body});assert.equal((await send('{}',{origin:'https://evil.example'})).status,403);assert.equal((await send('{')).status,400);assert.equal((await send('[]')).status,400);assert.equal((await send('{"target":7,"text":"x"}')).status,400);assert.equal((await send('{"target":"66800000001@s.whatsapp.net","text":"x","__proto__":{"polluted":true}}')).status,400);assert.equal({}.polluted,undefined);assert.equal((await send('x',{'content-type':'text/plain'})).status,415);
 const oversized=await new Promise((resolve,reject)=>{const request=http.request(origin+'/api/send',{method:'POST',headers:{authorization,'content-type':'application/json','content-length':'14500001'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});assert.equal(oversized,413);assert.equal(app.store.state.runs.length,0);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('fileText cannot bypass preview approval through toggle under Fastify routes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'waa-txt-toggle-')),folder=join(root,'files');await mkdir(folder);const path=join(folder,'report.txt');await writeFile(path,'ข้อความไทย');await utimes(path,new Date(Date.now()-120000),new Date(Date.now()-120000));const app=await createApplication({directory:join(root,'state'),port:0}),origin=`http://127.0.0.1:${app.port}`;const call=async(path,method,value)=>{const response=await fetch(origin+'/api'+path,{method,headers:{authorization:'Bearer '+app.store.state.token,'content-type':'application/json'},body:JSON.stringify(value)});return {status:response.status,value:await response.json()};};
 try{await app.provider.connect();await call('/targets','POST',{jid:'66800000001@s.whatsapp.net',name:'Synthetic'});const draft={name:'TXT',target:'66800000001@s.whatsapp.net',source:'fileText',folder,template:'{{data}}',enabled:false};const saved=await call('/jobs','POST',draft);assert.equal(saved.status,201);assert.equal((await call('/jobs/'+saved.value.id+'/toggle','POST',{})).status,409);assert.equal(app.store.state.jobs[0].enabled,false);const preview=await call('/jobs/preview','POST',draft);assert(preview.value.previewToken);assert.equal((await call('/jobs/'+saved.value.id,'PUT',{...draft,enabled:true,previewToken:preview.value.previewToken})).status,200);}finally{await app.close();await rm(root,{recursive:true,force:true});}
});
