import { boot } from './client.js';
import { retargetHtml } from './template.js';
// Read before anything else: the exact executable and style bytes this file
// runs with (CSP already pinned them by hash), reused to re-emit the file.
const ownScript=document.currentScript?.textContent, ownStyle=document.querySelector('style')?.textContent;
let config;
try { config=JSON.parse(document.getElementById('pt-room-config').textContent); boot(config); }
catch { document.getElementById('status').textContent='配置无效，请重新获取房间文件。';document.getElementById('enter').disabled=true; }

function enableRetarget(config){
 const el=id=>document.getElementById(id), say=t=>{el('rt-status').textContent=t;};
 let url;
 el('retarget').hidden=false;el('rt-relay').value=config.relays.join(' ');
 el('rt-make').addEventListener('click',async()=>{
  el('rt-download').hidden=true;el('rt-make').disabled=true;say('');
  try{
   const r=await retargetHtml(config,el('rt-relay').value,ownScript,ownStyle);
   if(JSON.stringify(r.config.relays)===JSON.stringify(config.relays)){say('中继与当前文件相同，无需生成。');return;}
   if(url)URL.revokeObjectURL(url);
   url=URL.createObjectURL(new Blob([r.html],{type:'text/html'}));
   el('rt-download').href=url;el('rt-download').hidden=false;
   say(`已生成：新文件按顺序连接 ${r.config.relays.join('、')}。房间密钥和口令不变；请把新文件发给所有成员，用新文件重新打开并核对安全码。`);
  }catch(e){say(/[一-鿿]/.test(e?.message??'')?`生成失败：${e.message}。`:'生成失败：请填写 1–3 个 wss:// 中继源（只含域名或 IP，可带端口，不含路径）。');}
  finally{el('rt-make').disabled=false;}
 });
 addEventListener('pagehide',()=>{if(url)URL.revokeObjectURL(url);});
}
try{ if(config?.version && ownScript && ownStyle) enableRetarget(config); }catch{}
