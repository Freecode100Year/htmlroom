import { unlock, validate, hex } from './crypto.js';
import { Session } from './session.js';
import { RelayConnection } from './relay-connection.js';
export function boot(config) {
const el=id=>document.getElementById(id), status=text=>{el('status').textContent=text;};
el('preview-help').hidden=true;
let attempts=0,busy=false,nextUnlock=0;
let session;
const rows=new Map();
function emit(kind,value){
 if(kind==='notice'||kind==='fatal')status(value);
 if(kind==='relay-change'){el('safety').textContent='中继已切换，正在重新验证成员；请重新核对安全码。';}
 if(kind==='presence')el('presence').textContent=`在线 ${value} 人（中继报告）`;
 if(kind==='ready'){status('已建立签名混合加密连接');el('safety').textContent=`安全码：${value}，请通过独立渠道核对。`;}
 if(kind==='message'){const li=document.createElement('li');li.textContent=`${value.from}：${value.text}`;const small=document.createElement('small');li.append(small);el('messages').append(li);rows.set(value.id,small);if(rows.size>200){rows.delete(rows.keys().next().value);el('messages').firstChild.remove();}}
 if(kind==='delivery' && rows.has(value.id))rows.get(value.id).textContent=value.text;
}
if(!globalThis.crypto?.subtle || !globalThis.WebSocket || !globalThis.TextEncoder){status('此预览环境不支持所需脚本或加密 API，请使用支持的浏览器打开；iOS、微信和 QQ 本地预览需实测。');el('enter').disabled=true;}
else if(config.version){
 try{validate(config);status(config.encrypted?'请输入口令解锁；解锁前不会连接中继。':'无口令文件：点击进入房间。');el('password').disabled=false;el('enter').disabled=false;}catch{status('配置无效，请重新生成文件。');el('enter').disabled=true;}
}else{status('无秘密模板：请使用生成器创建房间文件。');el('enter').disabled=true;}
el('unlock').addEventListener('submit',async e=>{e.preventDefault();if(busy||Date.now()<nextUnlock)return;busy=true;el('enter').disabled=true;try{
 const derived=await unlock(config,el('password').value);el('password').value='';session=new Session(derived,config,{emit});el('unlock').hidden=true;el('chat').hidden=false;
 const connection=new RelayConnection(config.relays,{
  roomId:config.roomId,
  protocols:index=>['pt2',`a${hex(session.d.access)}`,...(session.resume && connection.lastIndex===index?[`r${session.resume}`]:[])],
  onactive:(ws,index,changed)=>session.run(()=>{
   if(changed)session.resetRelay();
   session.ws=ws;
   el('relay-status').textContent=`当前中继：${config.relays[index]}（优先级 ${index+1}/${config.relays.length}）`;
   status(changed?'已切换中继，正在重新验证成员；不同中继上的成员暂时无法互通。':'已连接中继，正在验证成员密钥…');
  }),
  onmessage:m=>{const ws=session.ws;session.run(()=>{if(ws===session.ws)return session.incoming(m);});},
  ondisconnect:()=>{session.ws=null;el('relay-status').textContent='当前中继：已断开，正在按优先级重试';emit('presence',0);},
  onnotice:status,
  onfatal:()=>{session.halt();status('连接被拒绝或会话结束，请检查房间文件、中继配置或人数限制后重新打开。');}
 });
 session.connection=connection;connection.start();
 session.tick=setInterval(()=>session.run(async()=>{
  if(session.ws?.readyState===1){
   if(Date.now()-(session.lastAnnounce??0)>10000){await session.announce(true);session.lastAnnounce=Date.now();}
   await session.flush();await session.retryPending();
  }
 }),1600);
}catch{attempts++;nextUnlock=Date.now()+Math.min(30000,1000*2**Math.min(attempts,5));el('password').value='';status('解锁失败：口令或文件不正确。稍后再试。本机节流不能阻止离线猜测。');}
 finally{busy=false;setTimeout(()=>{el('enter').disabled=false;},Math.max(0,nextUnlock-Date.now()));}});
el('chat').addEventListener('submit',e=>{e.preventDefault();if(session?.queue(el('text').value))el('text').value='';else status('消息为空、过长或队列已满。');});

addEventListener('pagehide',()=>session?.halt());

}
