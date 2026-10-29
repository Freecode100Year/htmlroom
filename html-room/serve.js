// The server half of the room file. Every room file and the blank creator is
// also a Node script: `node index.html` runs this as a relay, with nothing to
// install (Node 18+ standard library only). The browser never runs it: it sits
// in an HTML comment before <!doctype html>, and the HTML after it sits in a
// JS block comment (see html-room/template.js).
//
//   /hr/<roomId>   classic rooms (same rules as server/server.mjs)
//   /bc/<topic>    decentralized rooms (plain broadcast)
//   / , /hr.html   the page itself, only when this file holds no room
//   /healthz
//
// A room file never serves itself: that would hand its key to every visitor.
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  MAX_MEMBERS, MAX_FRAME, ROOM_ID, PONG, CLOSE_BUSY, CLOSE_LEFT, CLOSE_FULL, CLOSE_CAPACITY, CLOSE_DENIED, PLAIN_HEADERS, JOINS_PER_MINUTE,
  PROTOCOL, WIRE_VERSION, BC_TOPIC, BC_MAX_FRAME, BC_MAX_PEERS, broadcastFrameBad, emptyBook, admit, depart, awayNumbers, token, hostOf,
  parseProtocols, accessMatches
} from '../src/rules.js';
import { htmlRoomOrigin, checkHtmlRoomFrame } from '../src/html-room.js';

const HELP = `用法：node index.html [选项]
  --port N            端口（默认 8080）
  --host H            监听地址（默认 0.0.0.0）
  --tunnel            用 Cloudflare 临时隧道获得公网 wss:// 地址（需要 cloudflared）
  --cloudflared PATH  cloudflared 的位置
  --tls-cert F --tls-key F   直接提供 wss://
  --allow-origin A,B  允许从这些 https 网页连入（文件打开的 null 始终允许）
  --join-limit N      每个地址每分钟最多进房次数（默认 ${JOINS_PER_MINUTE}）
  --max-conns N       最多连接数（默认 2000）`;

function options(argv) {
  const o = { port: 8080, host: '0.0.0.0', tunnel: false, cloudflared: 'cloudflared', allow: [], joinLimit: JOINS_PER_MINUTE, maxConns: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw Error(`${a} 需要一个值`); return argv[++i]; };
    if (a === '--port') o.port = Number(v());
    else if (a === '--host') o.host = v();
    else if (a === '--tunnel') o.tunnel = true;
    else if (a === '--cloudflared') o.cloudflared = v();
    else if (a === '--tls-cert') o.cert = v();
    else if (a === '--tls-key') o.key = v();
    else if (a === '--allow-origin') o.allow = v().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--join-limit') o.joinLimit = Number(v());
    else if (a === '--max-conns') o.maxConns = Number(v());
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else throw Error(`未知参数：${a}`);
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw Error('端口无效');
  if (!!o.cert !== !!o.key) throw Error('--tls-cert 和 --tls-key 要一起用');
  if (o.allow.some(x => !/^https:\/\/[^/]+$/.test(x))) throw Error('--allow-origin 只接受精确的 https:// 来源');
  return o;
}

// ---- WebSocket (RFC 6455, server side, text only) ---------------------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(op, payload = Buffer.alloc(0)) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])]);
  return Buffer.concat([head, payload]);
}
class Socket {
  constructor(sock, max, onmessage, onclose) {
    Object.assign(this, { sock, max, onmessage, onclose, buf: Buffer.alloc(0), parts: null, open: true, alive: true });
    sock.setNoDelay(true);
    sock.on('data', d => this.data(d));
    sock.on('close', () => this.gone(1006));
    sock.on('error', () => sock.destroy());
  }
  send(text) { if (this.open) this.sock.write(frame(1, Buffer.from(text))); }
  ping() { if (this.open) this.sock.write(frame(9)); }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code); p.write(reason, 2);
    this.sock.write(frame(8, p)); this.gone(code);
    setTimeout(() => this.sock.destroy(), 1000).unref();
    this.sock.end();
  }
  gone(code) { if (!this.open) return; this.open = false; this.onclose(code); }
  data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.open && this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1], op = b0 & 15, fin = !!(b0 & 128);
      let len = b1 & 127, at = 2;
      if (!(b1 & 128) || (b0 & 0x70)) { this.close(1002, 'protocol'); return; }
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; if (this.buf.readUInt32BE(2)) { this.close(1009, 'too big'); return; } len = this.buf.readUInt32BE(6); at = 10; }
      if (len > this.max || (op >= 8 && len > 125)) { this.close(1009, 'too big'); return; }
      if (this.buf.length < at + 4 + len) return;
      const mask = this.buf.subarray(at, at + 4), payload = Buffer.from(this.buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(at + 4 + len);
      this.alive = true;
      // The page's own close code (CLOSE_LEFT: left on purpose) reaches the room as is.
      if (op === 8) { this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000); return; }
      if (op === 9) { this.sock.write(frame(10, payload)); continue; }
      if (op === 10) continue;
      if (op === 2 || (op === 0 && this.parts?.binary)) { this.onmessage(null); this.parts = op === 2 && !fin ? { binary: true } : null; continue; }
      if (op === 1) this.parts = { data: [payload] }; else if (op === 0 && this.parts) this.parts.data.push(payload); else { this.close(1002, 'protocol'); return; }
      const total = this.parts.data.reduce((n, p) => n + p.length, 0);
      if (total > this.max) { this.close(1009, 'too big'); return; }
      if (fin) { const text = Buffer.concat(this.parts.data).toString('utf8'); this.parts = null; this.onmessage(text); }
    }
  }
}

