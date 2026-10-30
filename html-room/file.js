// One file, three roles:
//   room file      a room's config: chat; plus "换中继" and "创建新房间"
//   blank file     no room: the creator (the offline generator, and the site)
//   blank + #hr1=  a room link opened on the hosted creator: chat
// Creating and converting happen here, offline: new files are built from the
// exact script and style bytes this page runs with (html-room/template.js),
// so they are byte-identical to a release build and pass verify-room-file.
import { boot } from './client.js';
import { makeConfig, relayList, validate, validateBlank, readablePassword, DEFAULT_TITLE } from './crypto.js';
import { copyText, showToggle } from './ui.js';
import { drawQr } from './qr.js';
import { configFromHash, fragmentFor } from './transport.js';
import { retargetHtml, htmlFor, withRelays, configFromRoomHtml } from './template.js';

// Read before anything else: the bytes CSP already pinned by hash.
const ownScript = document.currentScript?.textContent, ownStyle = document.querySelector('style')?.textContent;
// The relay half (the comment before <!doctype html>), carried into every new file.
const ownComment = document.firstChild?.nodeType === Node.COMMENT_NODE ? document.firstChild.data : '';
const own = { script: ownScript, style: ownStyle, comment: ownComment };
const el = id => document.getElementById(id);
const hosted = /^https?:$/.test(location.protocol);
const cjk = e => /[一-鿿]/.test(e?.message ?? '');
const urls = new Map();
function offer(id, html) {
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  urls.set(id, url); el(id).href = url; el(id).hidden = false;
}
addEventListener('pagehide', () => { for (const url of urls.values()) URL.revokeObjectURL(url); });

let config;
try { config = JSON.parse(el('pt-room-config').textContent); } catch { config = null; }

function enableRetarget(config) {
  const say = t => { el('rt-status').textContent = t; };
  el('retarget').hidden = false; el('rt-relay').value = config.relays.join(' '); el('rt-title').value = config.title ?? '';
  el('rt-make').addEventListener('click', async () => {
    el('rt-download').hidden = true; el('rt-make').disabled = true; say('');
    try {
      const r = await retargetHtml(config, el('rt-relay').value, own, undefined, el('rt-title').value);
      if (JSON.stringify(r.config.relays) === JSON.stringify(config.relays) && r.config.title === config.title) { say('中继和标题都和现在一样，不用生成。'); return; }
      offer('rt-download', r.html);
      say(`新文件「${r.config.title ?? DEFAULT_TITLE}」已生成（中继：${r.config.relays.join('、')}）。口令不变。请把它发给所有人，大家都用新文件打开，再核对一次安全码。`);
    } catch (e) { say(cjk(e) ? `生成失败：${e.message}。` : '生成失败：地址格式不对。例子：wss://relay.example.com'); }
    finally { el('rt-make').disabled = false; }
  });
}

