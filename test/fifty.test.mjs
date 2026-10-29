// A full room: 50 real pages (full signed hybrid encryption, ML-KEM) on a real
// Node relay join at once, agree on one safety code, chat, survive a departure,
// and the 51st is refused. Also checks the limit cannot be raised from outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { makeConfig, unlock, hex } from '../html-room/crypto.js';
import { Session } from '../html-room/session.js';
import { RelayConnection } from '../html-room/relay-connection.js';
import { MeshConnection } from '../html-room/mesh.js';
import { MAX_MEMBERS } from '../src/limits.js';
import { MAX_MEMBERS as RELAY_MAX, admit, emptyBook } from '../src/rules.js';
import { MAX_MEMBERS as STATE_MAX } from '../lib/state.js';
import { MAX_MEMBERS as MESH_MAX } from '../html-room/mesh.js';
import { nodeRelay } from './fixtures/mesh-relays.mjs';

test('the room size is 50 everywhere and fixed in code', () => {
  assert.equal(MAX_MEMBERS, 50);
  assert.equal(RELAY_MAX, 50); assert.equal(STATE_MAX, 50); assert.equal(MESH_MAX, 50);
  let book = emptyBook(); const inUse = new Map();
  for (let i = 1; i <= 50; i++) { const r = admit(book, inUse, null); assert.equal(r.n, i); book = r.book; inUse.set(r.n, hex(crypto.getRandomValues(new Uint8Array(16)))); }
  assert.equal(admit(book, inUse, null).refuse, 4001, 'the 51st is refused');
});

function member(config, derived, stats) {
  const events = { ready: null, messages: [], presence: 0, fatal: null };
  const session = new Session(derived, config, { emit: (kind, value) => {
    if (kind === 'ready') events.ready = value;
    if (kind === 'message' && value.from !== '我') events.messages.push(value.text);
    if (kind === 'presence') events.presence = value;
  } });
  const connection = new RelayConnection(config.relays, {
    roomId: config.roomId,
    createSocket: (url, list) => {
      const ws = new WebSocket(url, list, { origin: 'null' });
      ws.on('message', d => { stats.frames++; stats.bytes += d.length; });
      return ws;
    },
    protocols: index => ['pt2', `a${hex(session.d.access)}`, ...(session.resume && connection.lastIndex === index ? [`r${session.resume}`] : [])],
    onactive: (ws, index, changed) => session.run(() => { if (changed) session.resetRelay(); session.ws = ws; }),
    onmessage: m => { const ws = session.ws; session.run(() => { if (ws === session.ws) return session.incoming(m); }); },
    ondisconnect: () => { session.ws = null; },
    onnotice: () => {},
    onfatal: () => { events.fatal = true; session.halt(); },
  });
  session.connection = connection; connection.start();
  session.tick = setInterval(() => session.run(async () => {
    if (session.ws?.readyState === 1) {
      { const need = session.helloDue(); if (need) { await session.announce(true, need); session.lastAnnounce = Date.now(); } }
      await session.flush(); await session.retryPending();
    }
  }), 1600);
  return { session, events, leave: () => session.halt() };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await wait(100); } assert.fail('timed out: ' + what); }

