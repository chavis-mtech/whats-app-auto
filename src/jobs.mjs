import { randomUUID,createHash } from 'node:crypto';
import { assert,targetJid } from './security.mjs';
import { normalizeFolder,normalizeExtensions,readLatestFile,readLatestFiles } from './file-source.mjs';
import { renderDateTemplates } from './date-format.mjs';
import {writeBatch,loadBatchItem,removeBatch} from './outbox.mjs';
export function validateJob(input) {
  const job={id:randomUUID(),name:String(input.name||'').trim(),target:targetJid(input.target),enabled:input.enabled===true,source:input.source||'text',template:String(input.template||''),url:String(input.url||''),inboxJid:input.inboxJid||'',schedule:input.schedule||'interval',minutes:Number(input.minutes??60),time:input.time||'09:00',timezone:input.timezone||'Asia/Bangkok',at:input.at||'',cursor:0,folder:String(input.folder||''),extensions:normalizeExtensions(input.extensions),settleSeconds:Number(input.settleSeconds??30),sendOnlyChanged:input.sendOnlyChanged!==false,dateBasis:input.dateBasis||'now',dateLocale:input.dateLocale||'th-TH'};
  assert(job.name.length>0&&job.name.length<=100,'Task name is required (maximum 100).');
  job.fileCount=Number(input.fileCount??1);job.filePeriod=input.filePeriod||'latestDay';
  assert(Number.isInteger(job.fileCount)&&job.fileCount>=1&&job.fileCount<=10,'เลือกจำนวนไฟล์ 1–10 ไฟล์');assert(['latestDay','any'].includes(job.filePeriod),'Invalid file period.');
  assert(['text','json','inbox','file','fileText'].includes(job.source),'Unknown message source.');assert(job.template.length>0&&job.template.length<=12000,'Template is required (maximum 12000).');
  assert(['once','interval','daily'].includes(job.schedule),'Unknown schedule.');assert(Number.isInteger(job.minutes)&&job.minutes>=1&&job.minutes<=10080,'Interval must be 1–10080 minutes.');
  assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(job.time),'Daily time must be HH:mm.');
  try{new Intl.DateTimeFormat('en',{timeZone:job.timezone});}catch{assert(false,'Invalid IANA timezone.');}
  if(job.schedule==='once')assert(Number.isFinite(Date.parse(job.at))&&Date.parse(job.at)>Date.now(),'One-time schedule must be in the future.');
  if(job.source==='inbox'){targetJid(job.inboxJid);assert(job.inboxJid!==job.target,'Source and destination must differ to prevent forwarding loops.');}
  if(job.source==='json'){const u=new URL(job.url);assert(u.protocol==='https:'&&!u.username&&!u.password,'JSON source must use HTTPS without URL credentials.');}
  assert(['now','modified'].includes(job.dateBasis),'Invalid date basis.');assert(['th-TH','en-GB'].includes(job.dateLocale),'Invalid date locale.');
  assert(Number.isInteger(job.settleSeconds)&&job.settleSeconds>=5&&job.settleSeconds<=3600,'ระยะให้ไฟล์นิ่งต้องเป็น 5–3600 วินาที');
  if(['file','fileText'].includes(job.source)){job.folder=normalizeFolder(job.folder);if(job.source==='file')assert(job.template.length<=4000,'คำบรรยายไฟล์ต้องไม่เกิน 4,000 ตัวอักษร');else{job.extensions=['.txt'];job.fileCount=1;assert(job.template.includes('{{data}}'),'ข้อความ TXT ต้องมี {{data}} เพื่อไม่ละทิ้งเนื้อหาไฟล์');}}
  renderDateTemplates(job.template,{date:Date.now(),timezone:job.timezone,locale:job.dateLocale});
  return job;
}
export function nextRun(job,now=Date.now()) {
  if(job.schedule==='once')return Date.parse(job.at);
  if(job.schedule==='interval')return now+job.minutes*60000;
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:job.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let date=Math.floor(now/60000)*60000+60000;date<=now+49*3600000;date+=60000)if(format.format(date)===job.time)return date;
  throw new Error('No daily time found in the next 49 hours.');
}
export function createJobs({store,provider,fetchData,now=Date.now,submissionTimeout=45000,blockedFolders=[],outboxDirectory}) {
  const locks=new Set();let sendBusy=false;let ticking=false;
  const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const consumed=(job,file)=>job.sendOnlyChanged!==false&&(job.source!=='fileText'&&job.lastFileFingerprint===`${provider.mode}:${job.target}:${file.fingerprint}`||store.state.runs.some(run=>run.jobId===job.id&&run.target===job.target&&run.mode===provider.mode&&run.file?.fingerprint===file.fingerprint&&(run.file.output||'document')===(file.output||'document')&&['submitting','submitted','simulated','unknown'].includes(run.status)));
  function fileMessage(job,selected,date){
    let contents='';if(job.source==='fileText'){try{contents=new TextDecoder('utf-8',{fatal:true}).decode(selected.data).replace(/\r\n/g,'\n');}catch{assert(false,'TXT ต้องเป็น UTF-8 ที่ถูกต้อง ไม่รองรับไฟล์ binary/ANSI',400);}assert(contents.trim()&&!contents.includes('\0'),'ไฟล์ TXT ว่างหรือมีข้อมูล binary',400);}
    const template=renderDateTemplates(job.template,{date:job.dateBasis==='modified'?selected.metadata.modifiedAt:date,timezone:job.timezone||'Asia/Bangkok',locale:job.dateLocale||'th-TH'});
    const text=template.replace(/\{\{(data|now|file\.name|file\.modified)\}\}/g,(_match,key)=>key==='data'?contents:key==='now'?new Date(date).toISOString():key==='file.name'?selected.metadata.name:new Date(selected.metadata.modifiedAt).toISOString());
    assert(text.trim()&&text.length<=(job.source==='fileText'?16000:4000),job.source==='fileText'?'ข้อความ TXT รวมต้องไม่เกิน 16,000 ตัวอักษร ไม่มีการตัดข้อความ':'คำบรรยายไฟล์หลังแทนค่าต้องไม่เกิน 4,000 ตัวอักษร');
    return {text,file:{...selected.metadata,output:job.source==='fileText'?'text':'document'},payload:job.source==='fileText'?{text}:{document:selected.data,mimetype:selected.mimetype,fileName:selected.metadata.name.replace(/[\\/\x00-\x1f<>:"|?*]/g,'_'),caption:text}};
  }
  async function prepare(job) {
    let data='',json={},cursor=job.cursor||0,selected;
    if(['file','fileText'].includes(job.source))try{const selection=await readLatestFiles({...job,extensions:job.source==='fileText'?['.txt']:job.extensions,fileCount:job.source==='fileText'?1:job.fileCount||1},{now:now(),blockedFolders});const date=now(),items=selection.files.map(item=>fileMessage(job,item,date));const summary={requestedCount:selection.requestedCount,availableCount:selection.availableCount,day:selection.day,shortfall:selection.shortfall};if(items.length>1||job.source==='file'&&(job.fileCount||1)>1)return {items,selection:summary,text:items.map(item=>item.text).join('\n\n'),files:items.map(item=>({...item.file,alreadySent:consumed(job,item.file)})),cursor,skip:false};const item=items[0];return {...item,selection:summary,cursor,skip:false,consumption:`${provider.mode}:${job.target}:${item.file.fingerprint}`};}catch(error){if(error.fileUnavailable)return {text:'',waiting:true,reason:error.message};throw error;}
    if(job.source==='file')try{selected=await readLatestFile(job,{now:now(),blockedFolders});}catch(error){if(error.fileUnavailable)return {text:'',waiting:true,reason:error.message};throw error;}
    if(job.source==='json') {json=await fetchData(job.url);data=JSON.stringify(json,null,2);}
    const template=renderDateTemplates(job.template,{date:job.dateBasis==='modified'&&selected?selected.metadata.modifiedAt:now(),timezone:job.timezone||'Asia/Bangkok',locale:job.dateLocale||'th-TH'});
    const render=()=>template.replace(/\{\{(data|now|json\.[\w.]+)\}\}/g,(_,key)=>{if(key==='data')return data;if(key==='now')return new Date(now()).toISOString();let value=json;for(const part of key.slice(5).split('.'))value=value!=null&&Object.hasOwn(Object(value),part)?value[part]:'';return typeof value==='object'?JSON.stringify(value):String(value??'');});
    if(job.source==='inbox') {
      const messages=store.state.messages.map((m,index)=>({...m,seq:m.seq||index+1})).filter(m=>m.mode===provider.mode&&m.jid===job.inboxJid&&!m.fromMe&&!m.history&&m.seq>cursor).sort((a,b)=>a.seq-b.seq);
      if(!messages.length)return {text:'',skip:true,cursor};
      const selected=[];
      for(const message of messages.slice(0,20)) {const candidate=[...selected,message];data=candidate.map(m=>m.text||`[${m.media?.fileName||'media'}]`).join('\n');if(render().length>16000)break;selected.push(message);cursor=message.seq;}
      assert(selected.length,'An incoming message exceeds the template size. Shorten the template or handle the message manually.');
      data=selected.map(m=>m.text||`[${m.media?.fileName||'media'}]`).join('\n');
    }
    let text=render();
    if(selected)text=text.replace(/\{\{file\.(name|modified)\}\}/g,(_match,key)=>key==='name'?selected.metadata.name:new Date(selected.metadata.modifiedAt).toISOString());
    assert(text.length<=(selected?4000:16000),selected?'คำบรรยายไฟล์หลังแทนค่าต้องไม่เกิน 4,000 ตัวอักษร':'Rendered message exceeds 16000 characters. Narrow the JSON fields or shorten the template.');
    if(selected){const consumption=`${provider.mode}:${job.target}:${selected.metadata.fingerprint}`;return {text,cursor,skip:false,file:selected.metadata,consumption,payload:{document:selected.data,mimetype:selected.mimetype,fileName:selected.metadata.name.replace(/[\\/\x00-\x1f<>:"|?*]/g,'_'),caption:text}};}
    return {text,cursor,skip:false};
  }
  async function preview(job){const {payload,consumption,items,...publicPreview}=await prepare(job);return publicPreview;}
  async function submit(target,payload,{key,jobId='',name='Manual/API',dueAt=now(),mode=provider.mode,reserved=false,onCommit=()=>{},onNotSubmitted=()=>{},onSettled=()=>{},canInvoke=()=>true,fileInfo,batchId,batchIndex}={}) {
    assert(typeof key==='string'&&key.length>=8&&key.length<=120,'Idempotency-Key must contain 8–120 characters.');
    const hash=fingerprint({target,payload,mode});
    const previous=store.state.runs.find(r=>r.key===key);
    if(previous){assert(previous.hash===hash,'Idempotency key was already used with different content.',409);if(previous.status!=='not_submitted')return previous;}
    assert(reserved||!sendBusy,'Another submission is in progress. Retry with the same key.',409);
    assert(store.state.targets.some(t=>t.jid===target&&t.mode===mode),'Allow this destination for the current mode first.',403);
    assert(provider.ready(),'WhatsApp is not connected.',409);
    assert(store.state.runs.length<10000,'Run ledger is full. Export and archive before sending.',409);
    sendBusy=true;const run={id:randomUUID(),key,hash,jobId,name,target,mode,dueAt,startedAt:now(),status:'submitting',delivery:'unconfirmed',...(batchId?{batchId,batchIndex}:{}),...(fileInfo?{file:{name:fileInfo.name,size:fileInfo.size,modifiedAt:fileInfo.modifiedAt,sha256:fileInfo.sha256,fingerprint:fileInfo.fingerprint,output:fileInfo.output||'document'}}:{})};
    store.state.runs.unshift(run);
    try {
      onCommit(run);await store.save();
      if(!provider.ready()||!canInvoke()){run.status='not_submitted';run.error='Connection or authorization changed before provider invocation. No submission was attempted.';onNotSubmitted();return run;}
      let timer;try {const result=await Promise.race([provider.send(target,payload),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Submission timed out; acceptance is unknown.')),submissionTimeout);})]);run.status=result.status;run.messageId=result.id;} finally{clearTimeout(timer);}
    } catch(error){run.status='unknown';run.error='Submission outcome is unknown. Check the destination in WhatsApp before creating a new request.';}
    finally{run.finishedAt=now();onSettled(run);try{await store.save();}finally{if(!reserved)sendBusy=false;}}
    return run;
  }
  async function runPending(job){
    const batch=job.pendingBatch;assert(batch&&batch.target===job.target&&batch.mode===provider.mode&&batch.expectedPhone===(store.state.settings?.expectedPhone||''),'ชุดไฟล์ค้างอ้างอิงบัญชี/ปลายทางเดิม กรุณาตรวจสอบหรือยกเลิกชุดก่อน',409);
    if(batch.items.some(item=>['unknown','submitting'].includes(item.status))){job.enabled=false;job.lastResult='batch_needs_review';await store.save();return {status:'batch_needs_review',batchId:batch.id};}
    for(let index=0;index<batch.items.length;index++){
      const item=batch.items[index];if(item.status!=='pending')continue;
      if(!provider.ready())return {status:'batch_waiting',batchId:batch.id};
      let payload;try{payload=await loadBatchItem(outboxDirectory,batch,item);}catch{job.enabled=false;job.lastResult='batch_snapshot_error';job.lastError='สำเนาชุดไฟล์หาย/เปลี่ยนแปลง ไม่อ่านต้นฉบับใหม่อัตโนมัติ ให้ตรวจสอบข้อมูลสำรองหรือยกเลิกชุด';await store.save();return {status:'batch_snapshot_error',batchId:batch.id};}
      const receipt=await submit(batch.target,payload,{key:`batch:${batch.id}:${index}`,jobId:job.id,name:job.name,dueAt:batch.dueAt,reserved:true,fileInfo:item.file,batchId:batch.id,batchIndex:index+1,onCommit:run=>{item.status='submitting';item.runId=run.id;},onSettled:run=>{item.status=run.status==='not_submitted'?'pending':run.status;item.runId=run.id;if(run.status==='unknown'){job.enabled=false;job.lastResult='batch_needs_review';}}});
      item.status=receipt.status==='not_submitted'?'pending':receipt.status;item.runId=receipt.id;await store.save();
      if(receipt.status==='unknown')return {status:'batch_needs_review',batchId:batch.id};
      if(receipt.status==='not_submitted')return {status:'batch_waiting',batchId:batch.id};
    }
    const reviewedUnknown=batch.items.filter(item=>item.status==='reviewed_unknown').length;job.lastBatch={id:batch.id,status:reviewedUnknown?'complete_with_reviewed_unknown':'complete',total:batch.items.length,submitted:batch.items.filter(item=>['submitted','simulated'].includes(item.status)).length,reviewedUnknown,selection:batch.selection};job.pendingBatch=null;job.nextAt=nextRun(job,now());job.retryAt=null;job.waitUntil=null;job.failures=0;job.lastResult=reviewedUnknown?'batch_complete_reviewed':'batch_complete';job.lastAt=now();if(job.schedule==='once')job.enabled=false;await store.save();await removeBatch(outboxDirectory,batch).catch(()=>{});return {...job.lastBatch,status:job.lastResult};
  }
  async function reviewBatch(job,{reviewedUnknown=false,cancel=false}={}){
    assert(!sendBusy&&!locks.size,'Wait for the active send to finish.',409);const batch=job.pendingBatch;assert(batch,'ไม่มีชุดไฟล์ค้าง',409);
    if(cancel){job.lastBatch={id:batch.id,status:'canceled',total:batch.items.length,pendingCanceled:batch.items.filter(item=>item.status==='pending').length};job.pendingBatch=null;job.enabled=false;job.lastResult='batch_canceled';await store.save();await removeBatch(outboxDirectory,batch).catch(()=>{});return {status:'batch_canceled'};}
    if(batch.items.some(item=>['unknown','submitting'].includes(item.status))){assert(reviewedUnknown,'ตรวจสอบปลายทางแล้วจึงยืนยันข้ามรายการไม่ทราบผล รายการนั้นจะไม่ถูกส่งซ้ำ',409);for(const item of batch.items)if(['unknown','submitting'].includes(item.status))item.status='reviewed_unknown';await store.save();}
    return run(job,{manual:true});
  }
  async function run(job,{manual=false}={}) {
    assert(!locks.has(job.id),'This task is already running.',409);assert(!sendBusy,'Another send is in progress.',409);locks.add(job.id);sendBusy=true;
    const due=job.retryAt||job.nextAt||now();
    try {
      // Preparation can be retried, but no provider call is replayed automatically.
      if(!provider.ready())return {status:'waiting_for_connection'};
      if(job.pendingBatch)return await runPending(job);
      const rendered=await prepare(job);
      if(!provider.ready())return {status:'waiting_for_connection'};
      if(rendered.waiting){job.lastResult='waiting_for_file';job.lastError=rendered.reason;job.waitUntil=now()+30000;await store.save();return {status:'waiting_for_file',reason:rendered.reason};}
      job.waitUntil=null;job.lastError='';
      if(rendered.items){const items=rendered.items.filter(item=>!consumed(job,item.file));if(!items.length){job.lastResult='file_unchanged';job.nextAt=nextRun(job,now());if(job.schedule==='once')job.enabled=false;await store.save();return {status:'skipped',reason:'ไฟล์ที่เลือกทุกเวอร์ชันมีบันทึกการส่งแล้ว'};}job.pendingBatch=await writeBatch(outboxDirectory,{items,mode:provider.mode,target:job.target,expectedPhone:store.state.settings?.expectedPhone||'',dueAt:due,selection:rendered.selection});await store.save();return await runPending(job);}
      if(rendered.file&&consumed(job,rendered.file)){job.lastResult='file_unchanged';job.nextAt=nextRun(job,now());if(job.schedule==='once')job.enabled=false;await store.save();return {status:'skipped',reason:'ไฟล์ล่าสุดเป็นเวอร์ชันที่บันทึกการส่งไว้แล้ว ไม่ส่งซ้ำ'};}
      if(rendered.skip){job.lastResult='no_new_messages';job.nextAt=nextRun(job,now());if(job.schedule==='once')job.enabled=false;await store.save();return {status:'skipped',reason:'No new incoming messages.'};}
      assert(store.state.targets.some(t=>t.jid===job.target&&t.mode===provider.mode),'Destination is not allowed for this mode.',403);
      // Reserve the send lane before preparation; commit source consumption and attempt together.
      const prior={cursor:job.cursor,nextAt:job.nextAt,retryAt:job.retryAt,failures:job.failures,enabled:job.enabled,deferredAttempts:job.deferredAttempts||0,lastFileFingerprint:job.lastFileFingerprint};
      const result=await submit(job.target,rendered.payload||{text:rendered.text},{key:manual?`manual:${job.id}:${randomUUID()}`:`job:${job.id}:${due}:${prior.deferredAttempts}`,jobId:job.id,name:job.name,dueAt:due,reserved:true,fileInfo:rendered.file,onNotSubmitted:()=>{Object.assign(job,prior);job.deferredAttempts=prior.deferredAttempts+1;},onCommit:()=>{
        job.cursor=rendered.cursor;job.nextAt=nextRun(job,now());job.retryAt=null;job.failures=0;job.deferredAttempts=0;if(job.schedule==='once')job.enabled=false;
        if(rendered.file)job.lastFileFingerprint=rendered.consumption;
      }});
      job.lastResult=result.status;job.lastAt=now();if(result.status==='unknown')job.enabled=false;await store.save();return result;
    } catch(error) {
      if(!provider.ready())return {status:'waiting_for_connection'};
      job.lastResult='preparation_failed';job.lastError=error.status?error.message:'Could not prepare the message. Check source, connection and local storage.';job.failures=(job.failures||0)+1;
      if(!manual){if(job.failures>=3){job.enabled=false;job.retryAt=null;}else job.retryAt=now()+60000*2**(job.failures-1);}
      await store.save();throw error;
    } finally {locks.delete(job.id);sendBusy=false;}
  }
  async function tick() {if(ticking||!provider.ready())return;ticking=true;try{for(const job of store.state.jobs)if(job.enabled&&job.mode===provider.mode&&(job.waitUntil||0)<=now()&&(job.retryAt||job.nextAt)<=now())try{await run(job);}catch{}}finally{ticking=false;}}
  async function withLane(operation){assert(!sendBusy&&!locks.size,'Wait for the active send to finish.',409);sendBusy=true;try{return await operation();}finally{sendBusy=false;}}
  return {preview,submit,run,tick,reviewBatch,withLane,isBusy:()=>sendBusy||locks.size>0};
}
