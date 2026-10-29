// scripts/relay-quickstart.sh: platform detection, checksum-verified download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const script = new URL('../scripts/relay-quickstart.sh', import.meta.url).pathname;
// Async: the fake release server below runs in this same process.
const run = (args, env = {}) => new Promise(resolve => {
  const child = spawn('sh', [script, ...args], { env: { ...process.env, ...env } });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  child.on('close', code => resolve({ code, out }));
});

test('quickstart parses, detects the platform and refuses bad flags', async () => {
  execFileSync('sh', ['-n', script]);
  const check = await run(['--check', '--tunnel']);
  assert.equal(check.code, 0);
  assert.match(check.out, /平台：(linux|darwin|freebsd)-(amd64|arm64)/);
  assert.match(check.out, /cloudflared/);
  assert.equal((await run(['--port', 'abc'])).code, 2);
  assert.equal((await run(['--bogus'])).code, 2);
});

test('quickstart installs only a binary matching the published checksum', async (t) => {
  const files = new Map();
  const server = createServer((req, res) => { const f = files.get(req.url.slice(1)); if (!f) { res.writeHead(404).end(); return; } res.end(f); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, name = (await run(['--check'])).out.match(/htmlroom-relay-[a-z0-9-]+/)[0];
  const binary = Buffer.from('#!/bin/sh\necho relay-ran "$@"\n');
  files.set(name, binary);
  files.set('SHA256SUMS', `${createHash('sha256').update('something else').digest('hex')}  ${name}\n`);
  const bad = await run(['--dir', mkdtempSync(tmpdir() + '/qs-')], { HTMLROOM_RELEASE_BASE: base });
  assert.equal(bad.code, 1); assert.match(bad.out, /校验和不符/);
  files.delete('SHA256SUMS');
  assert.match((await run(['--dir', mkdtempSync(tmpdir() + '/qs-')], { HTMLROOM_RELEASE_BASE: base })).out, /SHA256SUMS/);
  files.set('SHA256SUMS', `${createHash('sha256').update(binary).digest('hex')}  ${name}\n`);
  const ok = await run(['--dir', mkdtempSync(tmpdir() + '/qs-'), '--port', '18555'], { HTMLROOM_RELEASE_BASE: base });
  assert.equal(ok.code, 0); assert.match(ok.out, /relay-ran -listen :18555/);
});
