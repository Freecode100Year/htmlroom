// Decentralized transport for version 3 rooms.
//
// A classic relay (relay-connection.js) admits members, numbers them, lists
// who is present and stamps each frame with its sender. Here relays only pass
// frames along, so any of these will do, all at once:
//   bc     any WebSocket server that forwards a text frame to the other
//          connections on the same path (this project's /bc/, the Go relay,
//          `websocat`, twenty lines in any language)
//   nostr  a Nostr relay; frames ride in ephemeral events (NIP-01 kinds
//          20000-29999, which relays forward and do not store)
//   mqtt   an MQTT 3.1.1 broker over WebSocket, QoS 0, no retained messages
// Every frame is sent to every relay; copies are dropped by IV, so one relay
// going away loses nothing and members never split between relays.
//
// What the relays used to decide is decided by the members:
//   admission  every frame is AES-GCM under a key derived from the room master
//              (meshKey), bound to the topic; anything else is dropped unread
//   numbers    a newcomer announces itself, members answer, and after a few
//              seconds it claims the lowest free number 1-25; on a clash
//              the earlier claim keeps it (lower node id on a tie), so a
//              late joiner never displaces an established member
//   presence   heartbeats every 4 s; silent for 14 s means gone
//   sender     the number inside the sealed frame; the Group layer still
//              verifies the signature behind every number (session.js)
// Anyone holding the room file can claim any free number, as with a classic
// relay; a malicious member can also claim a taken one. The safety code covers
// every present identity, so re-check it whenever the member list changes.
import { hex, random, relayKind, relayUrl } from './crypto.js';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

export const HB_MS = 4000, ALIVE_MS = 14000, CLAIM_MS = 3000, MAX_WIRE = 16000, SKEW = 600000, MAX_MEMBERS = 25;
export const NOSTR_KIND = 20111;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode(...u8.subarray(i, i + 4096)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const aad = topic => enc.encode(`private-talk/html-room/v3/mesh|${topic}`);
const FRAME_TYPES = ['key', 'msg', 'seen'];

export async function sealFrame(d, inner) {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(d.topic) }, d.meshKey, enc.encode(JSON.stringify(inner))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function openFrame(d, wire, now = Date.now()) {
  if (typeof wire !== 'string' || wire.length < 40 || wire.length > MAX_WIRE || !/^[A-Za-z0-9+/]+={0,2}$/.test(wire)) return null;
  let inner;
  try {
    const raw = unb64(wire);
    inner = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: aad(d.topic) }, d.meshKey, raw.subarray(12))));
  } catch { return null; }
  if (!inner || typeof inner !== 'object' || !/^[0-9a-f]{16}$/.test(inner.d ?? '') || !Number.isInteger(inner.n) || inner.n < 0 || inner.n > MAX_MEMBERS
    || typeof inner.t !== 'number' || Math.abs(now - inner.t) > SKEW || !['hb', 'f', 'bye'].includes(inner.k)
    || (inner.c !== undefined && (typeof inner.c !== 'number' || !Number.isFinite(inner.c)))) return null;
  if (inner.k === 'f' && (!inner.f || typeof inner.f !== 'object' || !FRAME_TYPES.includes(inner.f.type) || typeof inner.f.iv !== 'string' || typeof inner.f.ct !== 'string')) return null;
  return inner;
}

// ---- transports --------------------------------------------------------------
class Link {
  constructor(mesh, entry) { Object.assign(this, { mesh, entry, kind: relayKind(entry), url: relayUrl(entry), open: false, backoff: 1000 }); }
  protocols() { return undefined; }
  target() { return this.url; }
  connect() {
    if (this.mesh.stopped) return;
    let ws;
    try { ws = this.ws = this.mesh.createSocket(this.target(), this.protocols()); } catch { this.fail(); return; }
    ws.binaryType = 'arraybuffer';
    this.timeout = setTimeout(() => this.fail(ws), 10000);
    ws.onopen = () => { if (ws === this.ws) this.opened(); };
    ws.onmessage = e => { if (ws === this.ws && !this.mesh.stopped) this.data(e.data); };
    ws.onclose = ws.onerror = () => this.fail(ws);
  }
  ready() { clearTimeout(this.timeout); this.open = true; this.backoff = 1000; this.mesh.linkChanged(); }
  fail(ws = this.ws) {
    if (ws !== this.ws || this.mesh.stopped) return;
    clearTimeout(this.timeout); clearInterval(this.keepalive);
    this.ws = null; const was = this.open; this.open = false;
    try { ws?.close(); } catch {}
    if (was) this.mesh.linkChanged();
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }
  stop() { clearTimeout(this.timeout); clearTimeout(this.retry); clearInterval(this.keepalive); const ws = this.ws; this.ws = null; this.open = false; try { ws?.close(1000); } catch {} }
  notice(text) { if (!this.noticed) { this.noticed = true; this.mesh.onnotice(`${this.url}：${String(text).slice(0, 120)}`); } }
}