test('50 members join a room at once, agree on one safety code, chat, and the 51st is refused', { timeout: 240000 }, async (t) => {
  const relay = await nodeRelay(); t.after(relay.stop);
  const config = await makeConfig(relay.url, 'fifty');
  const derived = await unlock(config, 'fifty');
  const stats = { frames: 0, bytes: 0 };
  const started = Date.now();
  const members = [];
  for (let i = 0; i < MAX_MEMBERS; i++) { members.push(member(config, derived, stats)); await wait(20); }
  t.after(() => members.forEach(m => m.leave()));
  const progress = setInterval(() => process.env.HR_DEBUG && console.log('  ready', members.filter(m => m.events.ready).length, 'presence', [...new Set(members.map(m => m.events.presence))].join('/'), 'fatal', members.filter(m => m.events.fatal).length, 'frames', stats.frames, 'MB', (stats.bytes/1e6).toFixed(1)), 5000);
  if (process.env.HR_DEBUG) setTimeout(() => { const m = members.find(x => !x.events.ready); if (!m) return; const g = m.session.group, pr = m.session.present;
    const peers = pr.filter(n => n !== g.me).map(n => [n, g.peers.get(n)]);
    console.log('  me', g.me, 'present', pr.length, 'known', peers.filter(([, p]) => p).length,
      'owed', peers.filter(([, p]) => p && p.sent !== g.mine.epoch).map(([n, p]) => `${n}(kpk:${!!p.kpk},ss:${!!p.ss})`).join(' '),
      'noRecv', peers.filter(([, p]) => p && !p.recv).map(([n]) => n).join(','), 'notPQ', peers.filter(([, p]) => p && !(p.v === 32 && p.ss && p.pqIn)).map(([n, p]) => `${n}(v${p.v},ss:${!!p.ss},pqIn:${p.pqIn})`).join(' ')); }, 40000);
  await until(() => members.every(m => m.events.ready && m.events.presence === 50), 180000, 'all 50 ready');
  clearInterval(progress);
  const joinMs = Date.now() - started, joinBytes = stats.bytes, joinFrames = stats.frames;
  const codes = new Set(members.map(m => m.events.ready));
  assert.equal(codes.size, 1, 'one safety code for all 50');

  // The 51st is turned away by the relay.
  const extra = member(config, derived, { frames: 0, bytes: 0 });
  await until(() => extra.events.fatal, 15000, '51st refused'); extra.leave();

  // Three members talk; everyone else receives each line once.
  for (const i of [0, 24, 49]) members[i].session.queue(`来自第 ${i + 1} 位`);
  await until(() => members.every((m, i) => [0, 24, 49].filter(j => j !== i).every(j => m.events.messages.includes(`来自第 ${j + 1} 位`))), 60000, 'messages delivered to all');
  assert.ok(members.every(m => new Set(m.events.messages).size === m.events.messages.length), 'no duplicates');

  // One leaves: the others rekey without them and keep talking.
  members[10].leave(); const rest = members.filter((_, i) => i !== 10);
  await until(() => rest.every(m => m.events.presence === 49), 30000, 'departure seen');
  rest[0].session.queue('有人离开之后');
  await until(() => rest.slice(1).every(m => m.events.messages.includes('有人离开之后')), 60000, 'after departure');
  console.log(`  50 members: all ready in ${(joinMs / 1000).toFixed(1)} s; join traffic ${(joinBytes / 1e6).toFixed(1)} MB in ${joinFrames} frames over all 50 (${(joinBytes / 50 / 1e3).toFixed(0)} KB each)`);
});

function meshMember(config, derived, stats) {
  const events = { ready: null, messages: [], presence: 0, fatal: null };
  const session = new Session(derived, config, { emit: (kind, value) => {
    if (kind === 'ready') events.ready = value;
    if (kind === 'message' && value.from !== '我') events.messages.push(value.text);
    if (kind === 'presence') events.presence = value;
  } });
  const connection = new MeshConnection(config.relays, {
    derived,
    createSocket: (url, list) => { const ws = new WebSocket(url, list, { origin: 'null' }); ws.on('message', d => { stats.frames++; stats.bytes += d.length; }); return ws; },
    onhello: n => session.run(() => { session.ws = connection.socket; return session.incoming({ type: 'hello', you: n, resume: '' }); }),
    onmembers: list => session.run(() => session.incoming({ type: 'members', members: list })),
    onframe: (frame, from) => session.run(() => session.incoming({ ...frame, from })),
    onfatal: () => { events.fatal = true; session.halt(); },
  });
  const orig = connection.broadcast.bind(connection);
  connection.broadcast = inner => { const kind = inner.k === 'f' ? `f-${inner.f.type}${inner.f.to ? '-to' : ''}` : inner.k; stats.sent[kind] = (stats.sent[kind] ?? 0) + 1; return orig(inner); };
  const origReclaim = connection.claim.bind(connection); connection.claim = () => { stats.sent.claim = (stats.sent.claim ?? 0) + 1; return origReclaim(); };
  session.connection = connection; connection.start();
  session.tick = setInterval(() => session.run(async () => {
    if (session.ws?.readyState === 1) { { const need = session.helloDue(); if (need) { await session.announce(true, need); session.lastAnnounce = Date.now(); } } await session.flush(); await session.retryPending(); }
  }), 1600);
  return { session, events, connection, leave: () => session.halt() };
}

