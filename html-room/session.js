import { Group } from '../lib/group.js';
import { checkKeys, checkEnvelope, checkMessage, envelope } from '../lib/state.js';
import { hex, random, sealAnnouncement, openAnnouncement } from './crypto.js';
import { MAX_MEMBERS } from '../src/limits.js';
// Receipts per seen frame: a count of messages, not of members.
const RECEIPTS_PER_FRAME = 25;
export const memoryStorage = () => new Map();
// Explicit injection for tests only; no browser persistence API is used.
export class Session {
  // batchMs: how long owed keys are gathered before sending (0: at once).
  constructor(derived, config, {storage=memoryStorage(),emit=()=>{},batchMs=300}={}) {
    Object.assign(this,{d:derived,config,store:storage,emit,batchMs,deviceId:hex(random(16)),present:[],pins:new Map(),seen:new Map(),own:new Map(),queued:[],receipts:[],received:new Map(),group:null,ws:null,serial:Promise.resolve()});
    this.store.set('deviceId',this.deviceId);
  }
  run(fn) { this.serial=this.serial.then(()=>{if(!this.stopped)return fn();}).catch(()=>this.emit('notice','收到一条无法验证的数据，已忽略。'));return this.serial; }
  send(frame) { if(!this.stopped && this.ws?.readyState===1)this.ws.send(JSON.stringify(frame)); }
  // to: with hello, ask only these members (see helloDue); without, ask all.
  async announce(hello=false, to=null) {
    if(!this.group)return;
    const owed=this.group.owed(this.present);
    if(!hello && !owed.length)return;
    const texts=await this.group.announceAll(owed,hello);
    for(const [i,text] of texts.entries()){
      // Key wraps are for the members listed in w: the relay hands such a frame
      // to them only (to), instead of copying ~1.5 KB of ML-KEM to the whole
      // room. Only a hello (the first frame) is for everyone.
      const wraps=Object.keys(JSON.parse(text).w).filter(k=>/^\d+$/.test(k)).map(Number);
      const dest=hello&&i===0?(to?[...new Set([...to,...wraps])]:null):wraps;
      if(dest&&!dest.length)continue;
      this.send({type:'key',...await sealAnnouncement(this.d,text),...(dest&&{to:dest})});
    }
  }
  // Keys owed because someone new was just heard from: gathered for a moment
  // so a burst of arrivals goes out in a few frames, not one per arrival.
  scheduleAnnounce(){
    if(this.announceTimer||this.stopped)return;
    this.announceTimer=setTimeout(()=>{this.announceTimer=null;this.run(async()=>{await this.announce();await this.update();});},this.batchMs);
    this.announceTimer?.unref?.();
  }
  // A hello (ask everyone to answer) is due: soon while someone present is
  // still unknown, otherwise at the slow background pace.
  // Who to ask again, if anyone: members present whose chain (with ML-KEM)
  // has not arrived. A hello makes every receiver hand its chain again, so it
  // goes only to them — a hello to the whole room at intervals would make all
  // n members re-send to each asker, O(n²) frames per round. Once every chain
  // is in, nothing is sent on a timer.
  helloDue(now=Date.now()) {
    if(!this.group || now-(this.lastAnnounce??0) < Math.max(5000, 200*this.present.length))return null;
    const g=this.group, need=this.present.filter(n=>{
      if(n===g.me)return false;
      const p=g.peers.get(n);
      return !p || !p.recv || (p.v===32 && !(p.ss && p.pqIn));
    });
    return need.length ? need : null;
  }
  ready() { return !this.stopped && this.group && this.present.length>1 && this.group.ready(this.present,true) && this.group.quantumSafe(this.present); }
  async incoming(m) {
    if(this.stopped)return;
    if(m.type==='pong'){this.lastPong=Date.now();return;}
    if(m.type==='wait'){this.nextSend=Date.now()+Math.min(30000,Math.max(1000,m.ms||6000));return;}
    if(m.type==='hello') {
      this.resume=m.resume;
      if(!this.group || this.group.me!==m.you){this.group=await Group.create(this.d.key,this.d.bind,m.you);this.own.clear();this.received.clear();this.receipts=[];this.present=[];}
      await this.announce(true);this.lastAnnounce=Date.now();return;
    }
    if(!this.group)return;
    if(m.type==='members') {
      if(!Array.isArray(m.members) || m.members.some(n=>!Number.isInteger(n)||n<1||n>MAX_MEMBERS))return;
      const left=this.present.filter(n=>!m.members.includes(n));
      for(const n of left){this.group.forget(n);if(this.config.version===3)this.pins.delete(n);for(const key of this.received.keys())if(key.startsWith(`${n}|`))this.received.delete(key);}
      this.present=m.members;
      // Only what is owed: a newcomer's own hello asks everyone for their keys,
      // so a hello from every member at every arrival would only multiply
      // traffic (O(n²) frames, each copied to n). Missing keys are asked for by
      // the tick (helloDue).
      if(left.length)await this.group.rekey();
      await this.announce();this.emit('presence',this.present.length);await this.update();return;
    }
    if(m.from===this.group.me) {
      const own=this.own.get(m.h);
      if(m.type==='msg' && own && own.frame.iv===m.iv && own.frame.ct===m.ct){own.echo=true;this.emit('delivery',{id:own.id,text:'已发出'});}
      return;
    }
    if(!this.present.includes(m.from))return;
    if(m.type==='key') {
      const a=checkKeys(await openAnnouncement(this.d,m),m,this.seen);
      if(!a || a.v!==32 || !a.spk)return;
      const pinned=this.pins.get(m.from);
      const p=await this.group.receive(a,m.from); // verifies ECDSA before pinning
      if(!p)return;
      if(pinned && pinned!==p.spk){this.halt();this.emit('fatal','有成员的身份变了，可能有人冒充。请打电话等方式确认后，重新打开房间。');return;}
      this.pins.set(m.from,p.spk);
      if(p?.lost)p.sent=-1;
      if(this.batchMs)this.scheduleAnnounce();else await this.announce();
      await this.update();return;
    }
    if(!['msg','seen'].includes(m.type) || !m.h)return;
    const receiptKey=`${m.from}|${m.h}`, prior=this.received.get(receiptKey);
    if(prior){if(m.type==='msg' && prior.iv===m.iv && prior.ct===m.ct && this.receipts.length<100)this.receipts.push([m.from,m.h]);return;}
    const opened=await this.group.open(m,m.from);
    if(!opened.signed || this.group.peers.get(m.from)?.v!==32)return;
    if(m.type==='seen') {
      const a=checkKeys(opened.text,m,this.seen,Date.now(),'seen');
      if(a && Array.isArray(a.l) && a.l.length<=RECEIPTS_PER_FRAME)for(const item of a.l){
        if(!Array.isArray(item) || item[0]!==this.group.me)continue;
        const own=this.own.get(item[1]);
        if(own && own.targets.includes(m.from)){own.confirmed.add(m.from);this.emit('delivery',{id:own.id,text:`已送达 ${own.confirmed.size}/${own.targets.length}`});}
      }
    } else {
      const got=checkEnvelope(opened.text,m,this.seen);
      if(!got || got.g || got.f)return;
      this.received.set(receiptKey,{iv:m.iv,ct:m.ct});while(this.received.size>200)this.received.delete(this.received.keys().next().value);
      this.emit('message',{id:got.id,from:m.from,text:got.text});
      if(this.receipts.length<100)this.receipts.push([m.from,m.h]);
    }
  }
  async update() {
    if(this.ready())this.emit('ready',await this.group.safetyCode(this.present));
    await this.flush();
  }
  queue(text) {
    if(this.stopped)return false;
    text=checkMessage(text);if(!text || this.queued.length>=20)return false;
    const id=hex(random(8));this.queued.push({id,text});this.emit('message',{id,from:'我',text});this.emit('delivery',{id,text:'发送中……'});
    this.run(()=>this.flush());return true;
  }
  async flush() {
    if(!this.ready() || this.ws?.readyState!==1)return;
    if(this.group.due()){await this.group.rekey();await this.announce();}
    if(!this.ready())return;
    if(this.receipts.length){
      const plain=JSON.stringify({kind:'seen',id:hex(random(8)),from:this.group.me,t:Date.now(),l:this.receipts.splice(0,RECEIPTS_PER_FRAME)});
      this.send({type:'seen',...await this.group.seal(plain)});
    }
    // Match the existing relay's message spacing, keeping a bounded memory queue.
    if(this.queued.length && Date.now()>=(this.nextSend??0)){
      const q=this.queued.shift(), frame={type:'msg',...await this.group.seal(envelope(this.group.me,q.text))};
      this.own.set(frame.h,{...q,frame,targets:this.present.filter(n=>n!==this.group.me),confirmed:new Set(),at:Date.now()});
      while(this.own.size>100)this.own.delete(this.own.keys().next().value);
      this.send(frame);this.nextSend=Date.now()+6100;
    }
    for(const [id,t] of this.seen)if(Date.now()-t>1200000)this.seen.delete(id);
    while(this.seen.size>4096)this.seen.delete(this.seen.keys().next().value);
  }
  async retryPending(){
    for(const own of this.own.values()){
      if(!own.echo && Date.now()-own.at>8000 && (own.retries??0)<3){this.send(own.frame);own.at=Date.now();own.retries=(own.retries??0)+1;}
      if(!own.echo && (own.retries??0)>=3)this.emit('delivery',{id:own.id,text:'可能没发出去，请确认后重发'});
    }
  }
  resetRelay() {
    for (const own of this.own.values()) if (own.confirmed.size < own.targets.length || !own.echo)
      this.emit('delivery', { id: own.id, text: '换了中继，不确定对方是否收到' });
    this.group=null;this.resume=null;this.present=[];this.pins.clear();this.seen.clear();
    this.own.clear();this.received.clear();this.receipts=[];this.nextSend=0;this.lastAnnounce=0;
    this.emit('presence',0);this.emit('relay-change');
  }
  halt(){this.stopped=true;clearTimeout(this.retry);clearTimeout(this.announceTimer);clearInterval(this.tick);this.connection?.stop();this.ws?.close(4000);}
}
