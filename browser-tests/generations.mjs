// Every file creates the next: a blank creator makes room A offline, A makes
// room B (new key, new password), B makes C; each output is byte-identical to
// a release build. Then members chat in B. The hosted site offers itself as
// an offline creator.
import { chromium } from 'playwright';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { unlock } from '../html-room/crypto.js';
import { configFromRoomHtml } from '../html-room/template.js';
import { render } from '../scripts/build-html-room.mjs';
import { checkHtml } from '../scripts/check-html-room.mjs';
import { nodeRelay } from '../test/fixtures/mesh-relays.mjs';

const dir = await mkdtemp(tmpdir() + '/hr-gen-');
const relay = await nodeRelay();
let browser;
try {
  const blank = await render({}, []);
  const creatorPath = dir + '/creator.html'; await writeFile(creatorPath, blank.html);
  browser = await chromium.launch({ headless: true });
  const offline = await browser.newContext({ acceptDownloads: true }); await offline.setOffline(true);
  const errors = [], requests = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('request', r => { if (!/^(file|blob|data):/.test(r.url())) requests.push(r.url()); }); return p; };
  const create = async (page, { relays, password, expand }) => {
    if (expand) await page.locator('#new-room > summary').click();
    if (relays) { if (!(await page.locator('#mk-relay').isVisible())) await page.locator('#mk-advanced > summary').click(); await page.locator('#mk-relay').fill(relays); }
    if (password) await page.locator('#mk-pass').fill(password);
    await page.locator('#mk-make').click();
    await page.locator('#mk-out').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#mk-link-row').isVisible(), false, 'no link from a local file');
    const dl = page.waitForEvent('download'); await page.locator('#mk-download').click();
    const path = dir + `/${Math.random().toString(36).slice(2)}.html`; await (await dl).saveAs(path);
    const html = await readFile(path, 'utf8');
    await checkHtml(html, blank.scriptHash); // identical to a release build of the same config
    return { path, html, config: configFromRoomHtml(html) };
  };

  // Generation 0: the blank creator, offline.
  const g0 = watch(await offline.newPage()); await g0.goto(pathToFileURL(creatorPath).href);
  assert.equal(await g0.locator('#maker').isVisible(), true);
  assert.equal(await g0.locator('#unlock').isVisible(), false);
  assert.equal(await g0.locator('#mk-relay').inputValue(), '');
  const a = await create(g0, { relays: relay.url, password: 'first pass' });
  assert.equal(a.config.custom, true);

  // Generation 1: room A creates room B with a different password.
  const g1 = watch(await offline.newPage()); await g1.goto(pathToFileURL(a.path).href);
  assert.equal(await g1.locator('#unlock').isVisible(), true);
  assert.equal(await g1.locator('#maker').isVisible(), false, 'folded in a room file');
  await g1.locator('#new-room > summary').click();
  await g1.locator('#mk-advanced > summary').click();
  assert.equal(await g1.locator('#mk-relay').inputValue(), relay.url, 'starts from this room\'s relays');
  const b = await create(g1, { password: 'second pass' });
  assert.notEqual(b.config.roomId, a.config.roomId, 'a new room, not a copy');
  assert.equal((await unlock(b.config, 'second pass')).roomId, b.config.roomId);
  await assert.rejects(unlock(b.config, 'first pass'));

  // Generation 2: B creates C, no password, decentralized.
  const g2 = watch(await offline.newPage()); await g2.goto(pathToFileURL(b.path).href);
  const c = await create(g2, { expand: true, relays: `bc+${relay.url}/bc/` });
  assert.equal(c.config.version, 3); assert.equal(c.config.encrypted, false);
  assert.deepEqual(requests, [], 'creating needs no network at all');

  // Members chat in B (online).
  const online = await browser.newContext();
  const members = [watch(await online.newPage()), watch(await online.newPage())];
  for (const m of members) { await m.goto(pathToFileURL(b.path).href); await m.locator('#password').fill('second pass'); await m.locator('#enter').click(); }
  for (const m of members) await m.locator('#status').filter({ hasText: '已加密连接' }).waitFor({ timeout: 20000 });
  await members[0].locator('#text').fill('第二代房间'); await members[0].locator('#send').click();
  await members[1].locator('#messages li').filter({ hasText: '第二代房间' }).waitFor({ timeout: 15000 });

  // The site is the creator; it hands out itself as an offline creator.
  const site = watch(await online.newPage()); await site.goto(`http://127.0.0.1:${relay.port}/`);
  assert.equal(await site.locator('#maker').isVisible(), true);
  await site.locator('#mk-self-row').waitFor({ state: 'visible' });
  const dl = site.waitForEvent('download'); await site.locator('#mk-self').click();
  const selfPath = dir + '/offline-creator.html'; await (await dl).saveAs(selfPath);
  const selfHtml = await readFile(selfPath, 'utf8');
  assert.equal(selfHtml, (await render({ relays: [relay.url] }, [])).html, 'the offline creator remembers this site\'s relay');
  await checkHtml(selfHtml, blank.scriptHash);
  const again = watch(await offline.newPage()); await again.goto(pathToFileURL(selfPath).href);
  assert.equal(await again.locator('#mk-relay').inputValue(), relay.url);
  assert.deepEqual(errors, []);
  console.log('PASS: blank creator -> room A -> room B (new key, new password) -> room C, all offline and byte-identical to release builds; chat in B; site saves itself as an offline creator');
} finally {
  await browser?.close(); await relay.stop(); await rm(dir, { recursive: true, force: true });
}
