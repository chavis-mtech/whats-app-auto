import { assert } from './security.mjs';
const tokens=['YYYY','yyyy','BBBB','MMMM','dddd','MMM','ddd','YY','yy','BB','MM','DD','dd','HH','mm','ss','M','D','d','H','m','s'];
export function formatDatePattern(date,pattern,{timezone='Asia/Bangkok',locale='th-TH'}={}) {
  pattern=String(pattern).trim();if((pattern[0]==="'"&&pattern.at(-1)==="'")||(pattern[0]==='"'&&pattern.at(-1)==='"'))pattern=pattern.slice(1,-1);
  assert(pattern.length>0&&pattern.length<=120,'รูปแบบวันที่ต้องมี 1–120 ตัวอักษร');
  assert(['th-TH','en-GB'].includes(locale),'Unsupported date locale.');
  const options={timeZone:timezone,calendar:'gregory',numberingSystem:'latn'};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{...options,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date)).map(part=>[part.type,part.value]));
  const year=parts.year,buddhist=String(Number(year)+543),short=part=>String(Number(part));
  const value={YYYY:year,yyyy:year,YY:year.slice(-2),yy:year.slice(-2),BBBB:buddhist,BB:buddhist.slice(-2),MM:parts.month,M:short(parts.month),DD:parts.day,dd:parts.day,D:short(parts.day),d:short(parts.day),HH:parts.hour,H:short(parts.hour),mm:parts.minute,m:short(parts.minute),ss:parts.second,s:short(parts.second)};
  for(const [token,field,width] of [['MMMM','month','long'],['MMM','month','short'],['dddd','weekday','long'],['ddd','weekday','short']])value[token]=new Intl.DateTimeFormat(locale,{...options,[field]:width}).format(new Date(date));
  let output='';for(let index=0;index<pattern.length;){if(pattern[index]==='['){const end=pattern.indexOf(']',index+1);assert(end>index&&end-index<=41,'ข้อความคงที่ในวันที่ใช้ [ข้อความ] สูงสุด 40 ตัวอักษร');output+=pattern.slice(index+1,end);index=end+1;continue;}const token=tokens.find(token=>pattern.startsWith(token,index));if(token){output+=value[token];index+=token.length;continue;}assert(/[ /.,:_()\-]/.test(pattern[index]),'รูปแบบวันที่ใช้ YYYY/BBBB/MM/DD/HH/mm/ss และ MMMM/ddd เท่านั้น ใส่ข้อความอื่นใน [วงเล็บ]');output+=pattern[index++];}
  assert(output.length<=300,'Formatted date exceeds the limit.');return output;
}
export function renderDateTemplates(template,context) {
  let count=0;const expected=(template.match(/<date\.format\(|\{\{date:/g)||[]).length;
  const output=template.replace(/<date\.format\(([^\r\n]{1,150}?)\)>|\{\{date:([^{}\r\n]{1,150})\}\}/g,(_match,legacy,modern)=>{assert(++count<=20,'ใช้รูปแบบวันที่ได้สูงสุด 20 จุดต่อข้อความ');return formatDatePattern(context.date,legacy||modern,context);});
  assert(count===expected,'รูปแบบวันที่ไม่สมบูรณ์ ใช้ <date.format(DD/MM/YYYY)> หรือ {{date:DD/MM/YYYY}}');return output;
}
