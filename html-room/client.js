import { unlock, validate, hex } from './crypto.js';
import { Session } from './session.js';
import { RelayConnection } from './relay-connection.js';
import { MeshConnection } from './mesh.js';
export function boot(config) {
const el=id=>document.getElementById(id), status=text=>{el('status').textContent=text;};
el('preview-help').hidden=true;
let attempts=0,busy=false,nextUnlock=0;
let session;
const rows=new Map();
function emit(kind,value){
 if(kind==='notice'||kind==='fatal')status(value);
 if(kind==='relay-change'){el('safety').textContent='换了中继，正在重新确认成员。请再核对一次安全码。';}
 if(kind==='presence')el('presence').textContent=`在线 ${value} 人`;
 if(kind==='ready'){status('✅ 已加密连接，可以聊天了');el('safety').textContent=`安全码：${value}。请打电话或当面和对方核对，一样才说明没有人冒充。`;}
 if(kind==='message'){const li=document.createElement('li');li.textContent=`${value.from}：${value.text}`;const small=document.createElement('small');li.append(small);el('messages').append(li);rows.set(value.id,small);if(rows.size>200){rows.delete(rows.keys().next().value);el('messages').firstChild.remove();}}
 if(kind==='delivery' && rows.has(value.id))rows.get(value.id).textContent=value.text;
}
if(!globalThis.crypto?.subtle || !globalThis.WebSocket || !globalThis.TextEncoder){status('这个预览打不开聊天室，请用 Safari、Chrome 等浏览器打开这个文件。');el('enter').disabled=true;}
else if(config.version){
 try{validate(config);status(config.encrypted?'请输入口令，然后点「进入房间」。':'点「进入房间」开始聊天。');el('password').disabled=false;el('enter').disabled=false;}catch{status('房间文件有问题，请让对方重新发一份。');el('enter').disabled=true;}
}else{status('这是空白模板，请先在创建页面里创建房间。');el('enter').disabled=true;}
el('unlock').addEventListener('submit',async e=>{e.preventDefault();if(busy||Date.now()<nextUnlock)return;busy=true;el('enter').disabled=true;try{
 const derived=await unlock(config,el('password').value);el('password').value='';session=new Session(derived,config,{emit});el('unlock').hidden=true;el('chat').hidden=false;
 if(config.version===3){
  const connection=new MeshConnection(config.relays,{
   derived:session.d,
   onhello:n=>session.run(()=>{session.ws=connection.socket;status('已进入房间，正在确认其他成员……');return session.incoming({type:'hello',you:n,resume:''});}),
   onmembers:list=>session.run(()=>session.incoming({type:'members',members:list})),
   onframe:(frame,from)=>session.run(()=>session.incoming({...frame,from})),
   onstatus:text=>{el('relay-status').textContent=text;},
   onnotice:status,
   onfatal:text=>{session.halt();status(text||'聊天已结束，请重新打开房间文件。');}
  });
  session.connection=connection;connection.start();
  status('正在连接……');
 }else{
 const connection=new RelayConnection(config.relays,{
  roomId:config.roomId,
  protocols:index=>['pt2',`a${hex(session.d.access)}`,...(session.resume && connection.lastIndex===index?[`r${session.resume}`]:[])],
  onactive:(ws,index,changed)=>session.run(()=>{
   if(changed)session.resetRelay();
   session.ws=ws;
   el('relay-status').textContent=`中继：${config.relays[index]}${config.relays.length>1?`（第 ${index+1} 个，共 ${config.relays.length} 个）`:''}`;
   status(changed?'已换到另一个中继，正在重新确认成员……':'已连上中继，正在确认其他成员……');
  }),
  onmessage:m=>{const ws=session.ws;session.run(()=>{if(ws===session.ws)return session.incoming(m);});},
  ondisconnect:()=>{session.ws=null;el('relay-status').textContent='中继断开了，正在重连……';emit('presence',0);},
  onnotice:status,
  onfatal:()=>{session.halt();status('进不去房间：可能人满了、房间文件不对，或中继拒绝了连接。请检查后重新打开。');}
 });
 session.connection=connection;connection.start();
 }
 session.tick=setInterval(()=>session.run(async()=>{
  if(session.ws?.readyState===1){
   if(Date.now()-(session.lastAnnounce??0)>10000){await session.announce(true);session.lastAnnounce=Date.now();}
   await session.flush();await session.retryPending();
  }
 }),1600);
}catch{attempts++;nextUnlock=Date.now()+Math.min(30000,1000*2**Math.min(attempts,5));el('password').value='';status('解锁失败：口令不对，或文件不完整。请等几秒再试。');}
 finally{busy=false;setTimeout(()=>{el('enter').disabled=false;},Math.max(0,nextUnlock-Date.now()));}});
el('chat').addEventListener('submit',e=>{e.preventDefault();if(session?.queue(el('text').value))el('text').value='';else status('发不出去：消息是空的、太长了，或者发得太快了。');});

addEventListener('pagehide',()=>session?.halt());

}
