import { pad, unpad } from '../lib/crypto.js';
const enc = new TextEncoder();
export const hex = a => Array.from(new Uint8Array(a), b => b.toString(16).padStart(2, '0')).join('');
export function bytes(s, n) {
  if (typeof s !== 'string' || s.length !== n * 2 || !/^[0-9a-f]+$/.test(s)) throw Error('配置字节格式错误');
  return Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
}
export const random = n => crypto.getRandomValues(new Uint8Array(n));
export async function derive(master) {
  const raw = typeof master === 'string' ? bytes(master, 32) : master;
  if (!(raw instanceof Uint8Array) || raw.length !== 32) throw Error('房间密钥长度错误');
  const hkdf = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const part = async name => new Uint8Array(await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt:new Uint8Array(32), info:enc.encode(`private-talk/html-room/v1/${name}`) }, hkdf, 256));
  const access = await part('access'), keyBytes = await part('key'), bind = await part('bind');
  // Version 3 (decentralized) only: a frame key that admits nothing without the
  // master, and a topic name for dumb relays that is unlinkable to roomId.
  const v3 = async name => new Uint8Array(await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt:new Uint8Array(32), info:enc.encode(`private-talk/html-room/v3/${name}`) }, hkdf, 256));
  const meshBytes = await v3('mesh'), topic = hex(await v3('topic')).slice(0, 32);
  const meshKey = await crypto.subtle.importKey('raw', meshBytes, 'AES-GCM', false, ['encrypt','decrypt']); meshBytes.fill(0);
  return { access, keyBytes, bind, topic, meshKey, roomId:hex(await crypto.subtle.digest('SHA-256', access)), key:await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']) };
}
const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/, LOOPBACK = ['localhost','127.0.0.1','[::1]'];
function checkUrl(u) {
  if (!HOST.test(u.hostname)) throw Error('中继地址里有不支持的字符');
  if (u.username || u.password || u.search || u.hash || !['ws:','wss:'].includes(u.protocol)) throw Error('中继地址要以 wss:// 开头，不能带账号、? 或 #');
  if (u.protocol === 'ws:' && !LOOPBACK.includes(u.hostname)) throw Error('中继地址要用 wss://（加密连接）');
}
// Classic relay (this project's /hr/ protocol, version 2 rooms): an exact origin.
export function relayOrigin(s) {
  const u = new URL(s);
  checkUrl(u);
  if (u.pathname !== '/') throw Error('经典中继只填域名，不要带路径，例如 wss://relay.example.com');
  return u.origin;
}
// Decentralized relays (version 3 rooms) carry a kind prefix:
//   bc+wss://host/path/   any WebSocket server that forwards each text frame to
//                          the other connections on the same path (default /bc/)
//   nostr+wss://host      a Nostr relay (ephemeral events, NIP-01)
//   mqtt+wss://host/mqtt  an MQTT 3.1.1 broker over WebSocket
export const MESH_KINDS = ['bc','nostr','mqtt'];
const KIND = /^(bc|nostr|mqtt)\+/i, PATH = /^(?:\/[A-Za-z0-9._~-]+)*\/?$/;
export const relayKind = entry => KIND.exec(entry)?.[1].toLowerCase() ?? 'hr';
export const relayUrl = entry => entry.replace(KIND, '');
// The CSP source that admits exactly this relay: a bc path ends with "/" and so
// matches only paths under it; the rest are an origin or one exact path.
export const cspSource = relayUrl;
export function relayEntry(s) {
  if (typeof s !== 'string') throw Error('中继地址无效');
  const kind = relayKind(s.trim());
  if (kind === 'hr') return relayOrigin(s.trim());
  const u = new URL(relayUrl(s.trim()));
  checkUrl(u);
  let path = u.pathname;
  if (!PATH.test(path) || path.includes('//')) throw Error('中继地址的路径里有不支持的字符');
  if (kind === 'bc') { if (path === '/') path = '/bc/'; if (!path.endsWith('/')) throw Error('bc+ 地址的路径要以 / 结尾'); }
  else if (path === '/') path = '';
  return `${kind}+${u.origin}${path}`;
}
export function relayList(input) {
  const values = Array.isArray(input) ? input : typeof input === 'string' ? input.trim().split(/[\s,]+/) : [];
  const relays = [...new Set(values.map(relayEntry))];
  const mesh = relays.some(r => relayKind(r) !== 'hr');
  if (mesh && relays.some(r => relayKind(r) === 'hr')) throw Error('经典中继（wss://）不能与去中心化中继（bc+ / nostr+ / mqtt+）混用');
  if (!relays.length || relays.length > (mesh ? 5 : 3)) throw Error(mesh ? '去中心化中继请填 1 到 5 个不同地址' : '请填 1 到 3 个不同的中继地址');
  return relays;
}
// CSP sources a custom-relay file adds: any WSS relay, plus the loopback WS
// addresses relayEntry accepts for local development.
export const CUSTOM_SOURCES = ['wss:', 'ws://localhost:*', 'ws://127.0.0.1:*']; // CSP has no IPv6 literals
export const connectSources = config => [...(config.custom ? CUSTOM_SOURCES : []), ...config.relays.map(cspSource)];
export const versionFor = relays => relays.some(r => relayKind(r) !== 'hr') ? 3 : 2;
const KDF = { name:'PBKDF2', hash:'SHA-256', iterations:310000 };
const aad = roomId => enc.encode(`private-talk/html-room/v1/wrap|${roomId}`);
async function passwordKey(pass, salt) {
  if (typeof pass !== 'string' || !pass.length || enc.encode(pass).length > 1024) throw Error('口令长度无效');
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({...KDF,salt}, base, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export function validate(c) {
  if (!c || ![2,3].includes(c.version) || !/^[0-9a-f]{64}$/.test(c.roomId)) throw Error('房间版本或地址错误');
  if (!Array.isArray(c.relays) || JSON.stringify(relayList(c.relays)) !== JSON.stringify(c.relays)) throw Error('中继列表格式错误');
  if (versionFor(c.relays) !== c.version) throw Error('房间版本与中继类型不符');
  // custom: true lets whoever opens the file connect through relays they type
  // in (its CSP then admits any wss: origin); absent means the listed relays only.
  if (c.custom !== undefined && c.custom !== true) throw Error('配置字段错误');
  const common=['version','relays','roomId','encrypted','custom'];
  if (c.encrypted === true) {
    const allowed=[...common,'salt','iv','ciphertext','kdf'];
    if (Object.keys(c).some(k=>!allowed.includes(k)) || !c.kdf || Object.keys(c.kdf).length !== 3 || Object.entries(KDF).some(([k,v])=>c.kdf[k]!==v)) throw Error('不支持的 KDF 配置');
    bytes(c.salt,16); bytes(c.iv,12); bytes(c.ciphertext,48);
  } else {
    if (c.encrypted !== false || Object.keys(c).some(k=>![...common,'master'].includes(k))) throw Error('配置字段错误');
    bytes(c.master,32);
  }
  return c;
}
export async function makeConfig(relay, pass, { custom = false } = {}) {
  const relays=relayList(relay);
  const master=random(32), d=await derive(master), c={version:versionFor(relays),relays,roomId:d.roomId,encrypted:!!pass};
  let out;
  if (!pass) out={...c,master:hex(master)};
  else {
    const salt=random(16), iv=random(12), key=await passwordKey(pass,salt);
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(c.roomId)},key,master);
    out={...c,salt:hex(salt),iv:hex(iv),ciphertext:hex(ciphertext),kdf:{...KDF}};
  }
  return custom ? {...out,custom:true} : out;
}
// The relays this visit uses: the file's own, or ones typed into a file that
// allows it. Only the routing changes; key material and roomId stay.
export function sessionRelays(config, input) {
  validate(config);
  if (typeof input !== 'string' || !input.trim()) return config;
  if (config.custom !== true) throw Error('这个房间文件不允许自定义中继');
  const relays=relayList(input);
  return validate({...config, version:versionFor(relays), relays});
}
export async function unlock(c, pass) {
  validate(c);
  const master=c.encrypted ? new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(c.iv,12),additionalData:aad(c.roomId)},await passwordKey(pass,bytes(c.salt,16)),bytes(c.ciphertext,48))) : bytes(c.master,32);
  const d=await derive(master);master.fill(0);
  if (d.roomId !== c.roomId) throw Error('房间地址与密钥不匹配');
  return d;
}
export async function sealAnnouncement(d, text) {
  const iv=random(12), ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`private-talk/html-room/v1/keys|${d.roomId}`)},d.key,pad(enc.encode(text)));
  return {iv:btoa(String.fromCharCode(...iv)),ct:btoa(String.fromCharCode(...new Uint8Array(ct)))};
}
export async function openAnnouncement(d, m) {
  const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  return new TextDecoder().decode(unpad(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(m.iv),additionalData:enc.encode(`private-talk/html-room/v1/keys|${d.roomId}`)},d.key,b64(m.ct)))));
}
