import { assert } from './security.mjs';

const phoneHelp='กรอกเบอร์สากล 8–15 หลัก เช่น +66… หรือ 66… หรือเบอร์มือถือไทย 06/08/09 จำนวน 10 หลัก ไม่ใส่รหัสต่อหรือ JID';
export function normalizeExpectedPhone(value,{allowEmpty=false}={}) {
  assert(typeof value==='string',phoneHelp);
  const raw=value.trim();if(allowEmpty&&raw==='')return '';
  assert(/^[+0-9 ()-]+$/.test(raw),phoneHelp);
  const compact=raw.replace(/[ ()-]/g,'');
  const explicitInternational=compact.startsWith('+');
  let digits=explicitInternational?compact.slice(1):compact;
  // Only the explicitly documented Thai mobile national form receives a country code.
  if(!explicitInternational&&/^0[689]\d{8}$/.test(digits))digits='66'+digits.slice(1);
  assert(/^[1-9]\d{7,14}$/.test(digits),phoneHelp);
  assert(!digits.startsWith('660'),'เบอร์ไทยแบบสากลต้องตัด 0 ตัวแรก เช่น 09… → 669… ไม่ใช้ 6609…');
  return digits;
}

function internationalPhoneJid(value) {
  if(typeof value!=='string')return '';
  const match=/^([1-9]\d{7,14})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/.exec(value);
  return match?.[1]||'';
}
export function verifiedIdentityPhone(identity) {
  if(!identity||typeof identity!=='object')return '';
  const idPhone=internationalPhoneJid(identity.id);
  const explicitPhone=internationalPhoneJid(identity.phoneNumber);
  // A LID is an opaque identifier. Only a separate PN field can establish its phone.
  if(idPhone&&identity.phoneNumber!==undefined&&(!explicitPhone||explicitPhone!==idPhone))return '';
  if(idPhone)return idPhone;
  if(typeof identity.id==='string'&&/^\d+(?::\d+)?@lid$/.test(identity.id))return explicitPhone;
  return '';
}
