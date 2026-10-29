// The single source of the room file's HTML. The build script renders it in
// Node; a room file uses the same function to re-emit itself with another
// relay list, so a re-targeted file is byte-identical to a fresh build and
// passes scripts/verify-room-file.mjs.
import { validate, relayList } from './crypto.js';
import { escapeConfig, previewHelp } from './transport.js';

export const cspFor = (config, scriptHash, styleHash) =>
 `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src ${config.version?config.relays.join(' '):"'none'"}; base-uri 'none'; form-action 'none'`;

// Hidden until file.js enables it, so the copy embedded in the web entry stays inert.
const RETARGET = `<details id="retarget" hidden><summary>更换中继（例如改用自建 wss:// 中继）</summary><p>生成一份只改中继地址的新房间文件：房间密钥、口令和房间号都不变，生成时无需口令。所有成员须改用同一份新文件，连到不同中继的成员互相看不到消息；切换后请重新核对安全码。新中继的运营者能看到房间号和入房凭证，但无法解密消息。</p><label for="rt-relay">新中继源（按优先级 1–3 个，空格或逗号分隔；保留旧中继即作备用）</label><input id="rt-relay" maxlength="650" autocomplete="off" spellcheck="false"><button id="rt-make" type="button">生成新房间文件</button><p id="rt-status" role="status"></p><a id="rt-download" download="index.html" hidden>下载新房间文件</a></details>`;

export function roomHtml(config, script, style, scriptHash, styleHash) {
 const csp = cspFor(config, scriptHash, styleHash);
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>私密 HTML 聊天房间</title><style>${style}</style></head><body><h1>私密聊天房间</h1><aside id="risk">此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。口令模式也可被离线猜测；建议高熵密码，通过独立渠道传递口令。</aside><p id="status" role="status">聊天脚本尚未启动，请查看下方浏览器打开说明。</p>${previewHelp(config)}<form id="unlock"><label for="password">房间口令（无口令文件可直接进入）</label><input id="password" disabled type="password" maxlength="1024" autocomplete="off"><button id="enter" disabled>解锁并进入</button></form>${RETARGET}<p id="relay-status" role="status"></p><p id="presence"></p><p id="safety"></p><ol id="messages" aria-live="polite"></ol><form id="chat" hidden><label for="text">消息（最多 500 字）</label><textarea id="text" maxlength="500"></textarea><button id="send">发送</button></form><script id="pt-room-config" type="application/json">${escapeConfig(config)}</script><script>${script}</script></body></html>\n`;
 return { html, csp };
}

// Same room (version, roomId, master or wrapped master untouched), new relays.
// Relays are public routing data: not part of the roomId derivation or the
// password-wrap AAD, so no password is needed and nothing secret changes.
export function withRelays(config, input) {
 validate(config);
 return validate({ ...config, relays: relayList(input) });
}

const digest = async s => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))));
export async function retargetHtml(config, input, script, style) {
 if (typeof script !== 'string' || typeof style !== 'string' || /<\/script/i.test(script) || /<\/style/i.test(style)) throw Error('脚本或样式不可用');
 const next = withRelays(config, input);
 return { config: next, ...roomHtml(next, script, style, await digest(script), await digest(style)) };
}

export function configFromRoomHtml(html) {
 if (typeof html !== 'string' || html.length > 400000) throw Error('不是有效的房间文件');
 const m = html.match(/<script id="pt-room-config" type="application\/json">([\s\S]*?)<\/script>/);
 if (!m) throw Error('不是有效的房间文件');
 return validate(JSON.parse(m[1]));
}
