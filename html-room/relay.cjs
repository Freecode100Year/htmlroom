// HTML Room: this same index.html is also a relay server. Run: node index.html
// Options: --port 8080 --host 0.0.0.0 --tls-cert c.pem --tls-key k.pem --tunnel
// It forwards text frames on /bc/<topic> to the other connections on that topic
// (decentralized rooms: bc+wss://<host>/bc/). A blank creator file is also
// served at / as the website; a room file never is: it holds the room key.
// Node 18+, no packages. Keeps nothing on disk, logs no topics or addresses.
const http = require('node:http'), https = require('node:https'), fs = require('node:fs'), crypto = require('node:crypto'), cp = require('node:child_process');
const args = process.argv.slice(2), opt = n => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1]; };
if (args.includes('--help') || args.includes('-h')) { console.log('node index.html [--port 8080] [--host 0.0.0.0] [--tls-cert c.pem --tls-key k.pem] [--tunnel] [--cloudflared path]'); process.exit(0); }
const PORT = Number(opt('port') ?? process.env.PORT ?? 8080), HOST = opt('host') ?? process.env.HOST ?? '0.0.0.0';
const LIMIT = { frame: 16000, rate: 60, peers: 50, conns: 2000 };
const self = fs.readFileSync(__filename, 'utf8');
const TAG = 'scr' + 'ipt'; // spelled apart: this code sits inside the page's leading comment
const configText = (self.match(new RegExp('<' + TAG + ' id="pt-room-config" type="application/json">([\\s\\S]*?)</' + TAG + '>')) || [])[1] ?? '';
let config = null; try { config = JSON.parse(configText); } catch {}
const blank = !!config && config.version === undefined;
const topics = new Map(); let total = 0;

// The website: the creator, with this server as its default relay.
function page(req) {
  const host = String(req.headers.host || '');
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return self;
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const relay = `bc+${secure ? 'wss' : 'ws'}://${host.toLowerCase().replace(secure ? /:443$/ : /:80$/, '')}/bc/`;
  const json = JSON.stringify({ relays: [relay] }).replace(/[<>/  ]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return self.replace('type="application/json">' + configText + '</', () => 'type="application/json">' + json + '</');
}
function serve(req, res) {
  const head = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const path = req.url.split('?')[0];
  if (path === '/healthz') { res.writeHead(200, { ...head, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, kind: 'bc', site: blank })); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, head).end(); return; }
  if (path === '/' || path === '/index.html' || path === '/hr.html') {
    if (!blank) { res.writeHead(200, { ...head, 'Content-Type': 'text/plain; charset=utf-8' }).end('HTML Room 中继正在运行。这是房间文件（含房间钥匙），不会在网上提供；用离线创建器运行，这里就会显示创建页面。\n'); return; }
    const body = Buffer.from(page(req));
    res.writeHead(200, { ...head, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'X-Frame-Options': 'DENY' }).end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  res.writeHead(404, { ...head, 'Content-Type': 'text/plain; charset=utf-8' }).end('not found\n');
}

function frame(op, payload = Buffer.alloc(0)) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
  return head ? Buffer.concat([head, payload]) : null;
}
function upgrade(req, socket) {
  const m = req.url.split('?')[0].match(/^\/bc\/([A-Za-z0-9_-]{8,128})$/), key = req.headers['sec-websocket-key'];
  const refuse = s => { socket.end(`HTTP/1.1 ${s}\r\nConnection: close\r\n\r\n`); };
  if (!m || !key || req.headers['sec-websocket-version'] !== '13') return refuse('400 Bad Request');
  const peers = topics.get(m[1]) ?? new Set();
  if (total >= LIMIT.conns || peers.size >= LIMIT.peers) return refuse('503 Service Unavailable');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  topics.set(m[1], peers); peers.add(socket); total++;
  socket.setNoDelay(true);
  let buf = Buffer.alloc(0), parts = [], size = 0, window = 0, count = 0, alive = true, gone = false;
  const ping = setInterval(() => { if (!alive) return end(); alive = false; socket.write(frame(9)); }, 30000);
  const end = (code) => {
    if (gone) return; gone = true; clearInterval(ping);
    if (code) { const p = Buffer.alloc(2); p.writeUInt16BE(code); try { socket.write(frame(8, p)); } catch {} }
    socket.end(); setTimeout(() => socket.destroy(), 1000).unref();
    peers.delete(socket); total--; if (!peers.size) topics.delete(m[1]);
  };
  socket.on('close', () => end()); socket.on('error', () => end());
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80; let len = buf[1] & 127, at = 2;
      if (!masked || buf[0] & 0x70) return end(1002);
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) return end(1009);
      if (len > LIMIT.frame) return end(1009);
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len); alive = true;
      if (op === 8) return end(1000);
      if (op === 9) { socket.write(frame(10, data)); continue; }
      if (op === 10) continue;
      if (op !== 1 && op !== 0) return end(1003); // text only
      if (op === 1) { parts = []; size = 0; }
      parts.push(data); size += data.length;
      if (size > LIMIT.frame) return end(1009);
      if (!fin) continue;
      const w = Math.floor(Date.now() / 10000); if (w !== window) { window = w; count = 0; }
      if (++count > LIMIT.rate) return end(1008);
      const out = frame(1, Buffer.concat(parts)); parts = [];
      for (const peer of peers) if (peer !== socket && !peer.destroyed) peer.write(out);
    }
  });
}

const tls = opt('tls-cert') ? { cert: fs.readFileSync(opt('tls-cert')), key: fs.readFileSync(opt('tls-key')) } : null;
const server = tls ? https.createServer(tls, serve) : http.createServer(serve);
server.on('upgrade', upgrade);
server.on('error', e => { console.error('无法启动：' + e.message); process.exit(1); });
server.listen(PORT, HOST, () => {
  const s = tls ? 's' : '', port = server.address().port;
  console.log(`HTML Room 中继已启动：${tls ? 'https' : 'http'}://127.0.0.1:${port}/`);
  console.log(`本机房间可填：bc+ws${s}://127.0.0.1:${port}/bc/`);
  if (!blank) console.log('（这是房间文件，只当中继用；网页不会对外提供）');
  if (args.includes('--tunnel')) {
    const cf = cp.spawn(opt('cloudflared') ?? 'cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    let found = false;
    cf.on('error', () => console.error('需要 cloudflared：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
    cf.stderr.on('data', d => { const u = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (u && !found) { found = true; const h = u[0].slice(8);
      console.log(`\n公网中继已就绪（临时地址，重启后会变）：\n\n    bc+wss://${h}/bc/\n`); if (blank) console.log(`网站（创建页面）：https://${h}/\n`); } });
    const stop = () => { cf.kill(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }
});