class BroadcastLink extends Link {
  target() { return this.url + this.mesh.d.topic; }
  opened() { this.ready(); }
  data(x) { if (typeof x === 'string') this.mesh.receive(x); }
  send(wire) { this.ws.send(wire); }
}

class NostrLink extends Link {
  opened() {
    this.sub = 'hr' + hex(random(6));
    this.ws.send(JSON.stringify(['REQ', this.sub, { kinds: [NOSTR_KIND], '#t': [this.mesh.d.topic], since: Math.floor(Date.now() / 1000) - 30 }]));
    this.ready();
  }
  data(x) {
    if (typeof x !== 'string' || x.length > MAX_WIRE + 2000) return;
    let m; try { m = JSON.parse(x); } catch { return; }
    if (!Array.isArray(m)) return;
    if (m[0] === 'EVENT' && m[1] === this.sub && m[2]?.kind === NOSTR_KIND && typeof m[2].content === 'string') this.mesh.receive(m[2].content);
    else if (m[0] === 'OK' && m[2] === false) this.notice(`这个 Nostr 中继拒绝了消息（${m[3] ?? ''}），可换一个`);
    else if (m[0] === 'AUTH') this.notice('这个 Nostr 中继要求登录，暂不支持，请换一个');
    else if (m[0] === 'CLOSED' && m[1] === this.sub) { this.notice(`这个 Nostr 中继停止了接收（${m[2] ?? ''}），可换一个`); this.fail(); }
  }
  send(wire) { this.ws.send(JSON.stringify(['EVENT', nostrEvent(this.mesh.nostrKey, this.mesh.d.topic, wire)])); }
}
export function nostrEvent(sk, topic, content, now = Date.now()) {
  const pubkey = hex(schnorr.getPublicKey(sk)), created_at = Math.floor(now / 1000), tags = [['t', topic]];
  const id = sha256(enc.encode(JSON.stringify([0, pubkey, created_at, NOSTR_KIND, tags, content])));
  return { id: hex(id), pubkey, created_at, kind: NOSTR_KIND, tags, content, sig: hex(schnorr.sign(id, sk)) };
}

