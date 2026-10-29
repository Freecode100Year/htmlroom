// A room file made for a relay that is gone: members type their own relay into
// the file and chat. Strict files and web links show no relay box.
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { makeConfig } from '../html-room/crypto.js';
import { fragmentFor } from '../html-room/transport.js';
import { render } from '../scripts/build-html-room.mjs';
import { nodeRelay, nostrRelay } from '../test/fixtures/mesh-relays.mjs';

const dir = await mkdtemp(tmpdir() + '/hr-custom-');
const own = await nodeRelay(), nostr = await nostrRelay();
let browser;
try {
  const dead = 'wss://relay-that-is-gone.invalid';
  const config = await makeConfig(dead, 'pw', { custom: true });
  const path = dir + '/room.html'; await writeFile(path, (await render(config, config.relays)).html);
  browser = await chromium.launch({ headless: true });
  const errors = [], sockets = [];
  const open = async (relays) => {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('websocket', s => sockets.push(s.url()));
    await page.goto(pathToFileURL(path).href);
    assert.equal(await page.locator('#custom-relay').isVisible(), true);
    assert.equal(await page.locator('#relay-input').inputValue(), dead);
    await page.locator('#password').fill('pw');
    if (relays) await page.locator('#relay-input').fill(relays);
    await page.locator('#enter').click();
    return page;
  };
  // A bad address is reported and does not count as a wrong password.
  const probe = await open('http://nope.example');
  await probe.locator('#status').filter({ hasText: '中继地址不对' }).waitFor();
  assert.equal(await probe.locator('#enter').isEnabled(), true);
  await probe.close();

  // Classic: both type this project's relay.
  const a = await open(own.url), b = await open(own.url);
  for (const p of [a, b]) {
    await p.locator('#relay-status').filter({ hasText: own.url }).waitFor({ timeout: 15000 });
    await p.locator('#status').filter({ hasText: '已加密连接' }).waitFor({ timeout: 20000 });
  }
  await a.locator('#text').fill('文件里自己填的中继'); await a.locator('#send').click();
  await b.locator('#messages li').filter({ hasText: '文件里自己填的中继' }).waitFor({ timeout: 15000 });
  assert.ok(!sockets.some(u => u.includes('relay-that-is-gone')), 'the file\'s own relay was never tried');

  // Decentralized: different relay lists that share one relay still meet.
  const c = await open(`bc+${own.url}/bc/ nostr+${nostr.url}`), d = await open(`nostr+${nostr.url}`);
  for (const p of [c, d]) await p.locator('#status').filter({ hasText: '已加密连接' }).waitFor({ timeout: 30000 });
  await d.locator('#text').fill('只共用一个 Nostr 中继'); await d.locator('#send').click();
  await c.locator('#messages li').filter({ hasText: '只共用一个 Nostr 中继' }).waitFor({ timeout: 20000 });

  // Strict files and web links have no relay box.
  const strict = await makeConfig(own.url, undefined), strictPath = dir + '/strict.html';
  await writeFile(strictPath, (await render(strict, strict.relays)).html);
  const s = await browser.newPage(); await s.goto(pathToFileURL(strictPath).href);
  await s.locator('#status').filter({ hasText: '进入房间' }).waitFor();
  assert.equal(await s.locator('#custom-relay').isVisible(), false);
  const webConfig = await makeConfig(own.url, undefined, { custom: true });
  const w = await browser.newPage(); await w.goto(`http://127.0.0.1:${own.port}/hr.html${fragmentFor(webConfig)}`);
  await w.locator('#status').filter({ hasText: '进入房间' }).waitFor();
  assert.equal(await w.locator('#custom-relay').isVisible(), false);

  // The creation page makes custom-relay files by default, strict when unticked.
  const maker = await browser.newPage(); await maker.goto(`http://127.0.0.1:${own.port}/`);
  const made = async () => { await maker.locator('#mk-make').click(); await maker.locator('#mk-out').waitFor({ state: 'visible' });
    const dl = maker.waitForEvent('download'); await maker.locator('#mk-download').click(); const f = dir + '/made.html'; await (await dl).saveAs(f);
    return (await import('node:fs/promises')).readFile(f, 'utf8'); };
  assert.match(await made(), /connect-src wss: /);
  await maker.locator('#mk-advanced summary').click(); await maker.locator('#mk-custom').uncheck();
  assert.doesNotMatch(await made(), /connect-src wss: /);
  assert.deepEqual(errors, []);
  console.log('PASS: custom relays typed into the file (classic and decentralized), bad address handling, strict files and web links without the box, maker default');
} finally {
  await browser?.close(); await Promise.all([own.stop(), nostr.stop()]); await rm(dir, { recursive: true, force: true });
}
