import { boot } from './client.js';
import { retargetHtml } from './template.js';
// Read before anything else: the exact executable and style bytes this file
// runs with (CSP already pinned them by hash), reused to re-emit the file.
const ownScript=document.currentScript?.textContent, ownStyle=document.querySelector('style')?.textContent;
let config;
try { config=JSON.parse(document.getElementById('pt-room-config').textContent); boot(config); }
catch { document.getElementById('status').textContent='房间文件有问题，请让对方重新发一份。';document.getElementById('enter').disabled=true; }

function enableRetarget(config){
 const el=id=>document.getElementById(id), say=t=>{el('rt-status').textContent=t;};
 let url;
 el('retarget').hidden=false;el('rt-relay').value=config.relays.join(' ');
 el('rt-make').addEventListener('click',async()=>{
  el('rt-download').hidden=true;el('rt-make').disabled=true;say('');
  try{
   const r=await retargetHtml(config,el('rt-relay').value,ownScript,ownStyle);
   if(JSON.stringify(r.config.relays)===JSON.stringify(config.relays)){say('地址和现在一样，不用换。');return;}
   if(url)URL.revokeObjectURL(url);
   url=URL.createObjectURL(new Blob([r.html],{type:'text/html'}));
   el('rt-download').href=url;el('rt-download').hidden=false;
   say(`新文件已生成（中继：${r.config.relays.join('、')}）。口令不变。请把它发给所有人，大家都用新文件打开，再核对一次安全码。`);
  }catch(e){say(/[一-鿿]/.test(e?.message??'')?`生成失败：${e.message}。`:'生成失败：地址格式不对。例子：wss://relay.example.com');}
  finally{el('rt-make').disabled=false;}
 });
 addEventListener('pagehide',()=>{if(url)URL.revokeObjectURL(url);});
}
try{ if(config?.version && ownScript && ownStyle) enableRetarget(config); }catch{}
