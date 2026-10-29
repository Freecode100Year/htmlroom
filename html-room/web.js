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
 if(!el('room-panel').hidden){el('status').textContent='你已经在一个房间里了。要进别的房间，请在新窗口打开链接。';return;}
 el('maker').hidden=true;el('room-panel').hidden=false;
 try{
  const config=configFromHash(fragment);
  if(!linkable(config.relays))throw Error('网页入口仅允许预设中继，请用房间文件连接其他中继。');
  boot(config,{allowCustom:false});
 }catch{el('status').textContent='房间链接打不开：链接不完整，或者它用的中继本站不支持。请让对方重发链接，或直接用房间文件。';el('enter').disabled=true;}
}
addEventListener('hashchange',()=>{if(location.hash)openFragment(location.hash);});
if(fragment)openFragment(fragment);
else{
 el('mk-relay').value=allowedRelays.join(', ');
 el('mk-gen').addEventListener('click',()=>{el('mk-pass').value=hex(random(32));});
 el('mk-mesh').addEventListener('click',()=>{el('mk-relay').value=allowedRelays.map(r=>`bc+${r}/bc/`).join(' ');fail('已换成本站的去中心化中继。还可以在后面加上 nostr+wss://… 或 mqtt+wss://… 当备份。');});
 el('maker').addEventListener('submit',async event=>{
  event.preventDefault();el('mk-make').disabled=true;fail('');el('mk-out').hidden=true;
  try{
   const relays=relayList(el('mk-relay').value),password=el('mk-pass').value;
   if(password && new TextEncoder().encode(password).length>1024)throw Error('口令过长');
   // Submitted canonical sources form the explicit file generation allowlist.
   const config=await makeConfig(relays,password||undefined,{custom:el('mk-custom').checked});
   const html=await filledTemplate(config);
   if(downloadUrl)URL.revokeObjectURL(downloadUrl);
   downloadUrl=URL.createObjectURL(new Blob([html],{type:'text/html'}));
   el('mk-download').href=downloadUrl;el('mk-out').hidden=false;
   el('mk-pass').value='';
   if(linkable(relays)){el('mk-link').value=location.origin+location.pathname+fragmentFor(config);el('mk-link-row').hidden=false;}
   else{el('mk-link').value='';el('mk-link-row').hidden=true;}
   fail(password?'✅ 房间建好了。口令请换一种方式告诉朋友（比如打电话），别和文件一起发。':'✅ 房间建好了。文件和链接就是钥匙，请只发给要聊天的人。');
  }catch(e){fail(/[\u4e00-\u9fff]/.test(e?.message??'')?`创建失败：${e.message}`:'创建失败，请检查中继地址后再试。');el('mk-advanced').open=true;}
  finally{el('mk-make').disabled=false;}
 });
 // Existing room file -> same room on other relays. Read locally, never uploaded;
 // rebuilt from this site's verified template, so old files also get current code.
 el('cv-make').addEventListener('click',async()=>{
  const say=t=>{el('cv-error').textContent=t;};el('cv-download').hidden=true;el('cv-make').disabled=true;say('');
  try{
   const file=el('cv-file').files?.[0];if(!file)throw Error('请先选择房间文件');
   if(file.size>400000)throw Error('这个文件太大了，不是房间文件');
   let old;try{old=configFromRoomHtml(await file.text());}catch{throw Error('读不出房间信息。如果是很早的旧版文件，请重新创建房间');}
   const config=withRelays(old,el('cv-relay').value,el('cv-custom').checked);
   const html=await filledTemplate(config);
   if(convertUrl)URL.revokeObjectURL(convertUrl);
   convertUrl=URL.createObjectURL(new Blob([html],{type:'text/html'}));
   el('cv-download').href=convertUrl;el('cv-download').hidden=false;
   say(`新文件已生成（中继：${config.relays.join('、')}）。${config.encrypted?'口令不变。':''}请把它发给所有人，大家都用新文件打开，再核对一次安全码。`);
  }catch(e){say(/[\u4e00-\u9fff]/.test(e?.message??'')?e.message:'生成失败：请检查中继地址。');}
  finally{el('cv-make').disabled=false;}
 });
 el('mk-copy').addEventListener('click',()=>navigator.clipboard?.writeText(el('mk-link').value).then(()=>fail('已复制。链接就是钥匙，请只发给要聊天的人。'),()=>fail('复制失败，请手动选中链接复制。')));
}
addEventListener('pagehide',()=>{if(downloadUrl)URL.revokeObjectURL(downloadUrl);if(convertUrl)URL.revokeObjectURL(convertUrl);});
