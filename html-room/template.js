// The single source of the room file's HTML. The build script renders it in
// Node; a room file uses the same function to re-emit itself with another
// relay list, so a re-targeted file is byte-identical to a fresh build and
// passes scripts/verify-room-file.mjs.
import { validate, validateBlank, relayList, versionFor, connectSources } from './crypto.js';
import { escapeConfig, previewHelp } from './transport.js';

export const cspFor = (config, scriptHash, styleHash) =>
 `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src ${connectSources(config).join(' ')}; base-uri 'none'; form-action 'none'`;

export const REPO = 'https://github.com/Freecode100Year/htmlroom.git';
export const repoLink = `<a href="${REPO}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">github.com/Freecode100Year/htmlroom</a>`;

// Hidden until file.js enables it, so the copy embedded in the web entry stays inert.
const RETARGET = `<details id="retarget" hidden><summary>生成换了中继的新文件（发给大家）</summary><p>中继是帮大家传消息的服务器，它看不到聊天内容。填上新地址，会生成一份新的房间文件：还是同一个房间，口令也不变。把新文件发给所有人，大家打开就自动用新中继。</p><label for="rt-relay">新的中继地址（多个用空格隔开）</label><p class="hint">例如 <code>wss://relay.example.com</code>；去中心化中继写成 <code>bc+wss://…</code>、<code>nostr+wss://…</code> 或 <code>mqtt+wss://…/mqtt</code>。</p><input id="rt-relay" maxlength="1200" autocomplete="off" spellcheck="false"><button id="rt-make" type="button">生成新文件</button><p id="rt-status" role="status"></p><a id="rt-download" download="index.html" hidden>下载新的房间文件</a></details>`;

// The creator: open in a blank file (the offline generator and the hosted
// site), folded away in a room file. Everything happens in this page, offline.
const MAKER = `<details id="new-room" hidden><summary>创建一个新房间（新的钥匙，可设新口令）</summary><form id="maker"><h1>创建加密聊天室</h1><p>点一下就能建好一个房间，把文件发给朋友，打开就能聊。全程在这个页面里完成，不用联网，也不经过任何网站。</p><label for="mk-pass">口令（可选，相当于门上再加一把锁）</label><input id="mk-pass" type="password" maxlength="1024" autocomplete="off"><button id="mk-gen" type="button">随机生成口令</button><details id="mk-advanced"><summary>中继服务器</summary><p class="hint">中继负责帮大家传消息，看不到内容。经典 <code>wss://…</code> 最多 3 个，坏了会自动换下一个；去中心化 <code>bc+wss://…</code>、<code>nostr+wss://…</code>、<code>mqtt+wss://…/mqtt</code> 最多 5 个，同时使用。两类不能混用。</p><label for="mk-relay">中继地址（多个用空格隔开）</label><input id="mk-relay" required maxlength="1200" spellcheck="false" placeholder="wss://relay.example.com"><button id="mk-mesh" type="button">改用去中心化中继</button><label class="check"><input id="mk-custom" type="checkbox" checked> 允许在房间文件里自定义中继</label><p class="hint">打开时，拿到文件的人进房前可以改填任意 <code>wss://</code> 中继。关掉更严格：文件只能连上面这些中继。</p></details><button id="mk-make">创建房间</button><p id="mk-error" role="status"></p><section id="mk-out" hidden><a id="mk-download" download="index.html">下载房间文件（index.html）</a><section id="mk-link-row" hidden><p>或者复制房间链接发给朋友。微信、QQ 里打不开文件时，用链接更方便。</p><input id="mk-link" readonly aria-label="房间链接"><button id="mk-copy" type="button">复制链接</button></section></section><details id="cv"><summary>已经有房间文件？换一个中继服务器</summary><p>选择房间文件，填上新的中继地址，会生成同一个房间的新文件，口令不变。文件只在这个页面里读取，不会上传。</p><label for="cv-file">房间文件</label><input id="cv-file" type="file" accept=".html,text/html"><label for="cv-relay">新的中继地址（多个用空格隔开）</label><input id="cv-relay" maxlength="1200" autocomplete="off" spellcheck="false" placeholder="wss://relay.example.com"><label class="check"><input id="cv-custom" type="checkbox" checked> 允许在新文件里自定义中继</label><button id="cv-make" type="button">生成新文件</button><p id="cv-error" role="status"></p><a id="cv-download" download="index.html" hidden>下载新的房间文件</a></details><p id="mk-self-row" class="hint" hidden>这个页面本身就是创建器：<a id="mk-self" download="index.html">下载离线版（index.html）</a>，以后不联网也能创建房间。</p></form></details>`;

