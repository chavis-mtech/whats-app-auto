import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createApplication} from '../src/server.mjs';

test('desktop and mobile Thai UI complete onboarding, text/file send, job preview/edit/run and settings',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'waa-browser-'));const app=await createApplication({directory,port:0});const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const failures=[];page.on('pageerror',error=>failures.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${app.port}`);await page.getByLabel('สร้างรหัสผ่าน').fill('browser-test-password');await page.getByLabel('ยืนยันรหัสผ่าน').fill('browser-test-password');await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน',exact:true}).click();
    await page.getByRole('heading',{name:'ทุกข้อความ พร้อมเป็นเรื่องง่าย.'}).waitFor();
    await page.getByRole('button',{name:'เปิดพื้นที่สาธิต',exact:true}).click();await page.getByRole('button',{name:'เพิ่มผู้รับ',exact:true}).first().click();
    await page.getByRole('button',{name:'ส่งข้อความ',exact:true}).click();await page.getByLabel('ส่งถึง',{exact:true}).selectOption('120363000000001@g.us');await page.getByLabel('ข้อความ',{exact:true}).fill('UI synthetic text: สวัสดี');await page.getByRole('button',{name:'ส่งข้อความในโหมดสาธิต',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='ส่งในระบบสาธิต');
    await page.getByLabel('ส่งถึง',{exact:true}).selectOption('120363000000001@g.us');await page.getByLabel('ข้อความ',{exact:true}).fill('UI synthetic attachment');await page.getByLabel('แนบไฟล์').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic only')});await page.getByRole('button',{name:'ส่งข้อความในโหมดสาธิต',exact:true}).click();
    await page.getByRole('button',{name:/^งานอัตโนมัติ/}).click();await page.getByRole('button',{name:'สร้างงานอัตโนมัติ',exact:true}).click();
    await page.getByLabel('ชื่องาน',{exact:true}).fill('UI daily report');await page.getByLabel('ปลายทาง',{exact:true}).selectOption('120363000000001@g.us');await page.getByLabel('ข้อความ / เทมเพลต',{exact:true}).fill('UI scheduled test {{now}}');await page.getByRole('button',{name:'ดูตัวอย่าง',exact:true}).click();await page.locator('#job-preview').filter({hasText:'UI scheduled test'}).waitFor();await page.getByRole('button',{name:'สร้างงาน',exact:true}).click();
    await page.getByRole('button',{name:'แก้ไข UI daily report',exact:true}).click();await page.getByRole('button',{name:'เรียกใช้ตอนนี้',exact:true}).click();await page.getByRole('button',{name:'ประวัติการส่ง',exact:true}).click();await page.getByText('UI daily report',{exact:true}).waitFor();assert.equal(app.store.state.runs.length,3);
    await page.getByRole('button',{name:'กล่องข้อความ',exact:true}).click();await page.getByText('UI synthetic text: สวัสดี',{exact:true}).waitFor();
    await page.getByRole('button',{name:'ภาพรวม',exact:true}).click();await page.evaluate(()=>document.querySelector('#toast').style.display='none');await mkdir(resolve('docs/screenshots'),{recursive:true});await page.screenshot({path:resolve('docs/screenshots/desktop.png'),fullPage:true});
    const horizontal=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(horizontal,false);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('docs/screenshots/mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'เชื่อมต่อ API',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert(await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).isVisible());
    await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click();assert.equal(await page.getByLabel('เชื่อมต่อบัญชีเดิมอัตโนมัติเมื่อเปิดแอป',{exact:true}).isChecked(),false);await page.getByLabel('โหมดการใช้งาน',{exact:true}).selectOption('live');await page.getByLabel('เบอร์บัญชี WhatsApp ที่คาดหวัง',{exact:true}).fill('0912345678');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#content')?.textContent.includes('ข้อมูลตัวอย่างทั้งหมด'));
    await page.waitForFunction(()=>document.querySelector('[name=expectedPhone]')?.value==='66912345678');assert.equal(app.store.state.settings.mode,'live');assert.equal(app.store.state.settings.expectedPhone,'66912345678');assert.equal(await page.getByLabel('เบอร์บัญชี WhatsApp ที่คาดหวัง',{exact:true}).inputValue(),'66912345678');assert.equal(app.provider.active,false);assert.deepEqual(failures,[]);
  } finally {await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
});
