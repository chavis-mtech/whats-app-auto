import { randomUUID,createHash } from 'node:crypto';
import { assert,targetJid } from './security.mjs';
export function validateJob(input) {
  const job={id:randomUUID(),name:String(input.name||'').trim(),target:targetJid(input.target),enabled:input.enabled===true,source:input.source||'text',template:String(input.template||''),url:String(input.url||''),inboxJid:input.inboxJid||'',schedule:input.schedule||'interval',minutes:Number(input.minutes??60),time:input.time||'09:00',timezone:input.timezone||'Asia/Bangkok',at:input.at||'',cursor:0};
  assert(job.name.length>0&&job.name.length<=100,'Task name is required (maximum 100).');
  assert(['text','json','inbox'].includes(job.source),'Unknown message source.');assert(job.template.length>0&&job.template.length<=12000,'Template is required (maximum 12000).');
  assert(['once','interval','daily'].includes(job.schedule),'Unknown schedule.');assert(Number.isInteger(job.minutes)&&job.minutes>=1&&job.minutes<=10080,'Interval must be 1–10080 minutes.');
  assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(job.time),'Daily time must be HH:mm.');
  try{new Intl.DateTimeFormat('en',{timeZone:job.timezone});}catch{assert(false,'Invalid IANA timezone.');}
  if(job.schedule==='once')assert(Number.isFinite(Date.parse(job.at))&&Date.parse(job.at)>Date.now(),'One-time schedule must be in the future.');
  if(job.source==='inbox'){targetJid(job.inboxJid);assert(job.inboxJid!==job.target,'Source and destination must differ to prevent forwarding loops.');}
  if(job.source==='json'){const u=new URL(job.url);assert(u.protocol==='https:'&&!u.username&&!u.password,'JSON source must use HTTPS without URL credentials.');}
  return job;
}
export function nextRun(job,now=Date.now()) {
  if(job.schedule==='once')return Date.parse(job.at);
  if(job.schedule==='interval')return now+job.minutes*60000;
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:job.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let date=Math.floor(now/60000)*60000+60000;date<=now+49*3600000;date+=60000)if(format.format(date)===job.time)return date;
  throw new Error('No daily time found in the next 49 hours.');
}
export function createJobs({store,provider,fetchData,now=Date.now,submissionTimeout=45000}) {
  const locks=new Set();let sendBusy=false;let ticking=false;
  const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function preview(job) {
    let data='',json={},cursor=job.cursor||0;
    if(job.source==='json') {json=await fetchData(job.url);data=JSON.stringify(json,null,2);}
    const render=()=>job.template.replace(/\{\{(data|now|json\.[\w.]+)\}\}/g,(_,key)=>{if(key==='data')return data;if(key==='now')return new Date(now()).toISOString();let value=json;for(const part of key.slice(5).split('.'))value=value!=null&&Object.hasOwn(Object(value),part)?value[part]:'';return typeof value==='object'?JSON.stringify(value):String(value??'');});
    if(job.source==='inbox') {
      const messages=store.state.messages.map((m,index)=>({...m,seq:m.seq||index+1})).filter(m=>m.mode===provider.mode&&m.jid===job.inboxJid&&!m.fromMe&&!m.history&&m.seq>cursor).sort((a,b)=>a.seq-b.seq);
      if(!messages.length)return {text:'',skip:true,cursor};
      const selected=[];
      for(const message of messages.slice(0,20)) {const candidate=[...selected,message];data=candidate.map(m=>m.text||`[${m.media?.fileName||'media'}]`).join('\n');if(render().length>16000)break;selected.push(message);cursor=message.seq;}
      assert(selected.length,'An incoming message exceeds the template size. Shorten the template or handle the message manually.');
      data=selected.map(m=>m.text||`[${m.media?.fileName||'media'}]`).join('\n');
    }
    const text=render();assert(text.length<=16000,'Rendered message exceeds 16000 characters. Narrow the JSON fields or shorten the template.');
    return {text,cursor,skip:false};
  }
  async function submit(target,payload,{key,jobId='',name='Manual/API',dueAt=now(),mode=provider.mode,reserved=false,onCommit=()=>{},onNotSubmitted=()=>{}}={}) {
    assert(typeof key==='string'&&key.length>=8&&key.length<=120,'Idempotency-Key must contain 8–120 characters.');
    const hash=fingerprint({target,payload,mode});
    const previous=store.state.runs.find(r=>r.key===key);
    if(previous){assert(previous.hash===hash,'Idempotency key was already used with different content.',409);if(previous.status!=='not_submitted')return previous;}
    assert(reserved||!sendBusy,'Another submission is in progress. Retry with the same key.',409);
    assert(store.state.targets.some(t=>t.jid===target&&t.mode===mode),'Allow this destination for the current mode first.',403);
    assert(provider.ready(),'WhatsApp is not connected.',409);
    assert(store.state.runs.length<10000,'Run ledger is full. Export and archive before sending.',409);
    sendBusy=true;const run={id:randomUUID(),key,hash,jobId,name,target,mode,dueAt,startedAt:now(),status:'submitting',delivery:'unconfirmed'};
    store.state.runs.unshift(run);
    try {
      onCommit();await store.save();
      if(!provider.ready()){run.status='not_submitted';run.error='Connection unavailable before provider invocation. No submission was attempted.';onNotSubmitted();return run;}
      let timer;try {const result=await Promise.race([provider.send(target,payload),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Submission timed out; acceptance is unknown.')),submissionTimeout);})]);run.status=result.status;run.messageId=result.id;} finally{clearTimeout(timer);}
    } catch(error){run.status='unknown';run.error='Submission outcome is unknown. Check the destination in WhatsApp before creating a new request.';}
    finally{run.finishedAt=now();try{await store.save();}finally{if(!reserved)sendBusy=false;}}
    return run;
  }
  async function run(job,{manual=false}={}) {
    assert(!locks.has(job.id),'This task is already running.',409);assert(!sendBusy,'Another send is in progress.',409);locks.add(job.id);sendBusy=true;
    const due=job.retryAt||job.nextAt||now();
    try {
      // Preparation can be retried, but no provider call is replayed automatically.
      if(!provider.ready())return {status:'waiting_for_connection'};
      const rendered=await preview(job);
      if(!provider.ready())return {status:'waiting_for_connection'};
      if(rendered.skip){job.lastResult='no_new_messages';job.nextAt=nextRun(job,now());if(job.schedule==='once')job.enabled=false;await store.save();return {status:'skipped',reason:'No new incoming messages.'};}
      assert(store.state.targets.some(t=>t.jid===job.target&&t.mode===provider.mode),'Destination is not allowed for this mode.',403);
      // Reserve the send lane before preparation; commit source consumption and attempt together.
      const prior={cursor:job.cursor,nextAt:job.nextAt,retryAt:job.retryAt,failures:job.failures,enabled:job.enabled,deferredAttempts:job.deferredAttempts||0};
      const result=await submit(job.target,{text:rendered.text},{key:manual?`manual:${job.id}:${randomUUID()}`:`job:${job.id}:${due}:${prior.deferredAttempts}`,jobId:job.id,name:job.name,dueAt:due,reserved:true,onNotSubmitted:()=>{Object.assign(job,prior);job.deferredAttempts=prior.deferredAttempts+1;},onCommit:()=>{
        job.cursor=rendered.cursor;job.nextAt=nextRun(job,now());job.retryAt=null;job.failures=0;job.deferredAttempts=0;if(job.schedule==='once')job.enabled=false;
      }});
      job.lastResult=result.status;job.lastAt=now();if(result.status==='unknown')job.enabled=false;await store.save();return result;
    } catch(error) {
      if(!provider.ready())return {status:'waiting_for_connection'};
      job.lastResult='preparation_failed';job.lastError=error.status?error.message:'Could not prepare the message. Check source, connection and local storage.';job.failures=(job.failures||0)+1;
      if(!manual){if(job.failures>=3){job.enabled=false;job.retryAt=null;}else job.retryAt=now()+60000*2**(job.failures-1);}
      await store.save();throw error;
    } finally {locks.delete(job.id);sendBusy=false;}
  }
  async function tick() {if(ticking||!provider.ready())return;ticking=true;try{for(const job of store.state.jobs)if(job.enabled&&job.mode===provider.mode&&(job.retryAt||job.nextAt)<=now())try{await run(job);}catch{}}finally{ticking=false;}}
  return {preview,submit,run,tick,isBusy:()=>sendBusy||locks.size>0};
}
