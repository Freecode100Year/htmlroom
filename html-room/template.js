// The single source of the room file's HTML. The build script renders it in
// Node; a room file uses the same function to re-emit itself with another
// relay list, so a re-targeted file is byte-identical to a fresh build and
// passes scripts/verify-room-file.mjs.
import { validate, relayList, versionFor, connectSources } from './crypto.js';
import { escapeConfig, previewHelp } from './transport.js';

export const cspFor = (config, scriptHash, styleHash) =>
 `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src ${config.version?connectSources(config).join(' '):"'none'"}; base-uri 'none'; form-action 'none'`;

export const REPO = 'https://github.com/Freecode100Year/htmlroom.git';
export const repoLink = `<a href="${REPO}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">github.com/Freecode100Year/htmlroom</a>`;

// Hidden until file.js enables it, so the copy embedded in the web entry stays inert.
const RETARGET = `<details id="retarget" hidden><summary>生成换了中继的新文件（发给大家）</summary><p>中继是帮大家传消息的服务器，它看不到聊天内容。填上新地址，会生成一份新的房间文件：还是同一个房间，口令也不变。把新文件发给所有人，大家打开就自动用新中继。</p><label for="rt-relay">新的中继地址（多个用空格隔开）</label><p class="hint">例如 <code>wss://relay.example.com</code>；去中心化中继写成 <code>bc+wss://…</code>、<code>nostr+wss://…</code> 或 <code>mqtt+wss://…/mqtt</code>。</p><input id="rt-relay" maxlength="1200" autocomplete="off" spellcheck="false"><button id="rt-make" type="button">生成新文件</button><p id="rt-status" role="status"></p><a id="rt-download" download="index.html" hidden>下载新的房间文件</a></details>`;

export function roomHtml(config, script, style, scriptHash, styleHash) {
 const csp = cspFor(config, scriptHash, styleHash);
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>加密聊天房间</title><style>${style}</style></head><body><h1>加密聊天房间</h1><aside id="risk">这个文件就是房间钥匙，拿到它的人都能进来，请只发给要聊天的人。设了口令的话，口令请换一种方式告诉对方（比如打电话）。</aside><p id="status" role="status">正在启动……如果一直停在这里，请看下面的说明。</p>${previewHelp(config)}<form id="unlock"><label for="password">口令（没设口令就直接点「进入房间」）</label><input id="password" disabled type="password" maxlength="1024" autocomplete="off"><div id="custom-relay" hidden><label for="relay-input">中继服务器（可以改成任意 wss:// 地址，多个用空格隔开）</label><input id="relay-input" maxlength="1200" autocomplete="off" spellcheck="false"><p class="hint">只对这次打开有效，不会改动文件。大家要连同一个中继才能互相看到消息；去中心化中继（<code>bc+</code> / <code>nostr+</code> / <code>mqtt+</code>）只要有一个相同就行。</p></div><button id="enter" disabled>进入房间</button></form>${RETARGET}<p id="relay-status" role="status"></p><p id="presence"></p><p id="safety"></p><ol id="messages" aria-live="polite"></ol><form id="chat" hidden><label for="text">消息（最多 500 字）</label><textarea id="text" maxlength="500"></textarea><button id="send">发送</button></form><footer><p class="hint">HTML Room 开源项目：${repoLink}</p></footer><script id="pt-room-config" type="application/json">${escapeConfig(config)}</script><script>${script}</script></body></html>\n`;
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
export async function retargetHtml(config, input, script, style, custom) {
 if (typeof script !== 'string' || typeof style !== 'string' || /<\/script/i.test(script) || /<\/style/i.test(style)) throw Error('脚本或样式不可用');
 const next = withRelays(config, input, custom);
 return { config: next, ...roomHtml(next, script, style, await digest(script), await digest(style)) };
}

export function configFromRoomHtml(html) {
 if (typeof html !== 'string' || html.length > 400000) throw Error('不是有效的房间文件');
 const m = html.match(/<script id="pt-room-config" type="application\/json">([\s\S]*?)<\/script>/);
 if (!m) throw Error('不是有效的房间文件');
 return validate(JSON.parse(m[1]));
}