// Broadcast relays cannot address frames, so this room costs O(n³) bytes to set
// up. CI runs 20 members; HR_MESH_N=50 runs a full room (minutes, in one process).
test('a decentralized room over /bc/ (broadcast only) settles', { timeout: 400000 }, async (t) => {
  const relay = await nodeRelay(); t.after(relay.stop);
  const config = await makeConfig(`bc+${relay.url}/bc/`, 'fifty mesh');
  const derived = await unlock(config, 'fifty mesh');
  const stats = { frames: 0, bytes: 0, sent: {} }, started = Date.now(), members = [];
  const { monitorEventLoopDelay } = await import('node:perf_hooks'); const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  const N = Math.min(MAX_MEMBERS, Number(process.env.HR_MESH_N || 20));
  for (let i = 0; i < N; i++) { members.push(meshMember(config, derived, stats)); await wait(20); }
  t.after(() => members.forEach(m => m.leave()));
  const progress = setInterval(() => process.env.HR_DEBUG && console.log('  mesh ready', members.filter(m => m.events.ready).length, 'numbers', new Set(members.map(m => m.connection.me)).size, 'presence', [...new Set(members.map(m => m.events.presence))].sort((a,b)=>a-b).join('/'), 'fatal', members.filter(m => m.events.fatal).length, 'open', members.filter(m=>m.connection.openCount()).length, 'MB', (stats.bytes / 1e6).toFixed(1), 'lag p99 ms', (lag.percentile(99) / 1e6).toFixed(0), 'max', (lag.max / 1e6).toFixed(0)), 5000);
  t.after(() => clearInterval(progress));
  if (process.env.HR_DEBUG) setTimeout(() => { for (const m of members.filter(x => !x.events.ready).slice(0, 2)) { const g = m.session.group, pr = m.session.present; if (!g) { console.log('  no group', m.connection.me, m.connection.settled); continue; }
    const peers = pr.filter(n => n !== g.me).map(n => [n, g.peers.get(n)]);
    console.log('  me', g.me, 'present', pr.length, 'known', peers.filter(([, p]) => p).length, 'owed', peers.filter(([, p]) => p && p.sent !== g.mine.epoch).length,
      'noRecv', peers.filter(([, p]) => p && !p.recv).length, 'notPQ', peers.filter(([, p]) => p && !(p.v === 32 && p.ss && p.pqIn)).map(([n, p]) => `${n}(ss:${!!p.ss},pqIn:${p.pqIn},kpk:${!!p.kpk})`).slice(0, 6).join(' '), 'unknown', peers.filter(([, p]) => !p).map(([n]) => n).slice(0, 10).join(',')); } }, 45000);
  await until(() => members.every(m => m.events.ready && m.events.presence === N), 240000, 'all ready (mesh)');
  const joinMs = Date.now() - started;
  assert.equal(new Set(members.map(m => m.events.ready)).size, 1, 'one safety code');
  assert.deepEqual([...new Set(members.map(m => m.connection.me))].length, N, 'distinct numbers');
  members[7].session.queue('去中心化五十人');
  await until(() => members.every((m, i) => i === 7 || m.events.messages.includes('去中心化五十人')), 60000, 'mesh message delivered');
  console.log(`  ${N} members over /bc/: all ready in ${(joinMs / 1000).toFixed(1)} s; join traffic ${(stats.bytes / 1e6).toFixed(1)} MB (${(stats.bytes / 50 / 1e3).toFixed(0)} KB each)`);
});