export function serve(self, filename, argv = process.argv.slice(2)) {
  let o;
  try { o = options(argv); } catch (e) { console.error(e.message + '\n\n' + HELP); process.exit(2); }
  const config = (() => { try { return JSON.parse(self.match(/\x3cscript id="pt-room-config" type="application\/json">([\s\S]*?)\x3c\/script>/)[1]); } catch { return null; } })();
  const blank = config && !config.version;
  const csp = self.match(/\x3cmeta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  const page = Buffer.from(self);
  const pageHeaders = {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Opener-Policy': 'same-origin', 'Content-Security-Policy': `${csp}; frame-ancestors 'none'`
  };
  const tls = o.cert ? { cert: readFileSync(o.cert), key: readFileSync(o.key) } : null;
  const handler = (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/healthz') { res.writeHead(200, { ...PLAIN_HEADERS, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, kind: 'file', room: !blank })); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, PLAIN_HEADERS).end(); return; }
    if (['/', '/hr.html', '/index.html'].includes(path)) {
      if (blank && csp) { res.writeHead(200, pageHeaders).end(req.method === 'HEAD' ? undefined : page); return; }
      res.writeHead(200, { ...PLAIN_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('HTML Room 中继正在运行。\n这个中继由一个房间文件运行，为了不泄露房间钥匙，它不提供网页。\n');
      return;
    }
    res.writeHead(404, PLAIN_HEADERS).end();
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const clients = new Set(), rooms = new Map(), topics = new Map(), joins = new Map();
  const allowJoin = ip => {
    const now = Date.now(), list = (joins.get(ip) ?? []).filter(t => now - t < 60000);
    if (list.length >= o.joinLimit) { joins.set(ip, list); return false; }
    list.push(now); joins.set(ip, list); return true;
  };
  setInterval(() => { const now = Date.now(); for (const [ip, l] of joins) if (!l.some(t => now - t < 60000)) joins.delete(ip); }, 60000).unref();

  const sendTo = (ws, obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  const broadcast = (room, obj, to) => { const out = JSON.stringify(obj); for (const p of room.peers) if (!to || to.includes(p.state.n)) p.send(out); };
  const members = room => {
    const host = hostOf([...room.peers].map(p => [p.state.n, p.state.seq]));
    broadcast(room, { type: 'members', members: [...room.peers].map(p => p.state.n).sort((a, b) => a - b), host, max: MAX_MEMBERS, locked: room.book.locked, away: awayNumbers(room.book) });
  };
  function enter(ws, roomId, ip, resume) {
    if (clients.size > o.maxConns) return ws.close(CLOSE_CAPACITY, 'capacity');
    if (!allowJoin(ip)) return ws.close(CLOSE_BUSY, 'busy');
    const room = rooms.get(roomId) ?? { peers: new Set(), book: emptyBook() };
    const r = admit(room.book, new Map([...room.peers].map(p => [p.state.n, p.state.resume])), resume);
    if (r.refuse) return ws.close(r.refuse, 'refused');
    rooms.set(roomId, room); room.book = r.book;
    let seq = r.seq, sent = r.sent ?? 0;
    if (r.replace) { const old = [...room.peers].find(p => p.state.n === r.replace); seq = old.state.seq; sent = old.state.sent ?? 0; room.peers.delete(old); old.close(4005, 'replaced'); }
    const n = r.n;
    ws.state = { n, seq, resume: token(), window: 0, count: 0, sent };
    room.peers.add(ws);
    sendTo(ws, { type: 'hello', you: n, now: Date.now(), resume: ws.state.resume, v: WIRE_VERSION, seen: true, files: false, lobby: false, hr: 1 });
    members(room);
    ws.onmessage = raw => {
      const f = checkHtmlRoomFrame(raw, ws.state);
      if (!f) return;
      if (f.close) return ws.close(...f.close);
      if (f.pong) return sendTo(ws, PONG);
      if (f.wait) return sendTo(ws, { type: 'wait', ms: f.wait });
      if (f.key) return broadcast(room, { type: 'key', from: n, ...f.key }, f.to);
      if (f.seen) return broadcast(room, { type: 'seen', from: n, ...f.seen });
      broadcast(room, { type: 'msg', from: n, at: f.at, ...f.msg });
    };
    ws.onclose = code => {
      clients.delete(ws);
      if (!room.peers.delete(ws)) return;
      if (!room.peers.size) { rooms.delete(roomId); return; }
      room.book = depart(room.book, n, ws.state.resume, code === CLOSE_LEFT, Date.now(), ws.state.sent);
      members(room);
    };
  }
  function enterBroadcast(ws, topic, ip) {
    if (clients.size > o.maxConns) return ws.close(CLOSE_CAPACITY, 'capacity');
    if (!allowJoin(ip)) return ws.close(CLOSE_BUSY, 'busy');
    const peers = topics.get(topic) ?? new Set();
    if (peers.size >= BC_MAX_PEERS) return ws.close(CLOSE_FULL, 'full');
    topics.set(topic, peers); peers.add(ws); ws.state = { window: 0, count: 0 };
    ws.onmessage = raw => { if (broadcastFrameBad(raw, ws.state)) return ws.close(1008, 'bad frame'); for (const p of peers) if (p !== ws) p.send(raw); };
    ws.onclose = () => { clients.delete(ws); peers.delete(ws); if (!peers.size) topics.delete(topic); };
  }
  server.on('upgrade', (req, sock) => {
    const reject = status => sock.end(`HTTP/1.1 ${status}\r\n${Object.entries(PLAIN_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('')}Connection: close\r\n\r\n`);
    const path = new URL(req.url, 'http://x').pathname, key = req.headers['sec-websocket-key'];
    if (!key || req.headers['sec-websocket-version'] !== '13' || !/websocket/i.test(req.headers.upgrade ?? '')) return reject('400 Bad Request');
    const ip = req.socket.remoteAddress || 'unknown', self = `${tls ? 'https' : 'http'}://${req.headers.host}`;
    const okOrigin = htmlRoomOrigin(req.headers.origin, self, o.allow);
    const accept = (protocol, max, then) => {
      const head = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}`, ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : [])];
      sock.write(head.join('\r\n') + '\r\n\r\n');
      const ws = new Socket(sock, max, raw => ws.onmessage?.(raw), code => ws.onclose?.(code));
      clients.add(ws); then(ws);
    };
    const b = path.match(/^\/bc\/([0-9a-f]+)$/), m = path.match(/^\/hr\/([0-9a-f]+)$/);
    if (b && BC_TOPIC.test(b[1])) { if (!okOrigin) return reject('403 Forbidden'); return accept(null, BC_MAX_FRAME, ws => enterBroadcast(ws, b[1], ip)); }
    if (!m || !ROOM_ID.test(m[1])) return reject('404 Not Found');
    if (!okOrigin) return reject('403 Forbidden');
    const proto = parseProtocols(req.headers['sec-websocket-protocol']);
    accessMatches(m[1], proto.access).then(ok => {
      if (!proto.ok || !ok) return reject('403 Forbidden');
      accept(PROTOCOL, MAX_FRAME, ws => enter(ws, `hr:${m[1]}`, ip, proto.resume));
    }, () => reject('403 Forbidden'));
  });
  // Drop connections that stopped answering.
  setInterval(() => { for (const ws of clients) { if (!ws.alive) { ws.sock.destroy(); continue; } ws.alive = false; ws.ping(); } }, 30000).unref();

  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${o.port} 已被占用，换一个：node ${filename} --port 8081` : `无法启动：${e.message}`); process.exit(1); });
  server.listen(o.port, o.host, () => {
    const port = server.address().port, ws = tls ? 'wss' : 'ws';
    console.log(`HTML Room relay listening on ${tls ? 'https' : 'http'}://${o.host}:${port}`);
    console.log(blank ? `\n创建页面：${tls ? 'https' : 'http'}://127.0.0.1:${port}/` : '\n这是房间文件运行的中继（不提供网页，以免泄露房间钥匙）。');
    console.log(`本机可用的中继：${ws}://127.0.0.1:${port}  或去中心化  bc+${ws}://127.0.0.1:${port}/bc/`);
    if (!tls && !o.tunnel) console.log('其他设备需要 wss://：加 --tunnel 获得免费公网地址，或用 --tls-cert / --tls-key。');
    if (o.tunnel) tunnel(port);
  });
  function tunnel(port) {
    const child = spawn(o.cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.on('error', () => console.error('无法启动 cloudflared。请先安装：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
    let found = false, rest = '';
    child.stderr.on('data', d => {
      rest = (rest + d).slice(-4096);
      const u = !found && rest.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (u) { found = true; const host = u[0].slice(8); console.log(`\n公网地址已就绪（临时，重启会变）：\n  ${blank ? `创建页面  https://${host}/\n  ` : ''}经典中继  wss://${host}\n  去中心化  bc+wss://${host}/bc/\n`); }
    });
    for (const sig of ['exit', 'SIGINT', 'SIGTERM']) process.once(sig, () => child.kill());
  }
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
    if (stopping) process.exit(0);
    stopping = true; server.close();
    for (const ws of clients) ws.close(1012, 'restart');
    setTimeout(() => process.exit(0), clients.size ? 500 : 0);
  });
  return server;
}

// Run as the room file: `node index.html`.
if (typeof require !== 'undefined' && require.main === module) serve(readFileSync(__filename, 'utf8'), require('node:path').basename(__filename));