// The file is also a Node script. This comment, before <!doctype html>, holds
// the relay (html-room/serve.js) for `node index.html`; browsers skip it. To
// Node its first line is an HTML-like line comment, and the page after it is a
// block comment closed by the final <!-- */ -->.
export const serverComment = server => ` HTML Room：用浏览器打开是聊天室；在命令行运行 node index.html 就是中继服务器（node index.html --help 查看选项）。\n${server}\n/*\n`;
export const SERVER_FORBIDDEN = /\*\/|-->|<!--|--!>|<\/?(?:script|style)/i;

export function roomHtml(config, script, style, scriptHash, styleHash, comment = '') {
 if (comment && SERVER_FORBIDDEN.test(comment.replace(/\/\*\n$/, ''))) throw Error('服务端代码含不安全序列');
 const csp = cspFor(config, scriptHash, styleHash);
 const html=`${comment ? `<!--${comment}-->\n` : ''}<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>加密聊天房间</title><style>${style}</style></head><body><h1>加密聊天房间</h1><aside id="risk">这个文件就是房间钥匙，拿到它的人都能进来，请只发给要聊天的人。设了口令的话，口令请换一种方式告诉对方（比如打电话）。</aside><p id="status" role="status">正在启动……如果一直停在这里，请看下面的说明。</p>${previewHelp(config)}<form id="unlock"><label for="password">口令（没设口令就直接点「进入房间」）</label><input id="password" disabled type="password" maxlength="1024" autocomplete="off"><div id="custom-relay" hidden><label for="relay-input">中继服务器（可以改成任意 wss:// 地址，多个用空格隔开）</label><input id="relay-input" maxlength="1200" autocomplete="off" spellcheck="false"><p class="hint">只对这次打开有效，不会改动文件。大家要连同一个中继才能互相看到消息；去中心化中继（<code>bc+</code> / <code>nostr+</code> / <code>mqtt+</code>）只要有一个相同就行。</p></div><button id="enter" disabled>进入房间</button></form>${RETARGET}<p id="relay-status" role="status"></p><p id="presence"></p><p id="safety"></p><ol id="messages" aria-live="polite"></ol><form id="chat" hidden><label for="text">消息（最多 500 字）</label><textarea id="text" maxlength="500"></textarea><button id="send">发送</button></form>${MAKER}<footer><p class="hint">HTML Room 开源项目：${repoLink}</p></footer><script id="pt-room-config" type="application/json">${escapeConfig(config)}</script><script>${script}</script></body></html>\n${comment ? '<!-- */ -->\n' : ''}`;
 return { html, csp };
}

// Same room (version, roomId, master or wrapped master untouched), new relays.
// Relays are public routing data: not part of the roomId derivation or the
// password-wrap AAD, so no password is needed and nothing secret changes.
export function withRelays(config, input, custom = config.custom === true) {
 validate(config);
 const { custom: _, ...rest } = config; config = custom ? { ...rest, custom: true } : rest;
 // Moving between classic (v2) and decentralized (v3) relays only changes the
 // version tag: the key material and roomId stay the same.
 const relays = relayList(input);
 return validate({ ...config, version: versionFor(relays), relays });
}

const digest = async s => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))));
// own: { script, style, comment } — the exact bytes of the running page.
export async function retargetHtml(config, input, own, custom) {
 const next = withRelays(config, input, custom);
 return { config: next, html: await htmlFor(next, own) };
}

export function configFromRoomHtml(html) {
 if (typeof html !== 'string' || html.length > 400000) throw Error('不是有效的房间文件');
 const m = html.match(/<script id="pt-room-config" type="application\/json">([\s\S]*?)<\/script>/);
 if (!m) throw Error('不是有效的房间文件');
 return validate(JSON.parse(m[1]));
}

// A complete file for any config (a new room, a converted one, a blank
// creator), from the exact script and style bytes this page runs with.
export async function htmlFor(config, { script, style, comment = '' }) {
 if (typeof script !== 'string' || typeof style !== 'string' || /<\/script/i.test(script) || /<\/style/i.test(style)) throw Error('脚本或样式不可用');
 if (config.version) validate(config); else validateBlank(config);
 return roomHtml(config, script, style, await digest(script), await digest(style), comment).html;
}
