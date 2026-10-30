// Room titles: anyone holding the file may choose one; it is escaped in HTML,
// bounded, kept by conversions, and part of the verified file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConfig, validate, titleOf, DEFAULT_TITLE, unlock } from '../html-room/crypto.js';
import { withRelays, configFromRoomHtml } from '../html-room/template.js';
import { fillTemplate } from '../html-room/transport.js';
import { render } from '../scripts/build-html-room.mjs';
import { checkHtml } from '../scripts/check-html-room.mjs';
import { createHash } from 'node:crypto';

const head = html => html.split('<script id="pt-room-config"')[0];

test('default title, custom title, and escaping', async () => {
  assert.equal(DEFAULT_TITLE, '聚众加密聊天房间');
  const plain = await makeConfig('wss://r.example');
  assert.equal(plain.title, undefined);
  const p = await render(plain, plain.relays);
  assert.match(p.html, /<title>聚众加密聊天房间<\/title>/); assert.match(p.html, /<body><h1>聚众加密聊天房间<\/h1>/);
  const evil = '</title><script>alert(1)</script> & "x"';
  const c = await makeConfig('wss://r.example', 'pw', { title: evil });
  assert.equal(c.title, evil);
  const r = await render(c, c.relays);
  assert.ok(head(r.html).includes('<title>&#60;/title&#62;&#60;script&#62;alert(1)&#60;/script&#62; &#38; &#34;x&#34;</title>'));
  assert.equal([...r.html.matchAll(/<script[\s>]/g)].length, 2, 'no extra script element');
  await checkHtml(r.html, r.scriptHash);
  assert.equal(configFromRoomHtml(r.html).title, evil);
  assert.equal((await unlock(c, 'pw')).roomId, c.roomId, 'title is not part of the key');
  const t = await render({}, []), templateHash = createHash('sha256').update(t.html).digest('base64');
  assert.equal(await fillTemplate(t.html, c, c.relays, t.scriptHash, t.styleHash, templateHash), r.html, 'web path and build agree');
});

test('titles are bounded and normalized', () => {
  assert.equal(titleOf('  周末   读书会 '), '周末 读书会');
  assert.equal(titleOf(''), undefined); assert.equal(titleOf(DEFAULT_TITLE), undefined);
  assert.equal(titleOf('字'.repeat(60)), '字'.repeat(60));
  assert.throws(() => titleOf('字'.repeat(61)));
  for (const bad of ['a\u0000b', 'a‮b', 'a⁦b', 'a\u0085b']) assert.throws(() => titleOf(bad), JSON.stringify(bad));
  assert.throws(() => validate({ version: 2, relays: ['wss://r.example'], roomId: 'a'.repeat(64), encrypted: false, master: 'b'.repeat(64), title: ' padded ' }));
});

test('conversions keep, change or clear the title', async () => {
  const c = await makeConfig('wss://r.example', undefined, { title: '读书会', custom: true });
  assert.equal(withRelays(c, 'wss://s.example').title, '读书会');
  assert.equal(withRelays(c, 'wss://s.example', undefined, '新名字').title, '新名字');
  assert.equal(withRelays(c, 'wss://s.example', undefined, '').title, undefined);
  assert.deepEqual(Object.keys(withRelays(c, 'wss://s.example')), Object.keys(c), 'same key order as a fresh build');
});

test('CLI room and retarget take --title', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hr-title-')), out = join(dir, 'a.html'), out2 = join(dir, 'b.html');
  execFileSync(process.execPath, ['scripts/build-html-room.mjs', 'room', '--out', out, '--relay', 'wss://r.example', '--allow-relay', 'wss://r.example', '--title', '周五夜谈']);
  assert.equal(configFromRoomHtml(readFileSync(out, 'utf8')).title, '周五夜谈');
  execFileSync(process.execPath, ['scripts/build-html-room.mjs', 'retarget', '--in', out, '--out', out2, '--relay', 'wss://s.example', '--title', '周六夜谈']);
  assert.equal(configFromRoomHtml(readFileSync(out2, 'utf8')).title, '周六夜谈');
});