// MQTT 3.1.1, the four packets this needs. QoS 0 throughout: delivery is
// best-effort, which the Group layer's receipts already account for.
const varint = n => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return out; };
const mqttString = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
export const mqttPacket = (head, body) => Uint8Array.from([head, ...varint(body.length), ...body]);
export const mqttConnect = (clientId, keepalive = 60) => mqttPacket(0x10, [...mqttString('MQTT'), 4, 0x02, keepalive >> 8, keepalive & 255, ...mqttString(clientId)]);
export const mqttSubscribe = (topic, id = 1) => mqttPacket(0x82, [id >> 8, id & 255, ...mqttString(topic), 0]);
export const mqttPublish = (topic, payload) => mqttPacket(0x30, [...mqttString(topic), ...enc.encode(payload)]);
// Splits a byte stream into packets: [{type, flags, body}], plus the unused tail.
export function mqttParse(buf) {
  const packets = []; let i = 0;
  while (i < buf.length) {
    let len = 0, mul = 1, j = i + 1, b;
    do { if (j >= buf.length) return { packets, rest: buf.subarray(i) }; b = buf[j++]; len += (b & 127) * mul; mul *= 128; if (mul > 128 ** 4) throw Error('bad length'); } while (b & 128);
    if (j + len > buf.length) return { packets, rest: buf.subarray(i) };
    packets.push({ type: buf[i] >> 4, flags: buf[i] & 15, body: buf.subarray(j, j + len) });
    i = j + len;
  }
  return { packets, rest: buf.subarray(i) };
}
class MqttLink extends Link {
  protocols() { return ['mqtt']; }
  topic() { return `htmlroom/${this.mesh.d.topic}`; }
  opened() { this.buf = new Uint8Array(0); this.ws.send(mqttConnect('hr' + hex(random(8)))); }
  data(x) {
    if (!(x instanceof ArrayBuffer)) return;
    const joined = new Uint8Array(this.buf.length + x.byteLength); joined.set(this.buf); joined.set(new Uint8Array(x), this.buf.length);
    if (joined.length > 65536) { this.fail(); return; }
    let parsed; try { parsed = mqttParse(joined); } catch { this.fail(); return; }
    this.buf = parsed.rest.slice();
    for (const p of parsed.packets) {
      if (p.type === 2) { // CONNACK
        if (p.body[1] !== 0) { this.notice(`这个 MQTT 服务器拒绝了连接（代码 ${p.body[1]}），可换一个`); this.fail(); return; }
        this.ws.send(mqttSubscribe(this.topic()));
      } else if (p.type === 9) { // SUBACK
        if (p.body[2] === 0x80) { this.notice('这个 MQTT 服务器拒绝了订阅，可换一个'); this.fail(); return; }
        this.ready();
        this.keepalive = setInterval(() => { try { this.ws?.send(Uint8Array.of(0xc0, 0)); } catch {} }, 30000);
      } else if (p.type === 3) { // PUBLISH
        const tl = (p.body[0] << 8) | p.body[1], skip = 2 + tl + ((p.flags >> 1) & 3 ? 2 : 0);
        if (dec.decode(p.body.subarray(2, 2 + tl)) === this.topic()) this.mesh.receive(dec.decode(p.body.subarray(skip)));
      }
    }
  }
  send(wire) { this.ws.send(mqttPublish(this.topic(), wire)); }
}
const LINKS = { bc: BroadcastLink, nostr: NostrLink, mqtt: MqttLink };

