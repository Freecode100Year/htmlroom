// A small QR Code encoder (ISO/IEC 18004, byte mode, versions 1-40), written
// for this project so room links can be shown as a code without any network,
// library or image request. Error correction M, or L when the link is too long.

const ECC = {
  // [codewords per block, number of blocks] for versions 1-40.
  M: { per: [10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
       blocks: [1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49], bits: 0 },
  L: { per: [7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
       blocks: [1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25], bits: 1 },
};

const rawModules = v => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - e.per[v - 1] * e.blocks[v - 1];

// GF(256) with x^8 + x^4 + x^3 + x^2 + 1.
const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 255; };
function rsDivisor(degree) {
  const r = new Array(degree).fill(0); r[degree - 1] = 1; let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { r[j] = mul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; }
    root = mul(root, 2);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
  return r;
}

function codewords(bytes, v, e) {
  const bits = [], put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  const cap = dataCodewords(v, e) * 8;
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));
  const nBlocks = e.blocks[v - 1], ecLen = e.per[v - 1], raw = Math.floor(rawModules(v) / 8);
  const short = nBlocks - raw % nBlocks, shortLen = Math.floor(raw / nBlocks) - ecLen, div = rsDivisor(ecLen);
  const blocks = []; let k = 0;
  for (let i = 0; i < nBlocks; i++) { const d = data.slice(k, k += shortLen + (i < short ? 0 : 1)); blocks.push([d, rsRemainder(d, div)]); }
  const out = [];
  for (let i = 0; i <= shortLen; i++) for (const [d] of blocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ecLen; i++) for (const [, c] of blocks) out.push(c[i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
];

function penalty(m) {
  const n = m.length; let p = 0, dark = 0;
  const line = get => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    for (let i = 0; i + 7 <= n; i++) { // 1:1:3:1:1 finder look-alikes with 4 light modules beside them
      const s = [0, 1, 2, 3, 4, 5, 6].map(j => get(i + j));
      if (s.join('') !== '1011101') continue;
      const light = (a, b) => { for (let j = a; j < b; j++) if (j >= 0 && j < n && get(j)) return false; return true; };
      if (light(i - 4, i) || light(i + 7, i + 11)) p += 40;
    }
  };
  for (let y = 0; y < n; y++) line(x => m[y][x] ? 1 : 0);
  for (let x = 0; x < n; x++) line(y => m[y][x] ? 1 : 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  return p + 10 * (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1);
}

// Returns the modules as rows of booleans (true = dark), without quiet zone.
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 0, e;
  for (const level of ['M', 'L']) {
    e = ECC[level];
    for (v = 1; v <= 40 && dataCodewords(v, e) * 8 < 4 + (v < 10 ? 8 : 16) + bytes.length * 8; v++);
    if (v <= 40) break;
  }
  if (v > 40) throw Error('链接太长，放不进二维码');
  const n = v * 4 + 17, m = [...Array(n)].map(() => Array(n).fill(false)), fixed = [...Array(n)].map(() => Array(n).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
    }
  if (v > 1) {
    const count = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + count * 3 + 5) / (count * 4 - 4)) * 2, pos = [6];
    for (let p = n - 7; pos.length < count; p -= step) pos.splice(1, 0, p);
    for (const ay of pos) for (const ax of pos) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === n - 7) || (ax === n - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const format = mask => {
    const d = e.bits << 3 | mask; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = (d << 10 | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  format(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = v << 12 | r;
    for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1, a = n - 11 + i % 3, c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
  }
  const data = codewords(bytes, v, e);
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
      if (!fixed[y][x] && i < data.length * 8) { m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const apply = k => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fixed[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, score = Infinity;
  for (let k = 0; k < 8; k++) { apply(k); format(k); const s = penalty(m); if (s < score) { score = s; best = k; } apply(k); }
  apply(best); format(best);
  return m;
}

// Draws the code on a canvas: black on white with the standard 4-module border.
export function drawQr(canvas, text, maxPx = 320) {
  const m = qrMatrix(text), n = m.length + 8, scale = Math.max(2, Math.floor(maxPx / n));
  canvas.width = canvas.height = n * scale;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#000';
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale); }));
}
