import { opendir,lstat,realpath,open } from 'node:fs/promises';
import { isAbsolute,resolve,join,extname,relative,sep } from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { assert } from './security.mjs';
export const maxFileSize=10*1024*1024;
export function normalizeFolder(value) {
  assert(typeof value==='string'&&value.trim().length<=2048,'ระบุ path โฟลเดอร์ในเครื่องที่เปิดแอป');let folder=value.trim();if(folder.startsWith('"')&&folder.endsWith('"'))folder=folder.slice(1,-1);
  assert(isAbsolute(folder)&&!folder.includes('\0'),'ใช้ path โฟลเดอร์แบบเต็มที่ Windows บัญชีนี้เข้าถึงได้ ไม่ใช้ URL หรือ path แบบสัมพัทธ์');return resolve(folder);
}
export function normalizeExtensions(value) {
  const items=Array.isArray(value)?value:typeof value==='string'?value.split(/[,\s]+/):['.pdf'];
  const normalized=[...new Set(items.map(item=>String(item).trim().toLowerCase()).filter(Boolean).map(item=>item.startsWith('.')?item:'.'+item))].sort();
  assert(normalized.length>0&&normalized.length<=16&&normalized.every(item=>/^\.[a-z0-9]{1,10}$/.test(item)),'ระบุนามสกุล 1–16 แบบ เช่น pdf,png,jpg ไม่ใช้ *');return normalized;
}
const signature=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
const within=(parent,child)=>{const path=relative(parent,child);return path===''||(!path.startsWith('..'+sep)&&path!=='..'&&!isAbsolute(path));};
const mime=extension=>({'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.txt':'text/plain','.md':'text/markdown','.html':'text/html','.csv':'text/csv','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[extension]||'application/octet-stream');
class Unavailable extends Error {constructor(message){super(message);this.fileUnavailable=true;}}
const unavailable=message=>{throw new Unavailable(message);};
const inFlight=new Map();
export function fileDayKey(timestamp,timezone='Asia/Bangkok'){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp)).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
export async function readLatestFile(job,options={}){return (await readLatestFiles({...job,fileCount:1},options)).files[0];}
export async function readLatestFiles(job,options={}) {
  const folder=normalizeFolder(job.folder),key=process.platform==='win32'?folder.toLowerCase():folder;
  if(inFlight.has(key)||inFlight.size>=2)unavailable('Windows ยังอ่านโฟลเดอร์ก่อนหน้าไม่เสร็จ โปรดตรวจสอบ OneDrive/เครือข่ายแล้วลองใหม่');
  const controller=new AbortController(),work=readSnapshot(job,{...options,signal:controller.signal});inFlight.set(key,work);
  work.finally(()=>{if(inFlight.get(key)===work)inFlight.delete(key);}).catch(()=>{});
  let timer;try{return await Promise.race([work,new Promise((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Unavailable('อ่านโฟลเดอร์หรือไฟล์ช้าเกินกำหนด โปรดให้ OneDrive เก็บไฟล์ไว้ในเครื่องแล้วลองใหม่'));},options.timeoutMs??15000);})]);}finally{clearTimeout(timer);}
}
async function readSnapshot(job,{now=Date.now(),blockedFolders=[],beforeRead,signal}) {
  let handle;
  const check=()=>{if(signal.aborted)unavailable('หยุดรอการอ่านไฟล์แล้ว โปรดลองใหม่เมื่อ Windows พร้อม');};
  try {
    const folder=await realpath(normalizeFolder(job.folder));check();
    for(const blocked of blockedFolders){let canonical;try{canonical=await realpath(blocked);}catch{canonical=resolve(blocked);}if(within(canonical,folder))unavailable('ไม่อนุญาตใช้โฟลเดอร์ข้อมูลส่วนตัวของแอปเป็นแหล่งไฟล์');}
    check();const extensions=normalizeExtensions(job.extensions);const directory=await opendir(folder);const candidates=[];let count=0;
    for await(const item of directory){check();if(++count>5000)unavailable('โฟลเดอร์มีมากกว่า 5,000 รายการ โปรดใช้โฟลเดอร์ย่อยเฉพาะงาน');if(item.isDirectory()||item.isSymbolicLink()||item.name.startsWith('~$')||!extensions.includes(extname(item.name).toLowerCase()))continue;const path=join(folder,item.name),stat=await lstat(path,{bigint:true});check();if(!stat.isFile()||stat.isSymbolicLink())continue;
      candidates.push({name:item.name,path,stat});
    }
    if(!candidates.length)unavailable('ยังไม่พบไฟล์ที่ตรงกับนามสกุลในโฟลเดอร์นี้');
    candidates.sort((a,b)=>a.stat.mtimeNs>b.stat.mtimeNs?-1:a.stat.mtimeNs<b.stat.mtimeNs?1:a.name<b.name?-1:a.name>b.name?1:0);
    const day=fileDayKey(Number(candidates[0].stat.mtimeMs),job.timezone),group=job.filePeriod==='any'?candidates:candidates.filter(item=>fileDayKey(Number(item.stat.mtimeMs),job.timezone)===day),requestedCount=job.fileCount||1,chosen=group.slice(0,requestedCount),files=[];
    let totalBytes=0;
    for(const selected of chosen){files.push(await snapshot(selected));totalBytes+=files.at(-1).data.length;if(totalBytes>50*1024*1024)unavailable('ชุดไฟล์รวมเกิน 50 MB กรุณาลดจำนวนไฟล์');}
    return {files,requestedCount,availableCount:group.length,day:job.filePeriod==='any'?null:day,shortfall:Math.max(0,requestedCount-files.length)};
    async function snapshot(selected){
      let handle;
      try {
    const {stat,path,name}=selected;const size=Number(stat.size),mtime=Number(stat.mtimeMs);
    if(size<=0)unavailable('ไฟล์ล่าสุดยังว่างอยู่ รอให้เขียนไฟล์เสร็จก่อน');
    if(job.source==='fileText'&&size>65536)unavailable('ไฟล์ TXT เกิน 64 KB กรุณาลดขนาด ไม่ตัดข้อความอัตโนมัติ');
    if(size>maxFileSize)unavailable('ไฟล์ล่าสุดเกิน 10 MB กรุณาลดขนาดหรือเปลี่ยนตัวกรอง');
    if(now-mtime<(job.settleSeconds??30)*1000)unavailable('ไฟล์ล่าสุดยังใหม่หรือกำลังเปลี่ยนแปลง รอให้ไฟล์นิ่งตามระยะที่ตั้งไว้');
    const canonical=await realpath(path);if(!within(folder,canonical))unavailable('ไฟล์เปลี่ยนเส้นทางออกจากโฟลเดอร์ที่เลือก');
    for(const blocked of blockedFolders){let base;try{base=await realpath(blocked);}catch{base=resolve(blocked);}if(within(base,canonical))unavailable('ไม่อนุญาตอ่านไฟล์ข้อมูลส่วนตัวของแอป');}
    check();handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));check();const before=await handle.stat({bigint:true});check();if(!before.isFile()||signature(before)!==signature(stat))unavailable('ไฟล์เปลี่ยนขณะเลือก กรุณาดูตัวอย่างใหม่');
    await beforeRead?.(path);check();
    const chunks=[];let total=0;const stream=handle.createReadStream({autoClose:false,start:0,end:size,highWaterMark:65536,signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
    for await(const chunk of stream){total+=chunk.length;if(total>maxFileSize||total>size)unavailable('ไฟล์เปลี่ยนขนาดขณะอ่าน รอให้เขียนเสร็จก่อน');chunks.push(chunk);}
    const after=await handle.stat({bigint:true}),current=await lstat(path,{bigint:true});check();
    if(total!==size||signature(before)!==signature(after)||signature(before)!==signature(current)||!current.isFile()||current.isSymbolicLink())unavailable('ไฟล์เปลี่ยนขณะอ่าน ยังไม่ได้ส่ง รอให้ไฟล์นิ่งก่อน');
    const data=Buffer.concat(chunks),sha256=createHash('sha256').update(data).digest('hex'),fingerprint=createHash('sha256').update(JSON.stringify([canonical,sha256])).digest('hex');
    return {data,metadata:{name,size,modifiedAt:mtime,sha256,fingerprint},mimetype:mime(extname(name).toLowerCase())};
      }finally{if(handle)await handle.close().catch(()=>{});}
    }
  }catch(error){if(error.fileUnavailable)throw error;unavailable('อ่านโฟลเดอร์หรือไฟล์ล่าสุดไม่ได้ ตรวจสอบสิทธิ์และให้ OneDrive เก็บไฟล์ไว้ในเครื่อง แล้วลองใหม่');}
}
