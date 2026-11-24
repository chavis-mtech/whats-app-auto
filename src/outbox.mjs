import {mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assert} from './security.mjs';
const digest=data=>createHash('sha256').update(data).digest('hex');
function location(root,id){assert(typeof root==='string'&&/^[0-9a-f-]{36}$/.test(id),'Invalid private outbox location.');const base=resolve(root),path=resolve(base,id);assert(path.startsWith(base+sep),'Outbox path escaped private storage.');return path;}
export async function writeBatch(root,{items,...details}){
  const id=randomUUID(),folder=location(root,id);await mkdir(folder,{recursive:true,mode:0o700});
  const manifest={id,...details,createdAt:Date.now(),items:[]};
  try{for(let index=0;index<items.length;index++){const item=items[index],bytes=item.payload.document||Buffer.from(item.payload.text,'utf8'),storage=`${index}.bin`;await writeFile(join(folder,storage),bytes,{flag:'wx',mode:0o600});const {document,text,...rest}=item.payload;manifest.items.push({file:item.file,payload:rest,output:document?'document':'text',storage,size:bytes.length,digest:digest(bytes),status:'pending'});}return manifest;}
  catch(error){await rm(folder,{recursive:true,force:true});throw error;}
}
export async function loadBatchItem(root,batch,item){assert(/^\d{1,2}\.bin$/.test(item.storage),'Invalid outbox filename.');const path=join(location(root,batch.id),item.storage),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===item.size&&stat.size<=10*1024*1024,'Invalid private snapshot size/type.',409);const bytes=await readFile(path);assert(bytes.length===item.size&&bytes.length<=10*1024*1024&&digest(bytes)===item.digest,'สำเนาไฟล์ใน outbox หายหรือเปลี่ยนแปลง กรุณายกเลิกชุดและตรวจสอบข้อมูลสำรอง',409);return item.output==='text'?{...item.payload,text:bytes.toString('utf8')}:{...item.payload,document:bytes};}
export async function removeBatch(root,batch){await rm(location(root,batch.id),{recursive:true,force:true});}
