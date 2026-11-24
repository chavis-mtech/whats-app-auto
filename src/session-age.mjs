import {createHash,randomUUID} from 'node:crypto';
export function pairingIdentity(creds){try{const value=creds?.signedIdentityKey?.public;if(!value)return '';return createHash('sha256').update(Buffer.from(value)).digest('hex');}catch{return '';}}
export function hasLinkedAuth(creds){return creds?.registered===true||!!(pairingIdentity(creds)&&creds?.account?.details&&creds.account.accountSignature&&creds.account.deviceSignature);}
export function notePairingCandidate(store,creds,account,now=Date.now()){
  const identity=pairingIdentity(creds);if(!identity||creds.registered===true||creds.me?.id)return false;
  store.state.pairingCandidate={id:randomUUID(),identity,account,observedQrAt:now};return true;
}
export function confirmObservedPairing(store,creds,account,now=Date.now()){
  const pending=store.state.pairingCandidate;if(!pending?.pairSuccessObserved||pending.account!==account||pending.successAccount!==account||!Number.isFinite(pending.pairSuccessAt)||pending.pairSuccessAt>now||pending.identity!==pairingIdentity(creds))return false;
  store.state.sessionInfo={id:pending.id,account,pairedAt:pending.pairSuccessAt,evidence:'observed_fresh_qr_pair_success_and_authenticated_open'};store.state.pairingCandidate=null;store.state.sessionNotice=null;store.state.sessionNoticeMap={};return true;
}
export function sessionAgeInfo(state,now=Date.now()){
  const info=state.sessionInfo,expected=state.settings.expectedPhone;const known=state.settings.mode==='live'&&info?.account===expected&&typeof info.id==='string'&&Number.isFinite(info.pairedAt)&&info.pairedAt<=now;
  const days=known?Math.floor((now-info.pairedAt)/86400000):null,key=known?`session-age:${info.id}:10:${state.settings.sessionNotifyTarget}`:'',notice=state.sessionNoticeMap?.[key]||(state.sessionNotice?.key===key?state.sessionNotice:null);return {known,days,pairedAt:known?info.pairedAt:null,warn:known&&days>=10,thresholdDays:10,notice:notice?{status:notice.status,target:notice.target,createdAt:notice.createdAt}:null};
}
export function createSessionMonitor({store,provider,jobs,now=Date.now}){
  let busy=false;
  async function tick(){if(busy||jobs.isBusy()||provider.mode!=='live'||!provider.ready())return;const settings=store.state.settings,age=sessionAgeInfo(store.state,now());if(!settings.sessionNotifyEnabled||!age.warn||!store.state.targets.some(item=>item.mode==='live'&&item.jid===settings.sessionNotifyTarget))return;
    const key=`session-age:${store.state.sessionInfo.id}:10:${settings.sessionNotifyTarget}`;let notice=store.state.sessionNoticeMap?.[key]||(store.state.sessionNotice?.key===key?store.state.sessionNotice:null);
    if(notice?.key===key&&['submitted','unknown','simulated'].includes(notice.status))return;
    const sessionId=store.state.sessionInfo.id,target=settings.sessionNotifyTarget,account=settings.expectedPhone;
    const permitted=()=>store.state.settings.mode==='live'&&store.state.settings.sessionNotifyEnabled===true&&store.state.settings.sessionNotifyTarget===target&&store.state.settings.expectedPhone===account&&store.state.sessionInfo?.id===sessionId&&store.state.targets.some(item=>item.mode==='live'&&item.jid===target);
    busy=true;try{await jobs.withLane(async()=>{if(!permitted())return;if(notice?.key!==key){const previous=store.state.runs.find(run=>run.key===key&&['submitted','simulated','unknown'].includes(run.status));notice=previous?{key,target,createdAt:previous.startedAt,status:previous.status,runId:previous.id}:{key,target,createdAt:now(),status:'queued',text:'แจ้งเตือน WhatsApp Auto: บัญชีนี้เชื่อมโยงมาแล้ว '+age.days+' วัน อาจหลุดได้ กรุณาตรวจสอบอุปกรณ์ที่เชื่อมโยงและการเชื่อมต่อ อายุนี้ไม่ใช่วันหมดอายุที่ WhatsApp ยืนยัน'};store.state.sessionNoticeMap||={};store.state.sessionNoticeMap[key]=notice;store.state.sessionNotice=notice;await store.save();if(previous)return;}else store.state.sessionNotice=notice;
      store.state.sessionNoticeMap||={};store.state.sessionNoticeMap[key]=notice;
      if(!permitted()){notice.status='canceled';await store.save();return;}
      const result=await jobs.submit(notice.target,{text:notice.text},{key:notice.key,name:'Session age reminder',reserved:true,canInvoke:permitted,onCommit:()=>{notice.status='submitting';},onSettled:receipt=>{notice.status=receipt.status==='not_submitted'?(permitted()?'queued':'canceled'):receipt.status;notice.runId=receipt.id;}});notice.status=result.status==='not_submitted'?(permitted()?'queued':'canceled'):result.status;notice.runId=result.id;await store.save();});
    }catch{if(notice?.status==='submitting')notice.status='unknown';await store.save().catch(()=>{});}finally{busy=false;}}
  return {tick,info:()=>sessionAgeInfo(store.state,now())};
}
