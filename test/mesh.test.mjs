import test from 'node:test';
import assert from 'node:assert/strict';
import { schnorr } from '@noble/curves/secp256k1';
import { makeConfig, relayEntry, relayList, unlock, validate, derive, random, cspSource } from '../html-room/crypto.js';
import { withRelays } from '../html-room/template.js';
import { render } from '../scripts/build-html-room.mjs';
import { sealFrame, openFrame, nostrEvent, NOSTR_KIND, mqttConnect, mqttPublish, mqttSubscribe, mqttParse, MeshConnection } from '../html-room/mesh.js';

test('decentralized relay entries are canonical and never mix with classic relays', () => {
  assert.equal(relayEntry('bc+wss://Relay.Example.com'), 'bc+wss://relay.example.com/bc/');
  assert.equal(relayEntry('bc+wss://relay.example.com:443/x/'), 'bc+wss://relay.example.com/x/');
  assert.equal(relayEntry('NOSTR+wss://relay.example.com/'), 'nostr+wss://relay.example.com');
  assert.equal(relayEntry('mqtt+wss://broker.example.com:8084/mqtt'), 'mqtt+wss://broker.example.com:8084/mqtt');
  assert.equal(relayEntry('wss://relay.example.com'), 'wss://relay.example.com');
  for (const bad of ['bc+wss://h/x', 'nostr+ws://remote.example', 'mqtt+wss://h/a?b=1', 'mqtt+wss://u:p@h/mqtt', 'bc+wss://h/a%20b/', 'nostr+wss://h/a;b', 'gopher+wss://h', 'mqtt+wss://h//x'])
    assert.throws(() => relayEntry(bad), bad);
  assert.throws(() => relayList('wss://a.example nostr+wss://b.example'));
  assert.equal(relayList('nostr+wss://a.example mqtt+wss://b.example/mqtt bc+wss://c.example nostr+wss://d.example nostr+wss://e.example').length, 5);
  assert.throws(() => relayList('nostr+wss://a.example nostr+wss://b.example nostr+wss://c.example nostr+wss://d.example nostr+wss://e.example nostr+wss://f.example'));
  assert.equal(cspSource('bc+wss://c.example/bc/'), 'wss://c.example/bc/');
});