// ---- membership --------------------------------------------------------------
export class MeshConnection {
  constructor(relays, { derived, onhello, onmembers, onframe, onstatus = () => {}, onnotice = () => {}, onfatal = () => {},
    createSocket = (url, list) => list ? new WebSocket(url, list) : new WebSocket(url), now = () => Date.now(), claimDelay = CLAIM_MS + Math.random() * 1000 }) {
    Object.assign(this, { d: derived, onhello, onmembers, onframe, onstatus, onnotice, onfatal, createSocket, now, claimDelay });
    this.node = hex(random(8)); this.me = 0; this.peers = new Map(); this.known = new Set(); this.seenIvs = new Map(); this.owners = new Map(); this.lastHb = 0;
    this.nostrKey = schnorr.utils.randomPrivateKey();
    this.links = relays.map(entry => new LINKS[relayKind(entry)](this, entry));
    const mesh = this;
    // What Session expects of a socket.
    this.socket = { get readyState() { return mesh.me && mesh.openCount() ? 1 : 0; }, send: s => mesh.sendSession(s), close() {} };
  }
  start() {
    for (const link of this.links) link.connect();
    this.claimTimer = setTimeout(() => this.claim(), this.claimDelay);
    this.timer = setInterval(() => this.sweep(), 1000);
    this.linkChanged();
  }
  stop() {
    if (this.stopped) return;
    if (this.me) this.broadcast({ k: 'bye' }).catch(() => {});
    this.stopped = true; clearTimeout(this.claimTimer); clearTimeout(this.answer); clearInterval(this.timer);
    setTimeout(() => this.links.forEach(l => l.stop()), 50);
  }
  openCount() { return this.links.filter(l => l.open).length; }
  linkChanged() {
    const open = this.openCount();
    // Not numbered yet: say so, and members answer at once instead of at their
    // next heartbeat, so the claim below sees every number already taken.
    if (open && !this.me && !this.stopped) this.broadcast({ k: 'hb' }).catch(() => {});
    this.onstatus(open ? `中继：已连接 ${open}/${this.links.length} 个（消息同时走所有中继）` : '中继全部断开了，正在重连……');
  }
  async broadcast(inner) {
    const open = this.links.filter(l => l.open);
    if (!open.length) return 0;
    const wire = await sealFrame(this.d, { ...inner, d: this.node, n: this.me, t: this.now(), ...(this.me && { c: this.claimedAt }) });
    this.remember(wire.slice(0, 16));
    let sent = 0;
    for (const link of open) { try { link.send(wire); sent++; } catch { link.fail(); } }
    return sent;
  }
  remember(key) {
    this.seenIvs.set(key, this.now());
    while (this.seenIvs.size > 4096) this.seenIvs.delete(this.seenIvs.keys().next().value);
  }
  sendSession(text) {
    let frame; try { frame = JSON.parse(text); } catch { return; }
    if (!FRAME_TYPES.includes(frame?.type) || !this.me) return;
    const me = this.me;
    this.broadcast({ k: 'f', f: frame }).then(sent => {
      // Relays need not echo to the sender; "submitted" means at least one took it.
      if (sent && frame.type === 'msg' && me === this.me) this.onframe(frame, me);
    }).catch(() => {});
  }
  async receive(wire) {
    if (this.stopped || typeof wire !== 'string') return;
    const key = wire.slice(0, 16);
    if (this.seenIvs.has(key)) return;
    this.remember(key);
    const inner = await openFrame(this.d, wire, this.now());
    if (!inner || inner.d === this.node || this.stopped) return;
    if (!this.known.has(inner.d) && inner.k !== 'bye') { this.known.add(inner.d); this.answerSoon(); }
    if (inner.k === 'bye') this.peers.delete(inner.d);
    else if (inner.n > 0) this.peers.set(inner.d, { n: inner.n, c: inner.c ?? inner.t, seen: this.now() });
    this.reconcile();
    // at: when it arrived here, the role a classic relay's timestamp plays (lib/state.js).
    if (inner.k === 'f' && inner.n > 0 && this.owners.get(inner.n) === inner.d) this.onframe({ ...inner.f, at: this.now() }, inner.n);
  }
  answerSoon() {
    if (!this.me || this.answer) return;
    this.answer = setTimeout(() => { this.answer = null; this.lastHb = 0; this.sweep(); }, 50 + Math.random() * 250);
  }
  claim() {
    if (this.stopped) return;
    const used = new Set([...this.live()].map(([, p]) => p.n));
    let n = 1; while (used.has(n)) n++;
    if (n > MAX_MEMBERS) { this.stop(); this.onfatal('房间已满（25 人）。'); return; }
    this.me = n; this.claimedAt = this.now(); this.lastHb = 0;
    this.onhello(n);
    this.sweep();
  }
  *live() { const now = this.now(); for (const e of this.peers) if (now - e[1].seen <= ALIVE_MS) yield e; }
  // Owners: for each number, the live node that claimed it first (then lowest id).
  reconcile() {
    const owners = new Map(), claims = new Map();
    const consider = (n, node, c) => { const cur = claims.get(n); if (!cur || c < cur.c || (c === cur.c && node < cur.node)) { claims.set(n, { node, c }); owners.set(n, node); } };
    if (this.me) consider(this.me, this.node, this.claimedAt);
    for (const [node, p] of this.live()) consider(p.n, node, p.c);
    if (this.me && owners.get(this.me) !== this.node) { // lost a clash: pick again
      this.me = 0; this.claim(); return;
    }
    const changed = [...owners].filter(([n, node]) => this.owners.has(n) && this.owners.get(n) !== node).map(([n]) => n);
    const same = owners.size === this.owners.size && [...owners].every(([n, node]) => this.owners.get(n) === node);
    if (same) return;
    // A number passing to another node is a departure then an arrival, so the
    // session forgets the old identity before it hears the new one.
    if (changed.length) this.onmembers([...this.owners.keys()].filter(n => !changed.includes(n)).sort((a, b) => a - b));
    this.owners = owners;
    if (this.me) this.onmembers([...owners.keys()].sort((a, b) => a - b));
  }
  sweep() {
    if (this.stopped) return;
    const now = this.now();
    for (const [node, p] of this.peers) if (now - p.seen > ALIVE_MS * 4) this.peers.delete(node);
    for (const [k, t] of this.seenIvs) { if (now - t > SKEW * 2) this.seenIvs.delete(k); else break; }
    this.reconcile();
    if (this.me && now - this.lastHb >= HB_MS && this.openCount()) { this.lastHb = now; this.broadcast({ k: 'hb' }).catch(() => {}); }
  }
}
