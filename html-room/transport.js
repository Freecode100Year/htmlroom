import { validate, validateBlank, relayEntry, relayKind, relayUrl, connectSources, DEFAULT_TITLE } from './crypto.js';
const escText = s => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// The page that can open this room from a link: a classic relay's /hr.html, or
// for a decentralized room whose relays are all bc paths on one server, that
// server's page. Other relay mixes have no web entry; use the file.
export function webEntry(config){
 if(config.version===2)return config.relays[0].replace(/^ws/,'http');
 if(config.version===3){const origins=config.relays.map(r=>relayKind(r)==='bc'?new URL(relayUrl(r)).origin:null);if(origins.every(o=>o&&o===origins[0]))return origins[0].replace(/^ws/,'http');}
 return '';
}
export const escapeConfig=c=>JSON.stringify(c).replace(/[<>/\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
const encode=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function fragmentFor(config){validate(config);return '#hr1='+encode(JSON.stringify(config));}
// Static HTML: still usable when a file preview disables JavaScript or CSP blocks boot.
export function previewHelp(config){
 const base=config.version?webEntry(config):'', link=base ? `${base}/hr.html${fragmentFor(config)}` : '';
 return `<section id="preview-help"><p>页面没有启动？微信、QQ 或手机「文件」App 的预览打不开聊天室，请用 Safari、Chrome 等浏览器打开这个文件。</p>${link?`<p><a id="preview-link" href="${link.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">用浏览器打开这个房间</a>（点了没反应，就复制这个链接，粘贴到浏览器地址栏）。</p><p>注意：这个链接和文件一样是房间钥匙，别随便转发。</p>`:''}</section>`;
}
export function configFromHash(hash){
 if(typeof hash!=='string'||!/^#hr1=[A-Za-z0-9_-]+$/.test(hash)||hash.length>8192)throw Error('房间链接格式或长度无效');
 const b64=hash.slice(5).replace(/-/g,'+').replace(/_/g,'/');
 const bytes=Uint8Array.from(atob(b64+'='.repeat((4-b64.length%4)%4)),c=>c.charCodeAt(0));
 if(bytes.length>4096)throw Error('房间配置过长');
 return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}
const digest=async s=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))));
export async function fillTemplate(template,config,allowed,scriptHash,styleHash,templateHash){
 validate(config);if(!config.relays.every(relay=>allowed.map(relayEntry).includes(relay)))throw Error('中继源不在明确白名单内');
 if(template.length>200000)throw Error('模板过长');
 if(await digest(template)!==templateHash)throw Error('完整模板哈希不符');
 const scripts=[...template.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)],styles=[...template.matchAll(/<style>([\s\S]*?)<\/style>/g)];
 if(scripts.length!==2||scripts[0][1]!==' id="pt-room-config" type="application/json"'||scripts[0][2]!=='{}'||scripts[1][1]!==''||styles.length!==1)throw Error('模板结构无效');
 if(await digest(scripts[1][2])!==scriptHash||await digest(styles[0][1])!==styleHash)throw Error('模板完整性不符');
 const csp=c=>`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src ${connectSources(c).join(' ')}; base-uri 'none'; form-action 'none'`;
 const marker=`<meta http-equiv="Content-Security-Policy" content="${csp({})}">`;
 if(!template.includes(marker))throw Error('模板 CSP 无效');
 const title=escText(config.title ?? DEFAULT_TITLE);
 return template.replace(marker,`<meta http-equiv="Content-Security-Policy" content="${csp(config)}">`).replace(`<title>${DEFAULT_TITLE}</title>`,`<title>${title}</title>`).replace(`<body><h1>${DEFAULT_TITLE}</h1>`,`<body><h1>${title}</h1>`).replace(previewHelp({}),previewHelp(config)).replace('<script id="pt-room-config" type="application/json">{}</script>',`<script id="pt-room-config" type="application/json">${escapeConfig(config)}</script>`);
}
