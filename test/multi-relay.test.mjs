import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, validate, unlock } from '../html-room/crypto.js';
import { render } from '../scripts/build-html-room.mjs';
import { fillTemplate, fragmentFor, configFromHash } from '../html-room/transport.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('multiple relays are canonical, ordered, bounded and preserved by password wrapping', async () => {
  const c = await makeConfig(['wss://first.example/', 'wss://second.example', 'wss://first.example']);
  assert.equal(c.version, 2);
  assert.deepEqual(c.relays, ['wss://first.example', 'wss://second.example']);
  assert.equal('relay' in c, false);
  assert.equal((await unlock(c)).roomId, c.roomId);
  assert.deepEqual(configFromHash(fragmentFor(c)), c);
  const locked = await makeConfig(c.relays, 'test high entropy password');
  assert.equal((await unlock(locked, 'test high entropy password')).roomId, locked.roomId);
  for (const relays of [[], ['ws://remote.example'], ['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example']]) {
    await assert.rejects(makeConfig(relays));
  }
  assert.throws(() => validate({ ...c, relays: [...c.relays, c.relays[0]] }));
  assert.throws(() => validate({ ...c, version: 1, relay: c.relays[0] }));
});

test('all relay sources require explicit allowlisting and exact file CSP', async () => {
  const c = await makeConfig(['wss://first.example', 'wss://second.example']);
  const t = await render({}), result = await render(c, c.relays);
  assert.match(result.csp, /connect-src wss:\/\/first\.example wss:\/\/second\.example;/);
  assert.doesNotMatch(result.csp, /connect-src (?:\*|wss:;)/);
  assert.equal(await fillTemplate(t.html, c, c.relays, t.scriptHash, t.styleHash,
    createHash('sha256').update(t.html).digest('base64')), result.html);
  await assert.rejects(render(c, [c.relays[0]]));
  await assert.rejects(fillTemplate(t.html, c, [c.relays[0]], t.scriptHash, t.styleHash,
    createHash('sha256').update(t.html).digest('base64')));
});

test('CLI accepts repeated relay and allow-relay flags and refuses partial allowlists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hr-relays-'));
  const flags = ['--relay', 'wss://first.example', '--relay', 'wss://second.example', '--allow-relay', 'wss://first.example'];
  const run = path => execFileSync(process.execPath, ['scripts/build-html-room.mjs', 'room', '--out', path, ...flags], { stdio: 'pipe' });
  try {
    assert.throws(() => run(join(dir, 'denied.html')));
    flags.push('--allow-relay', 'wss://second.example');
    run(join(dir, 'room.html'));
    const html = await readFile(join(dir, 'room.html'), 'utf8');
    assert.deepEqual(JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)[1]).relays,
      ['wss://first.example', 'wss://second.example']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
