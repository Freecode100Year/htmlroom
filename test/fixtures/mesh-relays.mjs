// Local stand-ins for the relays a decentralized room can use.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WebSocketServer, createWebSocketStream } from 'ws';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { Aedes } from 'aedes';

const root = new URL('../../', import.meta.url).pathname;
const hex = u8 => Buffer.from(u8).toString('hex');
async function healthy(url) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw Error('fixture did not start: ' + url);
}
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// This project's Node server (classic /hr/ and broadcast /bc/).
export async function nodeRelay(env = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [root + 'server/server.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env }, stdio: 'ignore' });
  await healthy(`http://127.0.0.1:${port}/healthz`);
  return { port, url: `ws://127.0.0.1:${port}`, stop: () => new Promise(r => { if (child.exitCode !== null || child.signalCode) return r(); child.once('exit', r); child.kill('SIGTERM'); }) };
}

let goBinary;
export function goAvailable() { try { execFileSync('go', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } }
export async function goRelay(args = []) {
  if (!goBinary) {
    goBinary = mkdtempSync(tmpdir() + '/hr-go-') + '/htmlroom-relay' + (process.platform === 'win32' ? '.exe' : '');
    execFileSync('go', ['build', '-o', goBinary, '.'], { cwd: root + 'relay/go', stdio: 'ignore', env: { ...process.env, CGO_ENABLED: '0' } });
  }
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(goBinary, ['-listen', `127.0.0.1:${port}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  await healthy(`http://127.0.0.1:${port}/healthz`);
  return { port, url: `ws://127.0.0.1:${port}`, binary: goBinary, output: () => output, stop: () => new Promise(r => { if (child.exitCode !== null || child.signalCode) return r(); child.once('exit', r); child.kill('SIGTERM'); }) };
}

// A minimal NIP-01 relay that, like public relays, refuses events whose id or
// signature is wrong and forwards ephemeral events without storing them.
export async function nostrRelay() {
  const server = createServer(), wss = new WebSocketServer({ server });
  const subs = new Map(); const stats = { accepted: 0, rejected: 0 };
  wss.on('connection', ws => {
    subs.set(ws, new Map());
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m[0] === 'REQ') subs.get(ws).set(m[1], m[2]);
      if (m[0] === 'CLOSE') subs.get(ws).delete(m[1]);
      if (m[0] === 'EVENT') {
        const ev = m[1];
        const id = hex(sha256(new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
        let ok = id === ev.id; try { ok = ok && schnorr.verify(ev.sig, ev.id, ev.pubkey); } catch { ok = false; }
        ws.send(JSON.stringify(['OK', ev.id, ok, ok ? '' : 'invalid: bad signature']));
        if (!ok) { stats.rejected++; return; }
        stats.accepted++;
        for (const [peer, filters] of subs) for (const [sub, f] of filters)
          if (f.kinds?.includes(ev.kind) && (!f['#t'] || ev.tags.some(t => t[0] === 't' && f['#t'].includes(t[1])))) peer.send(JSON.stringify(['EVENT', sub, ev]));
      }
    });
    ws.on('close', () => subs.delete(ws));
  });
  const port = await listen(server);
  return { port, url: `ws://127.0.0.1:${port}`, stats, stop: () => new Promise(r => { for (const c of wss.clients) c.terminate(); if (!server.listening) return r(); server.close(() => r()); }) };
}

// A real MQTT broker (aedes) behind WebSocket, path /mqtt.
export async function mqttBroker() {
  const broker = await Aedes.createBroker();
  const server = createServer(), wss = new WebSocketServer({ server, path: '/mqtt', handleProtocols: p => p.has('mqtt') ? 'mqtt' : false });
  wss.on('connection', ws => broker.handle(createWebSocketStream(ws)));
  const port = await listen(server);
  return { port, url: `ws://127.0.0.1:${port}/mqtt`, stop: () => new Promise(r => { for (const c of wss.clients) c.terminate(); if (!server.listening) return r(); server.close(() => broker.close(() => r())); }) };
}