// The creator. defaults: relays to start from.
function enableMaker(defaults, { open, siteTitle }) {
  const fail = t => { el('mk-error').textContent = t; };
  el('new-room').hidden = false;
  if (open) { el('new-room').open = true; el('new-room').querySelector('summary').hidden = true; }
  el('mk-relay').value = defaults.join(' ');
  if (!defaults.length) el('mk-advanced').open = true;
  const pass = showToggle(el('mk-pass'), el('mk-show'));
  el('mk-pass').addEventListener('input', () => { el('mk-copy-pass').hidden = !el('mk-pass').value; });
  // A generated password is shown, so it can be read out and copied.
  el('mk-gen').addEventListener('click', () => {
    el('mk-pass').value = readablePassword(); pass.show(true); el('mk-copy-pass').hidden = false;
    fail('已生成口令，显示在上面。可以点「复制口令」。');
  });
  el('mk-copy-pass').addEventListener('click', () => copyText(el('mk-pass')).then(ok => fail(ok ? '口令已复制。请换一种方式告诉朋友，别和文件一起发。' : '复制失败：口令已选中，请手动复制。')));
  el('mk-pass-copy').addEventListener('click', () => copyText(el('mk-pass-out')).then(ok => fail(ok ? '口令已复制。请换一种方式告诉朋友，别和文件一起发。' : '复制失败：口令已选中，请手动复制。')));
  // Classic relays of this project also forward decentralized rooms on /bc/.
  el('mk-mesh').addEventListener('click', () => {
    const list = el('mk-relay').value.trim().split(/[\s,]+/).filter(Boolean).map(r => /^wss?:\/\//.test(r) ? `bc+${r.replace(/\/+$/, '')}/bc/` : r);
    el('mk-relay').value = list.join(' ');
    fail(list.length ? '已换成去中心化中继。还可以在后面加上 nostr+wss://… 或 mqtt+wss://… 当备份。' : '先填一个中继地址，例如 bc+wss://relay.example.com');
  });
  el('maker').addEventListener('submit', async event => {
    event.preventDefault(); el('mk-make').disabled = true; fail(''); el('mk-out').hidden = true;
    try {
      const relays = relayList(el('mk-relay').value), password = el('mk-pass').value;
      if (password && new TextEncoder().encode(password).length > 1024) throw Error('口令太长了');
      const next = await makeConfig(relays, password || undefined, { custom: el('mk-custom').checked, title: el('mk-title').value });
      offer('mk-download', await htmlFor(next, own));
      el('mk-out').hidden = false;
      // The password stays readable with the result: losing it loses the room.
      el('mk-pass-out').value = password; el('mk-pass-row').hidden = !password;
      el('mk-pass').value = ''; pass.show(false); el('mk-copy-pass').hidden = true;
      // A link only works on a hosted creator, which can open any room.
      showQr(false);
      if (hosted) { el('mk-link').value = location.origin + location.pathname + fragmentFor(next); el('mk-link-row').hidden = false; }
      else { el('mk-link').value = ''; el('mk-link-row').hidden = true; }
      fail(password ? '✅ 房间建好了。口令请换一种方式告诉朋友（比如打电话），别和文件一起发。' : '✅ 房间建好了。文件就是钥匙，请只发给要聊天的人。');
    } catch (e) { fail(cjk(e) ? `创建失败：${e.message}` : '创建失败，请检查中继地址后再试。'); el('mk-advanced').open = true; }
    finally { el('mk-make').disabled = false; }
  });
  // The QR code is drawn here on a canvas: no image, library or network request.
  const showQr = on => {
    el('mk-qr-row').hidden = !on; el('mk-qr').textContent = on ? '隐藏二维码' : '生成二维码'; el('mk-qr').setAttribute('aria-expanded', String(on));
    if (!on) { const c = el('mk-qr-out'); c.width = c.height = 0; }
  };
  el('mk-qr').addEventListener('click', () => {
    if (!el('mk-qr-row').hidden) { showQr(false); return; }
    try { drawQr(el('mk-qr-out'), el('mk-link').value, 720); showQr(true); }
    catch (e) { fail(cjk(e) ? e.message : '二维码生成失败，请改用复制链接。'); }
  });
  el('mk-copy').addEventListener('click', () => copyText(el('mk-link')).then(ok => fail(ok ? '已复制。链接就是钥匙，请只发给要聊天的人。' : '复制失败：链接已选中，请手动复制。')));
  el('cv-make').addEventListener('click', async () => {
    const say = t => { el('cv-error').textContent = t; }; el('cv-download').hidden = true; el('cv-make').disabled = true; say('');
    try {
      const file = el('cv-file').files?.[0]; if (!file) throw Error('请先选择房间文件');
      if (file.size > 400000) throw Error('这个文件太大了，不是房间文件');
      let old; try { old = configFromRoomHtml(await file.text()); } catch { throw Error('读不出房间信息。如果是很早的旧版文件，请重新创建房间'); }
      const next = withRelays(old, el('cv-relay').value, el('cv-custom').checked);
      offer('cv-download', await htmlFor(next, own));
      say(`新文件已生成（中继：${next.relays.join('、')}）。${next.encrypted ? '口令不变。' : ''}请把它发给所有人，大家都用新文件打开，再核对一次安全码。`);
    } catch (e) { say(cjk(e) ? e.message : '生成失败：请检查中继地址。'); }
    finally { el('cv-make').disabled = false; }
  });
  // On the site: the page itself, saved as a blank creator, works offline.
  if (hosted) htmlFor({ ...(defaults.length && { relays: defaults }), ...(siteTitle && { title: siteTitle }) }, own).then(html => { offer('mk-self', html); el('mk-self-row').hidden = false; }).catch(() => {});
}

function creatorOnly() {
  for (const id of ['risk', 'status', 'preview-help', 'unlock', 'retarget', 'relay-status', 'presence', 'safety', 'messages', 'chat']) el(id).hidden = true;
  document.querySelector('h1').hidden = true;
}

function openLink(hash) {
  history.replaceState(null, '', location.pathname + location.search);
  let room;
  try { room = configFromHash(hash); }
  catch { el('status').hidden = false; el('status').textContent = '房间链接打不开：链接不完整或已损坏。请让对方重发链接，或直接用房间文件。'; el('enter').disabled = true; return false; }
  boot(room);
  return true;
}

const ready = ownScript && ownStyle;
try {
  if (config?.version) {
    validate(config); boot(config);
    if (ready) { enableRetarget(config); enableMaker(config.relays, { open: false }); }
  } else if (config) {
    validateBlank(config);
    const defaults = config.relays ?? (hosted ? [location.origin.replace(/^http/, 'ws')] : []);
    if (location.hash.startsWith('#hr1=')) {
      // A room link: chat here; the creator stays folded below.
      el('new-room').hidden = true;
      if (openLink(location.hash) && ready) enableMaker(defaults, { open: false });
    } else {
      creatorOnly();
      if (ready) enableMaker(defaults, { open: true, siteTitle: config.title });
      addEventListener('hashchange', () => { if (location.hash.startsWith('#hr1=')) location.reload(); });
    }
  } else throw Error('bad config');
} catch {
  el('status').hidden = false; el('status').textContent = '房间文件有问题，请让对方重新发一份。'; el('enter').disabled = true;
}
