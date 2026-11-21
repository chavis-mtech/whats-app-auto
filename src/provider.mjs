import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assert } from './security.mjs';
import { normalizeExpectedPhone,verifiedIdentityPhone } from './phone.mjs';

export class WhatsAppProvider extends EventEmitter {
  constructor(store,directory,{loadBaileys=()=>import('@whiskeysockets/baileys')}={}) { super();this.store=store;this.directory=directory;this.loadBaileys=loadBaileys;this.status='disconnected';this.qr='';this.groups=[];this.socket=null;this.active=false;this.retries=0;this.generation=0;this.authWrites=Promise.resolve(); }
  get mode() {return this.store.state.settings.mode;}
  info() {return {mode:this.mode,status:this.status,qr:!!this.qr,account:this.account||'',contactsScope:'Synced and observed contacts only; not the full phone address book.',lastError:this.lastError||''};}
  async capture(message) {
    if(this.store.state.messages.some(m=>m.id===message.id&&m.jid===message.jid)) return;
    message.seq=++this.store.state.messageSequence;
    this.store.state.messages.push(message);this.store.state.messages=this.store.state.messages.slice(-this.store.state.settings.retention);await this.store.save();this.emit('message',message);
  }
  credentialMatches(creds) {let expected;try{expected=normalizeExpectedPhone(this.store.state.settings.expectedPhone);}catch{return false;}return creds?.registered===true&&verifiedIdentityPhone(creds.me)===expected&&this.store.state.confirmedAccount===expected;}
  async disableResume(message) {this.store.state.settings.autoResume=false;this.lastError=message;await this.store.save();}
  async resumeOnStartup() {
    if(this.mode!=='live'||this.store.state.settings.autoResume!==true)return {attempted:false,reason:'disabled'};
    let creds;try{this.store.state.settings.expectedPhone=normalizeExpectedPhone(this.store.state.settings.expectedPhone);creds=JSON.parse(await readFile(join(this.directory,'auth','creds.json'),'utf8'));}catch{}
    if(!this.credentialMatches(creds)){
      this.status='needs_pairing';await this.disableResume('Automatic resume was disabled: no valid previously confirmed linked session. Open Connect to pair manually.');return {attempted:false,reason:'invalid_session'};
    }
    await this.connect({resumeOnly:true});return {attempted:this.active,reason:this.active?'resuming':'blocked'};
  }
  async connect({resumeOnly=false}={}) {
    if(this.active) return this.info();
    if(this.mode==='live')this.store.state.settings.expectedPhone=normalizeExpectedPhone(this.store.state.settings.expectedPhone);
    this.active=true;const generation=++this.generation;this.lastError='';
    if(this.mode==='demo') {
      this.status='demo';this.groups=[{id:'120363000000001@g.us',name:'ทีมงานตัวอย่าง',size:3},{id:'120363000000002@g.us',name:'รายงานประจำวัน · ตัวอย่าง',size:5}];
      for(const c of [{id:'66800000001@s.whatsapp.net',name:'คุณมะลิ · ตัวอย่าง',source:'demo'},{id:'66800000002@s.whatsapp.net',name:'คุณต้น · ตัวอย่าง',source:'demo'}]) if(!this.store.state.contacts.some(x=>x.id===c.id)) this.store.state.contacts.push(c);
      if(!this.store.state.messages.length) await this.capture({id:'demo-welcome',jid:this.groups[0].id,text:'ยอดขายวันนี้ 12,500 บาท พร้อมสรุปรายงานแล้ว',time:Date.now(),fromMe:false,mode:'demo'});
      await this.store.save();return this.info();
    }
    this.status='connecting';await this.store.save();if(!this.active||generation!==this.generation)return this.info();await this.openSocket(generation,resumeOnly);return this.info();
  }
  async openSocket(generation,resumeOnly=false) {
    try {
      const {default:makeWASocket,useMultiFileAuthState,DisconnectReason,jidNormalizedUser,normalizeMessageContent}=await this.loadBaileys();
      if(!this.active||generation!==this.generation)return;
      const {state,saveCreds}=await useMultiFileAuthState(join(this.directory,'auth'));
      if(!this.active||generation!==this.generation)return;
      if(resumeOnly&&(!this.store.state.settings.autoResume||!this.credentialMatches(state.creds))){this.disconnect();this.status='needs_pairing';await this.disableResume('Automatic resume was disabled because the saved account/session changed. Pair manually.');return;}
      const logger={level:'silent',child(){return this;},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}};
      const sock=makeWASocket({auth:state,logger,markOnlineOnConnect:false,syncFullHistory:false,browser:['WhatsApp Auto','Chrome','1.0.0']});this.socket=sock;
      const valid=()=>this.active&&generation===this.generation&&this.socket===sock;
      sock.ev.on('creds.update',()=>{this.authWrites=this.authWrites.then(async()=>{if(valid())await saveCreds();}).catch(()=>{this.lastError='Could not save linked-device credentials. Disconnect and check storage.';});});
      const contacts=async(items)=>{if(!valid())return;for(const c of items){if(!c.id)continue;const id=jidNormalizedUser(c.id);const old=this.store.state.contacts.find(x=>x.id===id);const item={id,name:c.name||c.notify||c.verifiedName||old?.name||id,source:'synced/observed'};if(old)Object.assign(old,item);else this.store.state.contacts.push(item);}this.store.state.contacts=this.store.state.contacts.slice(-2000);await this.store.save();};
      sock.ev.on('contacts.upsert',x=>contacts(x).catch(()=>{}));sock.ev.on('contacts.update',x=>contacts(x).catch(()=>{}));
      sock.ev.on('messaging-history.set',({contacts:items=[]})=>contacts(items).catch(()=>{}));
      sock.ev.on('messages.upsert',async({messages,type})=>{if(!valid()||this.status!=='connected')return;try{for(const m of messages){if(!m.key?.remoteJid||m.key.remoteJid==='status@broadcast')continue;const body=normalizeMessageContent(m.message);const media=body?.documentMessage||body?.imageMessage||body?.videoMessage||body?.audioMessage;
        const item={id:m.key.id,jid:m.key.remoteJid,text:body?.conversation||body?.extendedTextMessage?.text||media?.caption||'',time:Number(m.messageTimestamp||Date.now()/1000)*1000,fromMe:!!m.key.fromMe,mode:'live',history:type!=='notify',media:media?{fileName:media.fileName||'media',mimetype:media.mimetype||'application/octet-stream'}:undefined};
        await this.capture(item);if(m.pushName&&!item.fromMe)await contacts([{id:m.key.participant||item.jid,notify:m.pushName}]);
      }}catch{this.lastError='A message could not be saved. Check local storage.';}});
      sock.ev.on('messages.update',async updates=>{if(!valid())return;let changed=false;for(const {key,update} of updates){if(Number(update.status)>=3){for(const run of this.store.state.runs)if(run.messageId===key.id){run.delivery=Number(update.status)>=4?'read':'delivered';changed=true;}}}if(changed)await this.store.save().catch(()=>{});});
      sock.ev.on('connection.update',async update=>{
        if(!valid())return;
        if(update.qr){if(resumeOnly){this.disconnect();this.status='needs_pairing';await this.disableResume('The linked session requires pairing. Automatic resume was disabled; open Connect manually.');return;}this.qr=update.qr;this.status='qr';}
        if(update.connection==='open'){
          const number=verifiedIdentityPhone(sock.user);
          if(!number||number!==this.store.state.settings.expectedPhone){this.disconnect();this.store.state.confirmedAccount='';await this.disableResume(number?'เบอร์บัญชีที่เชื่อมต่อไม่ตรงกับเบอร์ที่ตั้งค่าไว้ โปรดตรวจสอบรูปแบบเบอร์ (เบอร์ไทยตัด 0 หน้าแล้วใส่ 66) และบัญชีบนโทรศัพท์ แก้ไขเบอร์แล้วลองเชื่อมต่ออีกครั้ง โดยยังไม่ต้องลบเซสชัน':'ยังยืนยันเบอร์บัญชีที่เชื่อมต่อไม่ได้ ระบบได้รับรหัส LID หรือข้อมูลที่ไม่ใช่เบอร์โทร โปรดตรวจสอบบัญชีบนโทรศัพท์แล้วลองเชื่อมต่ออีกครั้ง โดยยังไม่ต้องลบเซสชัน');return;}
          this.store.state.confirmedAccount=number;await this.store.save();if(!valid())return;
          this.account=number;this.status='connected';this.qr='';this.retries=0;try{await this.refreshGroups();}catch{this.lastError='Connected; group refresh failed. Try refreshing again.';}
        }
        if(update.connection==='close'){
          this.qr='';const code=update.lastDisconnect?.error?.output?.statusCode;
          if(code===DisconnectReason.loggedOut){this.active=false;this.status='logged_out';this.store.state.confirmedAccount='';await this.disableResume('Device was logged out. Automatic resume was disabled. Unlink/reset the local session before pairing again.');return;}
          this.status='reconnecting';if(++this.retries>6){this.active=false;this.status='disconnected';this.lastError='Reconnect attempts exhausted. Click Connect to retry.';return;}
          this.timer=setTimeout(()=>{if(valid())this.openSocket(generation,resumeOnly);},Math.min(30000,1000*2**this.retries));this.timer.unref();
        }
      });
    } catch {this.active=false;this.status='disconnected';this.lastError='Connection could not start. Check internet and local session permissions.';}
  }
  disconnect() {this.active=false;this.generation++;clearTimeout(this.timer);this.socket?.end(new Error('Local disconnect'));this.socket=null;this.status='disconnected';this.qr='';this.account='';this.groups=[];}
  async refreshGroups() {assert(this.mode==='demo'||this.status==='connected','Connect WhatsApp first.',409);if(this.mode==='live'){const generation=this.generation,socket=this.socket;const groups=await socket.groupFetchAllParticipating();if(!this.active||this.mode!=='live'||this.status!=='connected'||generation!==this.generation||socket!==this.socket)return this.groups;this.groups=Object.values(groups).map(g=>({id:g.id,name:g.subject,size:g.participants.length}));}return this.groups;}
  ready() {return this.mode==='demo'?this.status==='demo':this.status==='connected';}
  async send(jid,payload) {
    assert(this.ready(),'WhatsApp is not connected.',409);
    if(this.mode==='demo') {const id=`demo-${randomUUID()}`;await this.capture({id,jid,text:payload.text||payload.caption||'',media:payload.document?{fileName:payload.fileName,mimetype:payload.mimetype}:undefined,time:Date.now(),fromMe:true,mode:'demo'});return {id,status:'simulated'};}
    const result=await this.socket.sendMessage(jid,payload);assert(result?.key?.id,'Provider returned no message ID.',502);
    return {id:result.key.id,status:'submitted'};
  }
}
