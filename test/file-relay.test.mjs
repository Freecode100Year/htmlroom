// The room file is also the server: `node index.html` runs the relay embedded
// in it. The same /hr/ and /bc/ probes as the Node and Worker relays.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { hrRelaySuite } from './fixtures/hr-relay-suite.mjs';
import { render } from '../scripts/build-html-room.mjs';
import { makeConfig } from '../html-room/crypto.js';

// Outside the repository: no package.json with "type": "module" above it,
// as with a file someone downloaded.
const dir = mkdtempSync(tmpdir() + '/hr-file-relay-');
const PORT = 19100 + Math.floor(Math.random() * 400);
const children = [];
function run(file, args) {
  const child = spawn(process.execPath, [file, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return { child, out: () => out, ready: () => new Promise((done, fail) => {
    const t = setTimeout(() => fail(new Error('file relay did not start: ' + out)), 10000);
    child.stdout.on('data', () => { if (out.includes('listening')) { clearTimeout(t); done(); } });
    child.on('exit', c => { clearTimeout(t); fail(new Error(`exited ${c}: ${out}`)); });
  }) };
}
before(async () => {
  writeFileSync(dir + '/index.html', (await render({}, [])).html);
  await run(dir + '/index.html', ['--port', String(PORT), '--host', '127.0.0.1', '--join-limit', '1000', '--allow-origin', 'https://freecode100year.github.io']).ready();
});
after(() => { for (const c of children) c.kill(); });
hrRelaySuite('file', PORT);

test('a room file runs as a relay but never serves itself (its key)', async () => {
  const config = await makeConfig('wss://relay.example', undefined);
  writeFileSync(dir + '/room.html', (await render(config, config.relays)).html);
  const port = PORT + 500, r = run(dir + '/room.html', ['--port', String(port), '--host', '127.0.0.1']);
  await r.ready();
  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.doesNotMatch(page, /master|pt-room-config/);
  assert.match(page, /不提供网页/);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(), { ok: true, kind: 'file', room: true });
  r.child.kill();
});

test('bad options exit with help; --tunnel prints the public relay lines', { skip: process.platform === 'win32' && 'POSIX fake cloudflared' }, async () => {
  const bad = run(dir + '/index.html', ['--port', 'nope']);
  assert.equal(await new Promise(r => bad.child.on('exit', r)), 2);
  assert.match(bad.out(), /用法/);
  const fake = dir + '/cloudflared';
  writeFileSync(fake, '#!/bin/sh\necho "INF |  https://calm-lake-42.trycloudflare.com  |" >&2\nsleep 30\n'); chmodSync(fake, 0o755);
  const t = run(dir + '/index.html', ['--port', String(PORT + 501), '--host', '127.0.0.1', '--tunnel', '--cloudflared', fake]);
  await t.ready();
  for (let i = 0; i < 50 && !t.out().includes('bc+wss://'); i++) await new Promise(r => setTimeout(r, 100));
  assert.match(t.out(), /创建页面  https:\/\/calm-lake-42\.trycloudflare\.com\//);
  assert.match(t.out(), /经典中继  wss:\/\/calm-lake-42\.trycloudflare\.com/);
  assert.match(t.out(), /去中心化  bc\+wss:\/\/calm-lake-42\.trycloudflare\.com\/bc\//);
  t.child.kill();
});
