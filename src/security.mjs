import { timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
export function assert(value, message, status=400) { if (!value) throw Object.assign(new Error(message), {status}); }
export function same(a,b) { const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||'')); return x.length===y.length && timingSafeEqual(x,y); }
export function passwordHash(password, salt=randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password,salt,32).toString('hex')}`; }
export function verifyPassword(password, hash) { if(!hash) return false; return same(passwordHash(password,hash.split(':')[0]), hash); }
export function targetJid(input) { assert(typeof input==='string' && /^(?:[0-9]{6,20}@s\.whatsapp\.net|[0-9]{5,30}(?:-[0-9]{5,20})?@g\.us|[0-9]{5,30}@lid)$/.test(input),'Use an international phone JID, observed contact JID or group JID.'); return input; }
export function publicIP(ip) {
  if(isIP(ip)===4) { const [a,b]=ip.split('.').map(Number); return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,2,168].includes(b)||a===100&&b>=64&&b<=127||a>=224||a===198&&[18,19,51].includes(b)||a===203&&b===0); }
  return isIP(ip)===6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^(2001:(?:db8|0|10|20):|2002:)/i.test(ip);
}
export async function fetchJSON(raw, hosts, resolver=lookup) {
  const url=new URL(raw);
  assert(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443'),'JSON source requires HTTPS port 443 without credentials.');
  assert(!isIP(url.hostname)&&hosts.includes(url.hostname.toLowerCase()),'Allow the exact JSON API hostname in settings first.');
  const addresses=await resolver(url.hostname,{all:true,verbatim:true});
  assert(addresses.length&&addresses.every(x=>publicIP(x.address)),'Private, local and special-use addresses are blocked.');
  const address=addresses[0];
  const text=await new Promise((resolve,reject)=>{
    const request=https.get(url,{timeout:10000,headers:{accept:'application/json'},lookup:(_h,o,cb)=>o.all?cb(null,[address]):cb(null,address.address,address.family)},response=>{
      if(response.statusCode!==200) {response.resume(); reject(new Error(`JSON endpoint returned HTTP ${response.statusCode}; redirects are blocked.`));return;}
      let size=0;const chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>1048576) request.destroy(new Error('JSON response exceeds 1 MB.'));else chunks.push(chunk);});
      response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));response.on('error',reject);
    });request.on('timeout',()=>request.destroy(new Error('JSON source timed out.')));request.on('error',reject);
  });
  try {return JSON.parse(text);} catch {throw new Error('Source returned invalid JSON.');}
}
export function attachment(input) {
  assert(typeof input.base64==='string'&&input.base64.length<=13981016&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64),'Invalid base64 attachment (maximum 10 MB).');
  const document=Buffer.from(input.base64,'base64');assert(document.length>0&&document.length<=10485760,'File must be between 1 byte and 10 MB.');
  const mimetype=String(input.mimetype||'application/octet-stream');assert(/^[\w.+-]+\/[\w.+-]+$/.test(mimetype),'Invalid MIME type.');
  return {document,mimetype,fileName:String(input.fileName||'attachment').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').slice(0,120),caption:String(input.caption||'').slice(0,4000)};
}
