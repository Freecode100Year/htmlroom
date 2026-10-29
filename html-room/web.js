// Adapted from Claude's hr.js maker/Fragment entry; cryptography and chat
// use the canonical protocol modules shared with standalone files.
import { boot } from './client.js';
import { makeConfig, relayList, relayKind, relayUrl, hex, random } from './crypto.js';
import { configFromHash, fragmentFor, fillTemplate } from './transport.js';
import { withRelays, configFromRoomHtml } from './template.js';
const fragment=location.hash;
if(fragment)history.replaceState(null,'',location.pathname+location.search);
const el=id=>document.getElementById(id);
const allowedRelays=PT_DEFAULT_RELAYS.length ? PT_DEFAULT_RELAYS : [location.origin.replace(/^http/,'ws')];
let downloadUrl,convertUrl;
// A room opens from this site's link only if this page may reach all its
// relays: preset classic relays, or bc paths on those same servers.
const linkable=relays=>relays.every(r=>allowedRelays.includes(r)||(relayKind(r)==='bc'&&allowedRelays.includes(new URL(relayUrl(r)).origin)));
async function filledTemplate(config){
 const response=await fetch('hr-template.html',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
 if(!response.ok)throw Error('模板不可用');
 return fillTemplate(await response.text(),config,config.relays,PT_SCRIPT_HASH,PT_STYLE_HASH,PT_TEMPLATE_HASH);
}
function fail(text){el('mk-error').textContent=text;}
function openFragment(fragment){
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 if(!el('room-panel').hidden){el('status').textContent='请在新窗口打开其他房间链接，当前会话不会自动切换。';return;}
 el('maker').hidden=true;el('room-panel').hidden=false;
 try{
  const config=configFromHash(fragment);
  if(!linkable(config.relays))throw Error('网页入口仅允许预设中继，请用房间文件连接其他中继。');
  boot(config);
 }catch{el('status').textContent='房间链接无效，或中继与本站不匹配。请重新索取链接或使用验证过的房间文件。';el('enter').disabled=true;}
}
addEventListener('hashchange',()=>{if(location.hash)openFragment(location.hash);});
if(fragment)openFragment(fragment);
else{
 el('mk-relay').value=allowedRelays.join(', ');
 el('mk-gen').addEventListener('click',()=>{el('mk-pass').value=hex(random(32));});
 el('mk-mesh').addEventListener('click',()=>{el('mk-relay').value=allowedRelays.map(r=>`bc+${r}/bc/`).join(' ');fail('已填入本站的去中心化中继（bc+）。可继续添加 nostr+wss://… 或 mqtt+wss://… 作为同时在线的备份中继。');});
 el('maker').addEventListener('submit',async event=>{
  event.preventDefault();el('mk-make').disabled=true;fail('');el('mk-out').hidden=true;
  try{
   const relays=relayList(el('mk-relay').value),password=el('mk-pass').value;
   if(password && new TextEncoder().encode(password).length>1024)throw Error('口令过长');
   // Submitted canonical sources form the explicit file generation allowlist.
   const config=await makeConfig(relays,password||undefined);
   const html=await filledTemplate(config);
   if(downloadUrl)URL.revokeObjectURL(downloadUrl);
   downloadUrl=URL.createObjectURL(new Blob([html],{type:'text/html'}));
   el('mk-download').href=downloadUrl;el('mk-out').hidden=false;
   el('mk-pass').value='';
   if(linkable(relays)){el('mk-link').value=location.origin+location.pathname+fragmentFor(config);el('mk-link-row').hidden=false;}
   else{el('mk-link').value='';el('mk-link-row').hidden=true;}
   fail(password?'文件已包装。请通过独立渠道传递口令；仍须防范离线猜测。':'此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。');
  }catch(e){fail(/[\u4e00-\u9fff]/.test(e?.message??'')?`生成失败：${e.message}`:'生成失败。请检查中继地址、环境和模板完整性。');}
  finally{el('mk-make').disabled=false;}
 });
 // Existing room file -> same room on other relays. Read locally, never uploaded;
 // rebuilt from this site's verified template, so old files also get current code.
 el('cv-make').addEventListener('click',async()=>{
  const say=t=>{el('cv-error').textContent=t;};el('cv-download').hidden=true;el('cv-make').disabled=true;say('');
  try{
   const file=el('cv-file').files?.[0];if(!file)throw Error('请先选择房间文件');
   if(file.size>400000)throw Error('文件过大，不是房间文件');
   let old;try{old=configFromRoomHtml(await file.text());}catch{throw Error('无法读取房间配置；旧版（单中继 version 1）文件需重新创建房间');}
   const config=withRelays(old,el('cv-relay').value);
   const html=await filledTemplate(config);
   if(convertUrl)URL.revokeObjectURL(convertUrl);
   convertUrl=URL.createObjectURL(new Blob([html],{type:'text/html'}));
   el('cv-download').href=convertUrl;el('cv-download').hidden=false;
   say(`已生成同一房间的新文件，中继：${config.relays.join('、')}。${config.encrypted?'口令不变。':'此文件包含完整房间密钥，请勿通过未加密渠道发送。'}所有成员须改用新文件并重新核对安全码。`);
  }catch(e){say(/[\u4e00-\u9fff]/.test(e?.message??'')?e.message:'生成失败：请检查中继地址（1–3 个 wss:// 源）。');}
  finally{el('cv-make').disabled=false;}
 });
 el('mk-copy').addEventListener('click',()=>navigator.clipboard?.writeText(el('mk-link').value).then(()=>fail('已复制。链接包含加入能力，请谨慎分发。'),()=>fail('无法自动复制，请手动复制链接。')));
}
addEventListener('pagehide',()=>{if(downloadUrl)URL.revokeObjectURL(downloadUrl);if(convertUrl)URL.revokeObjectURL(convertUrl);});
