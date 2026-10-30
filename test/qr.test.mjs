import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from '../html-room/qr.js';

// Structure checks that need no decoder. The encoder was also checked against
// jsQR and OpenCV on room links and random text (see the commit message).
const formatValid = bits => { let r = bits ^ 0x5412; for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10); return r === 0; };

test('QR codes have the fixed patterns, a valid format word and the right size', () => {
  for (const [text, version] of [['a', 1], ['x'.repeat(100), 6], ['https://hr50.freedom8964.com/hr.html#hr1=' + 'A'.repeat(600), 20]]) {
    const m = qrMatrix(text), n = m.length;
    assert.equal(n, version * 4 + 17, `version for ${text.length} bytes`);
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]])
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[oy + y][ox + x], d !== 2, 'finder pattern');
      }
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    assert.equal(m[n - 8][8], true, 'dark module');
    let a = 0, b = 0;
    const at = (x, y) => m[y][x] ? 1 : 0;
    const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    first.forEach(([x, y], i) => { a |= at(x, y) << i; });
    for (let i = 0; i < 8; i++) b |= at(n - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) b |= at(8, n - 15 + i) << i;
    assert.equal(a, b, 'both format copies agree'); assert.ok(formatValid(a), 'format word is a valid BCH code');
    assert.equal(((a ^ 0x5412) >>> 13) & 3, 0, 'error correction level M');
  }
});

test('long links fall back to level L and too long ones are refused', () => {
  const m = qrMatrix('q'.repeat(2500)); let f = 0; // too long for M at version 40 (2331 bytes)
  [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]].forEach(([x, y], i) => { f |= (m[y][x] ? 1 : 0) << i; });
  assert.ok(formatValid(f)); assert.equal(((f ^ 0x5412) >>> 13) & 3, 1, 'error correction level L');
  assert.throws(() => qrMatrix('q'.repeat(3000)), /链接太长/);
});
