// Decentralized rooms over real relays: this project's Node /bc/, the Go
// broadcast relay, a signature-checking Nostr relay and a real MQTT broker.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { derive, random } from '../html-room/crypto.js';
import { MeshConnection } from '../html-room/mesh.js';
import { nodeRelay, goRelay, goAvailable, nostrRelay, mqttBroker } from './fixtures/mesh-relays.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
// Browsers opening a file send Origin: null.
const createSocket = (url, protocols) => new WebSocket(url, protocols, { origin: 'null' });
const open = (url, opts = {}) => new Promise((resolve, reject) => { const ws = new WebSocket(url, opts); ws.once('open', () => resolve(ws)); ws.once('error', reject); ws.once('unexpected-response', (_, res) => reject(Object.assign(Error('http ' + res.statusCode), { status: res.statusCode }))); });
const next = ws => new Promise(r => ws.once('message', (d, bin) => r(bin ? d : d.toString())));
const closed = ws => Promise.race([new Promise(r => ws.once('close', code => r(code))), new Promise((_, f) => setTimeout(() => f(new Error('no close within 5 s')), 5000))]);
const TOPIC = 'ab'.repeat(16);

async function broadcastContract(base, label) {
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => open(`${base}/bc/${TOPIC}`, { origin: 'null' })));
  const other = await open(`${base}/bc/${'cd'.repeat(16)}`, { origin: 'null' });
  let leaked = false; other.on('message', () => { leaked = true; }); a.on('message', () => assert.fail(label + ': echoed to sender'));
  const got = Promise.all([next(b), next(c)]);
  a.send('hello-frame');
  assert.deepEqual(await got, ['hello-frame', 'hello-frame'], label);
  await wait(100); assert.equal(leaked, false, label + ': topics are separate');
  a.removeAllListeners('message');
  const big = closed(a); a.send('x'.repeat(16001)); assert.ok([1008, 1009].includes(await big), label + ': oversize closes');
  const bin = closed(b); b.send(Buffer.from([1, 2, 3])); assert.ok([1003, 1008].includes(await bin), label + ': binary closes');
  c.close(); other.close();
}

test('Node relay /bc/ forwards text to the rest of the topic only, with limits and origin policy', async (t) => {
  const relay = await nodeRelay(); t.after(relay.stop);
  await broadcastContract(relay.url, 'node');
  await assert.rejects(open(`${relay.url}/bc/${TOPIC}`, { origin: 'https://evil.example' }), e => e.status === 403);
  await assert.rejects(open(`${relay.url}/bc/short`, { origin: 'null' }), e => e.status === 404);
});

test('Go relay forwards the same way, with optional origin allowlist', { skip: !goAvailable() && 'go not installed' }, async (t) => {
  const relay = await goRelay(); t.after(relay.stop);
  await broadcastContract(relay.url, 'go');
  const health = await (await fetch(`http://127.0.0.1:${relay.port}/healthz`)).json();
  assert.equal(health.kind, 'bc');
  const strict = await goRelay(['-allow-origin', 'https://ok.example']); t.after(strict.stop);
  await assert.rejects(open(`${strict.url}/bc/${TOPIC}`, { origin: 'https://evil.example' }), e => e.status === 403);
  (await open(`${strict.url}/bc/${TOPIC}`, { origin: 'https://ok.example' })).close();
  (await open(`${strict.url}/bc/${TOPIC}`, { origin: 'null' })).close();
});

test('Go relay -tunnel prints the relay line from cloudflared output', { skip: !goAvailable() && 'go not installed' }, async (t) => {
  const { writeFileSync, chmodSync, mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync('/tmp/hr-cf-'), fake = dir + '/cloudflared';
  writeFileSync(fake, '#!/bin/sh\necho "INF |  https://quiet-river-1234.trycloudflare.com  |" >&2\nsleep 30\n'); chmodSync(fake, 0o755);
  const relay = await goRelay(['-tunnel', '-cloudflared', fake]); t.after(relay.stop);
  for (let i = 0; i < 50 && !relay.output().includes('bc+wss://'); i++) await wait(100);
  assert.match(relay.output(), /bc\+wss:\/\/quiet-river-1234\.trycloudflare\.com\/bc\//);
});

function member(d, relays) {
  const got = { members: [], frames: [] };
  const m = new MeshConnection(relays, { derived: d, createSocket, claimDelay: 400,
    onhello: () => {}, onmembers: l => got.members.push(l), onframe: (f, from) => got.frames.push([from, f.ct]) });
  m.start(); return { m, got };
}
const frame = ct => JSON.stringify({ type: 'key', iv: 'a'.repeat(16), ct });
async function until(fn, ms = 8000) { for (let t = 0; t < ms; t += 50) { if (fn()) return; await wait(50); } assert.fail('timed out'); }

test('members meet across bc, Nostr and MQTT at once and survive losing relays', { timeout: 60000 }, async (t) => {
  const [node, nostr, mqtt] = await Promise.all([nodeRelay(), nostrRelay(), mqttBroker()]);
  const go = goAvailable() ? await goRelay() : null;
  t.after(async () => { await Promise.all([node.stop(), nostr.stop(), mqtt.stop(), go?.stop()]); });
  const relays = [`bc+${node.url}/bc/`, `nostr+${nostr.url}`, `mqtt+${mqtt.url}`, ...(go ? [`bc+${go.url}/bc/`] : [])];
  const d = await derive(random(32));
  const a = member(d, relays), b = member(d, relays);
  t.after(() => { a.m.stop(); b.m.stop(); });
  await until(() => a.m.openCount() === relays.length && b.m.openCount() === relays.length);
  await until(() => JSON.stringify(a.got.members.at(-1)) === '[1,2]' && JSON.stringify(b.got.members.at(-1)) === '[1,2]');
  a.m.socket.send(frame('all-relays-' + 'x'.repeat(14)));
  await until(() => b.got.frames.some(([, ct]) => ct.startsWith('all-relays')));
  await wait(300);
  assert.equal(b.got.frames.filter(([, ct]) => ct.startsWith('all-relays')).length, 1, 'one copy per frame however many relays carried it');
  assert.ok(nostr.stats.accepted > 0 && nostr.stats.rejected === 0, 'every Nostr event had a valid id and signature');

  // Lose the broadcast relays, then MQTT: members keep hearing each other over Nostr alone.
  await node.stop(); await go?.stop(); await mqtt.stop();
  await until(() => a.m.openCount() === 1 && b.m.openCount() === 1);
  b.m.socket.send(frame('nostr-only-' + 'y'.repeat(14)));
  await until(() => a.got.frames.some(([, ct]) => ct.startsWith('nostr-only')));
});

test('MQTT alone carries a room', { timeout: 30000 }, async (t) => {
  const mqtt = await mqttBroker(); t.after(mqtt.stop);
  const d = await derive(random(32));
  const a = member(d, [`mqtt+${mqtt.url}`]), b = member(d, [`mqtt+${mqtt.url}`]);
  t.after(() => { a.m.stop(); b.m.stop(); });
  await until(() => JSON.stringify(b.got.members.at(-1)) === '[1,2]');
  b.m.socket.send(frame('mqtt-alone-' + 'z'.repeat(14)));
  await until(() => a.got.frames.some(([, ct]) => ct.startsWith('mqtt-alone')));
});
