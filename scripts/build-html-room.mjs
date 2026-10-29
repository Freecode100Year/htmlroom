import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeConfig, relayEntry, relayList, validate } from '../html-room/crypto.js';
import { escapeConfig } from '../html-room/transport.js';
import { roomHtml, withRelays, configFromRoomHtml } from '../html-room/template.js';
export { escapeConfig };
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('base64');
export async function render(config, allowed=[]) {
 if(config.version){validate(config);if(!config.relays.every(relay=>allowed.map(relayEntry).includes(relay)))throw Error('中继源不在明确白名单内');}
 const result=await build({entryPoints:[root+'html-room/file.js'],bundle:true,write:false,format:'iife',target:['es2020'],minify:true,legalComments:'none'});
 // The script embeds the room HTML (template.js) to re-emit itself; tag openers
 // occur only inside string literals, where \x3C is the same character.
 const script=result.outputFiles[0].text.trimEnd().replace(/<(\\?\/?)(script|style)/gi,'\\x3C$1$2');
 if(/<\/?(script|style)/i.test(script))throw Error('可执行脚本含不安全标签');
 const style=(await readFile(root+'html-room/style.css','utf8')).trimEnd();
 const scriptHash=hash(script),styleHash=hash(style);
 const {html,csp}=roomHtml(config,script,style,scriptHash,styleHash);
 return {html,scriptHash,styleHash,csp,bytes:Buffer.byteLength(html)};
}
export async function buildWeb(check=false, {defaultRelay=null, outputDir=root+'dist/'}={}) {
 const defaultRelays=defaultRelay ? relayList(defaultRelay) : [];
 if(defaultRelays.some(relay=>!relay.startsWith('wss://')))throw Error('静态前端中继必须使用 WSS');
 if(!check)await mkdir(outputDir,{recursive:true});
 const t=await render({},[]),style=(await readFile(root+'html-room/style.css','utf8')).trimEnd();
 const built=await build({entryPoints:[root+'html-room/web.js'],bundle:true,write:false,format:'iife',target:['es2020'],minify:true,legalComments:'none',define:{PT_DEFAULT_RELAYS:JSON.stringify(defaultRelays),PT_SCRIPT_HASH:JSON.stringify(t.scriptHash),PT_STYLE_HASH:JSON.stringify(t.styleHash),PT_TEMPLATE_HASH:JSON.stringify(hash(t.html))}});
 const maker=`<form id="maker"><h1>创建 HTML 房间</h1><p>同一份文件进入同一聊天房间，生成过程在本浏览器内完成。</p><label for="mk-relay">中继源（空格或逗号分隔）</label><p class="hint">经典中继 <code>wss://…</code> 填 1–3 个，按优先级切换。去中心化中继填 1–5 个，消息同时发往全部：<code>bc+wss://…</code>（本项目或任意转发服务器）、<code>nostr+wss://…</code>（Nostr 中继）、<code>mqtt+wss://…/mqtt</code>（MQTT 代理）。两类不能混用。</p><input id="mk-relay" required maxlength="1200" spellcheck="false"><button id="mk-mesh" type="button">改用去中心化中继</button><label for="mk-pass">可选打开口令（建议随机生成，通过独立渠道传递）</label><input id="mk-pass" type="password" maxlength="1024" autocomplete="off"><button id="mk-gen" type="button">随机生成高熵口令</button><button id="mk-make">创建房间</button><p id="mk-error" role="status"></p><section id="mk-out" hidden><a id="mk-download" download="index.html">下载房间文件</a><section id="mk-link-row" hidden><p>网页入口代码可读取 Fragment；其安全性不等同于经过验证的离线文件。手机预览兼容性仍未验证。</p><input id="mk-link" readonly aria-label="房间链接"><button id="mk-copy" type="button">复制网页链接</button></section></section><details id="cv"><summary>已有房间文件？改用其他中继（如自建 wss://）</summary><p>选择现有房间文件并填写新中继，生成同一房间（密钥、口令不变）的新文件。文件只在本浏览器内读取，不会上传。</p><label for="cv-file">房间文件</label><input id="cv-file" type="file" accept=".html,text/html"><label for="cv-relay">新中继源（wss:// 经典 1–3 个，或 bc+ / nostr+ / mqtt+ 去中心化 1–5 个）</label><input id="cv-relay" maxlength="1200" autocomplete="off" spellcheck="false" placeholder="wss://relay.example.com"><button id="cv-make" type="button">生成新房间文件</button><p id="cv-error" role="status"></p><a id="cv-download" download="index.html" hidden>下载新房间文件</a></details></form>`;
 const body=t.html.match(/<body>([\s\S]*?)<script id="pt-room-config"/)[1];
 const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'${defaultRelays.length?' '+defaultRelays.join(' '):''}; base-uri 'none'; form-action 'none'"><title>HTML Room · 创建或进入房间</title><link rel="stylesheet" href="hr.css"><script defer src="hr.js"></script></head><body>${maker}<section id="room-panel" hidden>${body}</section></body></html>\n`;
 const files={'hr-template.html':t.html,'hr.js':built.outputFiles[0].text,'hr.css':style+'\n','hr.html':page};
 for(const [name,text] of Object.entries(files)){
  const path=outputDir+name;
  if(check){if(await readFile(path,'utf8')!==text)throw Error(name+' 与源码构建不符');}
  else await writeFile(path,text);
 }
 return {scriptHash:t.scriptHash,styleHash:t.styleHash};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==='pages'){
  if(args.length!==1)throw Error('pages 不接受参数');
  const outputDir=root+'pages/';
  const result=await buildWeb(false,{defaultRelay:process.env.HR_PAGES_RELAYS || process.env.HR_PAGES_RELAY || 'wss://chat.nya.je',outputDir});
  await writeFile(outputDir+'index.html',await readFile(outputDir+'hr.html'));
  await writeFile(outputDir+'.nojekyll','');
  console.log(JSON.stringify(result));process.exit(0);
 }
 if(args[0]==='template' && (args.length>2 || args.slice(1).some(x=>x!=='--check')))throw Error('template 仅支持 --check');
 if(args[0]==='template'){console.log(JSON.stringify(await buildWeb(args.includes('--check'))));process.exit(0);}
 if(args[0]==='retarget'){
  const flags=args.slice(1);
  if(flags.length%2 || flags.some((value,i)=>i%2===0&&!['--in','--out','--relay'].includes(value)) || flags.filter(x=>x==='--in').length!==1 || flags.filter(x=>x==='--out').length!==1)throw Error('用法：retarget --in 旧房间.html --out 新房间.html --relay wss://新中继 [--relay wss://备用中继]');
  const getAll=name=>flags.filter((value,i)=>i%2===1&&flags[i-1]===name);
  const relays=getAll('--relay');if(!relays.length)throw Error('retarget 需要至少一个 --relay');
  // Old files are rebuilt with the current template: the room secret is kept, the code is upgraded.
  const config=withRelays(configFromRoomHtml(await readFile(getAll('--in')[0],'utf8')),relays);
  const r=await render(config,config.relays);
  await writeFile(getAll('--out')[0],r.html,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({bytes:r.bytes,relays:config.relays,roomId:config.roomId,encrypted:config.encrypted}));process.exit(0);
 }
 let output,relay,allowed;
 if(args[0]==='room'){
  const flags=args.slice(1);
  if(flags.length%2 || flags.some((value,i)=>i%2===0&&!['--out','--relay','--allow-relay'].includes(value)) || flags.filter(x=>x==='--out').length!==1)throw Error('room 仅支持一个 --out 和可重复的 --relay、--allow-relay；口令请用 HR_PASSWORD_STDIN');
  const getAll=name=>flags.filter((value,i)=>i%2===1&&flags[i-1]===name);
  [output]=getAll('--out');relay=getAll('--relay');allowed=getAll('--allow-relay');
  if(!output||!relay.length||!allowed.length)throw Error('room 需要 --out、--relay 与明确 --allow-relay');
 }else{[output,relay,...allowed]=args;}
 if(!output)throw Error('用法：node scripts/build-html-room.mjs out/index.html wss://relay.example wss://relay.example （从标准输入可选读取口令，HR_PASSWORD_STDIN=1）');
 let pass;
 if(process.env.HR_PASSWORD_STDIN==='1'){let s='';for await(const chunk of process.stdin){s+=chunk;if(Buffer.byteLength(s)>4096)throw Error('输入过长');}pass=s.replace(/\r?\n$/,'');if(!pass)throw Error('口令不能为空');}
 const config=relay?await makeConfig(relay,pass):{};
 const r=await render(config,allowed);
 await mkdir(new URL('../out/',import.meta.url),{recursive:true});
 await writeFile(output,r.html,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({bytes:r.bytes,scriptHash:r.scriptHash,styleHash:r.styleHash}));
}