test('version follows relay kind; moving to decentralized relays keeps key, password wrap and roomId', async () => {
  const classic = await makeConfig('wss://relay.example', 'pw');
  assert.equal(classic.version, 2);
  const mesh = withRelays(classic, 'nostr+wss://n.example mqtt+wss://m.example/mqtt');
  assert.deepEqual(Object.keys(mesh), Object.keys(classic));
  assert.equal(mesh.version, 3); assert.equal(mesh.roomId, classic.roomId); assert.equal(mesh.ciphertext, classic.ciphertext);
  assert.equal((await unlock(mesh, 'pw')).roomId, classic.roomId);
  assert.equal(withRelays(mesh, 'wss://relay.example').version, 2);
  assert.throws(() => validate({ ...mesh, version: 2 }));
  const html = (await render(mesh, mesh.relays)).html;
  assert.match(html, /connect-src wss:\/\/n\.example wss:\/\/m\.example\/mqtt;/);
  assert.doesNotMatch(html.split('<script id="pt-room-config"')[0], /preview-link/, 'no web entry for relays outside one bc server');
  const bcOnly = withRelays(classic, 'bc+wss://r.example bc+wss://r.example/alt/');
  assert.match((await render(bcOnly, bcOnly.relays)).html, /href="https:\/\/r\.example\/hr\.html#hr1=/);
});

test('mesh frames need the room master and the right topic', async () => {
  const d = await derive(random(32)), other = await derive(random(32));
  assert.match(d.topic, /^[0-9a-f]{32}$/);
  const wire = await sealFrame(d, { k: 'hb', d: '0123456789abcdef', n: 3, t: Date.now() });
  assert.deepEqual({ ...(await openFrame(d, wire)), t: 0 }, { k: 'hb', d: '0123456789abcdef', n: 3, t: 0 });
  assert.equal(await openFrame(other, wire), null);
  assert.equal(await openFrame({ ...d, topic: other.topic }, wire), null);
  assert.equal(await openFrame(d, wire, Date.now() + 3600000), null, 'stale frames are dropped');
  assert.equal(await openFrame(d, await sealFrame(d, { k: 'f', d: '0123456789abcdef', n: 3, t: Date.now(), f: { type: 'table' } })), null);
  assert.equal(await openFrame(d, 'x'.repeat(20000)), null);
});

test('nostr events are valid NIP-01 ephemeral events', () => {
  const sk = schnorr.utils.randomPrivateKey(), ev = nostrEvent(sk, 'ab'.repeat(16), 'payload');
  assert.ok(ev.kind >= 20000 && ev.kind < 30000); assert.equal(ev.kind, NOSTR_KIND);
  assert.deepEqual(ev.tags, [['t', 'ab'.repeat(16)]]);
  assert.ok(schnorr.verify(ev.sig, ev.id, ev.pubkey));
});

test('mqtt packets round-trip, including split and multi-byte lengths', () => {
  const long = 'x'.repeat(300), pub = mqttPublish('htmlroom/t', long);
  assert.deepEqual([...pub.subarray(0, 3)], [0x30, 0xb8, 0x02]);
  const stream = new Uint8Array([...mqttConnect('hr1'), ...mqttSubscribe('htmlroom/t'), ...pub]);
  const half = mqttParse(stream.subarray(0, stream.length - 10));
  assert.equal(half.packets.length, 2);
  const all = mqttParse(new Uint8Array([...half.rest, ...stream.subarray(stream.length - 10)]));
  assert.equal(all.packets[0].type, 3);
  assert.equal(new TextDecoder().decode(all.packets[0].body.subarray(12)), long);
});

// In-memory broadcast relay: every socket on a URL hears the others.
function bus() {
  const rooms = new Map();
  return (url) => {
    const peers = rooms.get(url) ?? new Set(); rooms.set(url, peers);
    const ws = { readyState: 0, send(x) { for (const p of peers) if (p !== ws && p.readyState === 1) setTimeout(() => p.onmessage?.({ data: x }), 1); }, close() { ws.readyState = 3; peers.delete(ws); } };
    peers.add(ws); setTimeout(() => { ws.readyState = 1; ws.onopen?.(); }, 1);
    return ws;
  };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function node(d, createSocket, claimDelay, relays = ['bc+wss://relay.example/bc/']) {
  const seen = { hello: [], members: [], frames: [] };
  const m = new MeshConnection(relays, { derived: d, createSocket, claimDelay, onhello: n => seen.hello.push(n), onmembers: l => seen.members.push(l), onframe: (f, from) => seen.frames.push([from, f.type]) });
  m.start(); return { m, seen };
}

test('members number themselves, settle clashes and hear each other', async (t) => {
  const d = await derive(random(32)), sock = bus();
  const started = []; t.after(() => started.forEach(x => x.m.stop()));
  const a = node(d, sock, 0), b = node(d, sock, 0); // both claim 1 at once
  started.push(a, b);
  await wait(3000);
  const nums = [a.m.me, b.m.me].sort();
  assert.deepEqual(nums, [1, 2], 'a clash is settled');
  assert.deepEqual([a.seen.hello, b.seen.hello].map(h => h.length), [1, 1], 'keys are made once, after the number settled');
  assert.deepEqual([...a.seen.hello, ...b.seen.hello].sort(), [1, 2]);
  const c = node(d, sock, 200); started.push(c);
  await wait(2500);
  assert.equal(c.m.me, 3);
  assert.deepEqual([a.m.me, b.m.me].sort(), [1, 2], 'established members keep their numbers');
  assert.deepEqual(a.seen.members.at(-1), [1, 2, 3]);
  c.m.socket.send(JSON.stringify({ type: 'msg', iv: 'a'.repeat(16), ct: 'b'.repeat(24), h: '1.1' }));
  await wait(100);
  assert.deepEqual(a.seen.frames.at(-1), [3, 'msg']);
  assert.deepEqual(c.seen.frames.at(-1), [3, 'msg'], 'local echo once a relay took it');
  c.m.stop(); await wait(300);
  assert.deepEqual(a.seen.members.at(-1), [1, 2], 'bye removes a member at once');
});

test('a late joiner that claims a taken number gives it up, whatever its node id', async (t) => {
  const d = await derive(random(32)), sock = bus();
  const stops = []; t.after(() => stops.forEach(f => f()));
  const a = node(d, sock, 0); stops.push(() => a.m.stop());
  await wait(300);
  // Joins deaf: claims at once, before hearing anyone, and with the lowest possible node id.
  const late = { seen: { hello: [], members: [], frames: [] } };
  late.m = new MeshConnection(['bc+wss://relay.example/bc/'], { derived: d, createSocket: sock, claimDelay: 0, onhello: n => late.seen.hello.push(n), onmembers: () => {}, onframe: () => {} });
  late.m.node = '0000000000000000'; late.m.start(); stops.push(() => late.m.stop());
  await wait(6000);
  assert.equal(a.m.me, 1); assert.deepEqual(a.seen.hello, [1]);
  assert.equal(late.m.me, 2); assert.deepEqual(late.seen.hello, [2], 'gave up 1 before making keys for it');
});

test('frames reach every member through any one surviving relay, without duplicates', async (t) => {
  const d = await derive(random(32)), sock = bus();
  const relays = ['bc+wss://one.example/bc/', 'bc+wss://two.example/bc/'];
  const a = node(d, sock, 0, relays), b = node(d, sock, 300, relays);
  t.after(() => { a.m.stop(); b.m.stop(); });
  await wait(2500);
  a.m.links[0].ws.close(); a.m.links[0].open = false; a.m.links[0].stop();
  a.m.socket.send(JSON.stringify({ type: 'key', iv: 'a'.repeat(16), ct: 'b'.repeat(24) }));
  await wait(100);
  assert.equal(b.seen.frames.filter(([, type]) => type === 'key').length, 1);
  b.m.socket.send(JSON.stringify({ type: 'key', iv: 'a'.repeat(16), ct: 'b'.repeat(24) }));
  await wait(100);
  assert.equal(a.seen.frames.filter(([, type]) => type === 'key').length, 1, 'two relays, one delivery');
});

test('custom-relay files: wider CSP only when asked, typed relays change routing not keys', async () => {
  const { sessionRelays } = await import('../html-room/crypto.js');
  const { checkHtml } = await import('../scripts/check-html-room.mjs');
  const strict = await makeConfig('wss://a.example', 'pw'), open = await makeConfig('wss://a.example', 'pw', { custom: true });
  assert.equal(strict.custom, undefined); assert.equal(open.custom, true);
  assert.equal(Object.keys(open).at(-1), 'custom');
  assert.throws(() => validate({ ...open, custom: false }));
  const strictHtml = (await render(strict, strict.relays)).html, openHtml = await render(open, open.relays);
  assert.match(strictHtml, /connect-src wss:\/\/a\.example;/);
  assert.match(openHtml.html, /connect-src wss: ws:\/\/localhost:\* ws:\/\/127\.0\.0\.1:\* wss:\/\/a\.example;/);
  await checkHtml(openHtml.html, openHtml.scriptHash);
  assert.equal(sessionRelays(open, ''), open);
  assert.equal(sessionRelays(open, '  '), open);
  const typed = sessionRelays(open, 'wss://b.example');
  assert.deepEqual(typed.relays, ['wss://b.example']); assert.equal(typed.roomId, open.roomId); assert.equal(typed.ciphertext, open.ciphertext);
  const mesh = sessionRelays(open, 'nostr+wss://n.example bc+wss://b.example');
  assert.equal(mesh.version, 3);
  assert.equal((await unlock(mesh, 'pw')).roomId, open.roomId);
  assert.throws(() => sessionRelays(strict, 'wss://b.example'), /不允许/);
  assert.throws(() => sessionRelays(open, 'http://b.example'));
  assert.equal(withRelays(open, 'wss://c.example').custom, true, 'converting keeps the setting');
  assert.equal(withRelays(open, 'wss://c.example', false).custom, undefined);
  assert.equal(withRelays(strict, 'wss://c.example', true).custom, true);
});
