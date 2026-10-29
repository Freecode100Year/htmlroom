import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeConfig, relayEntry, relayList, validate, validateBlank, CUSTOM_SOURCES } from '../html-room/crypto.js';
import { escapeConfig } from '../html-room/transport.js';
import { roomHtml, withRelays, configFromRoomHtml, serverComment, SERVER_FORBIDDEN } from '../html-room/template.js';
export { escapeConfig };
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('base64');
export async function render(config, allowed=[]) {
 if(config.version){validate(config);if(!config.relays.every(relay=>allowed.map(relayEntry).includes(relay)))throw Error('中继源不在明确白名单内');}
 else validateBlank(config);
 const result=await build({entryPoints:[root+'html-room/file.js'],bundle:true,write:false,format:'iife',target:['es2020'],minify:true,legalComments:'none'});
 // The script embeds the room HTML (template.js) to re-emit itself; tag openers
 // occur only inside string literals, where \x3C is the same character.
 // Likewise comment delimiters, which would end the file's HTML or Node comments
 // early; they too occur only inside literals (see html-room/template.js).
 const script=result.outputFiles[0].text.trimEnd().replace(/<(\\?\/?)(script|style)/gi,'\\x3C$1$2')
  .replace(/<!--/g,'\\x3C!--').replace(/--(!?)>/g,'-\\x2D$1>').replace(/\*\//g,'*\\/');
 if(/<\/?(script|style)|<!--|--!?>|\*\//i.test(script))throw Error('可执行脚本含不安全标签或注释符');
 const style=(await readFile(root+'html-room/style.css','utf8')).trimEnd();
 const scriptHash=hash(script),styleHash=hash(style);
 // The relay half, for `node index.html`: Node standard library only.
 const server=(await build({entryPoints:[root+'html-room/serve.js'],bundle:true,write:false,format:'cjs',platform:'node',target:['node18'],minify:true,legalComments:'none'})).outputFiles[0].text.trimEnd();
 if(SERVER_FORBIDDEN.test(server))throw Error('服务端代码含不安全序列');
 const {html,csp}=roomHtml(config,script,style,scriptHash,styleHash,serverComment(server));
 return {html,scriptHash,styleHash,csp,bytes:Buffer.byteLength(html)};
}
// The site is the creator file itself: hr.html (and index.html on Pages) is
// a blank room file that creates rooms offline and opens #hr1= links. Its HTTP
// headers pin the same script and style hashes as the file's own meta CSP.
export async function buildWeb(check=false, {defaultRelay=null, outputDir=root+'dist/'}={}) {
 const defaultRelays=defaultRelay ? relayList(defaultRelay) : [];
 if(defaultRelays.some(relay=>!/^(?:(?:bc|nostr|mqtt)\+)?wss:\/\//.test(relay)))throw Error('静态前端中继必须使用 WSS');
 if(!check)await mkdir(outputDir,{recursive:true});
 const t=await render({},[]), site=defaultRelays.length ? await render({relays:defaultRelays},[]) : t;
 const headers=`/*
  Content-Security-Policy: default-src 'none'; script-src 'sha256-${t.scriptHash}'; style-src 'sha256-${t.styleHash}'; connect-src 'self' ${CUSTOM_SOURCES.join(' ')}; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Cache-Control: no-store
  NEL: {"max_age":0}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Strict-Transport-Security: max-age=31536000
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
`;
 const files={'hr-template.html':t.html,'hr.html':site.html,'_headers':headers};
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
  let custom;for(const f of ['--strict','--custom'])if(flags.includes(f)){custom=f==='--custom';flags.splice(flags.indexOf(f),1);}
  if(flags.length%2 || flags.some((value,i)=>i%2===0&&!['--in','--out','--relay'].includes(value)) || flags.filter(x=>x==='--in').length!==1 || flags.filter(x=>x==='--out').length!==1)throw Error('用法：retarget --in 旧房间.html --out 新房间.html --relay wss://新中继 [--relay wss://备用中继]');
  const getAll=name=>flags.filter((value,i)=>i%2===1&&flags[i-1]===name);
  const relays=getAll('--relay');if(!relays.length)throw Error('retarget 需要至少一个 --relay');
  // Old files are rebuilt with the current template: the room secret is kept, the code is upgraded.
  const config=withRelays(configFromRoomHtml(await readFile(getAll('--in')[0],'utf8')),relays,custom);
  const r=await render(config,config.relays);
  await writeFile(getAll('--out')[0],r.html,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({bytes:r.bytes,relays:config.relays,roomId:config.roomId,encrypted:config.encrypted}));process.exit(0);
 }
 let output,relay,allowed,strict=true;
 if(args[0]==='room'){
  strict=false;
  const flags=args.slice(1);
  strict=flags.includes('--strict');if(strict)flags.splice(flags.indexOf('--strict'),1);
  if(flags.length%2 || flags.some((value,i)=>i%2===0&&!['--out','--relay','--allow-relay'].includes(value)) || flags.filter(x=>x==='--out').length!==1)throw Error('room 仅支持一个 --out、可重复的 --relay、--allow-relay 和 --strict（不允许在文件里自定义中继）；口令请用 HR_PASSWORD_STDIN');
  const getAll=name=>flags.filter((value,i)=>i%2===1&&flags[i-1]===name);
  [output]=getAll('--out');relay=getAll('--relay');allowed=getAll('--allow-relay');
  if(!output||!relay.length||!allowed.length)throw Error('room 需要 --out、--relay 与明确 --allow-relay');
 }else{[output,relay,...allowed]=args;}
 if(!output)throw Error('用法：node scripts/build-html-room.mjs out/index.html wss://relay.example wss://relay.example （从标准输入可选读取口令，HR_PASSWORD_STDIN=1）');
 let pass;
 if(process.env.HR_PASSWORD_STDIN==='1'){let s='';for await(const chunk of process.stdin){s+=chunk;if(Buffer.byteLength(s)>4096)throw Error('输入过长');}pass=s.replace(/\r?\n$/,'');if(!pass)throw Error('口令不能为空');}
 // room: custom relays allowed unless --strict; the legacy positional form stays strict.
 const config=relay?await makeConfig(relay,pass,{custom:!strict}):{};
 const r=await render(config,allowed);
 await mkdir(new URL('../out/',import.meta.url),{recursive:true});
 await writeFile(output,r.html,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({bytes:r.bytes,scriptHash:r.scriptHash,styleHash:r.styleHash}));
}
