// End-to-end: a decentralized (version 3) room file over a Node /bc/ relay,
// the Go relay, a Nostr relay and an MQTT broker at once. Three members chat
// with the full signed hybrid encryption, agree on one safety code, and keep
// chatting as relays disappear.
import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { makeConfig } from '../html-room/crypto.js';
import { render } from '../scripts/build-html-room.mjs';
import { nodeRelay, goRelay, goAvailable, nostrRelay, mqttBroker } from '../test/fixtures/mesh-relays.mjs';

const dir = await mkdtemp(tmpdir() + '/hr-mesh-');
const node = await nodeRelay(), nostr = await nostrRelay(), mqtt = await mqttBroker(), go = goAvailable() ? await goRelay() : null;
let browser;
try {
  const relays = [`bc+${node.url}/bc/`, `nostr+${nostr.url}`, `mqtt+${mqtt.url}`, ...(go ? [`bc+${go.url}/bc/`] : [])];
  const config = await makeConfig(relays, 'mesh pass');
  assert.equal(config.version, 3);
  const path = dir + '/room.html'; await writeFile(path, (await render(config, config.relays)).html);
  browser = await chromium.launch({ headless: true });
  const errors = [], pages = [];
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(path).href);
    await page.locator('#password').fill('mesh pass'); await page.locator('#enter').click();
    pages.push(page);
  }
  for (const page of pages) {
    await page.locator('#relay-status').filter({ hasText: `已连接 ${relays.length}/${relays.length}` }).waitFor({ timeout: 20000 });
    await page.locator('#presence').filter({ hasText: '在线 3 人' }).waitFor({ timeout: 20000 });
    await page.locator('#safety').filter({ hasText: '安全码' }).waitFor({ timeout: 30000 });
  }
  const codes = await Promise.all(pages.map(p => p.locator('#safety').textContent()));
  assert.equal(new Set(codes).size, 1, 'all three see the same safety code');
  const send = async (from, text) => {
    await pages[from].locator('#text').fill(text); await pages[from].locator('#send').click();
    for (const [i, p] of pages.entries()) if (i !== from) await p.locator('#messages li').filter({ hasText: text }).waitFor({ timeout: 20000 });
  };
  await send(0, '四个中继同时在线');
  await pages[1].locator('#messages li').filter({ hasText: '四个中继同时在线' }).waitFor();
  assert.equal(await pages[1].locator('#messages li', { hasText: '四个中继同时在线' }).count(), 1, 'no duplicates');
  await pages[0].locator('#messages li small').filter({ hasText: /已送达 2\/2/ }).first().waitFor({ timeout: 20000 });

  await node.stop(); await go?.stop();
  for (const page of pages) await page.locator('#relay-status').filter({ hasText: '已连接 2/' }).waitFor({ timeout: 20000 });
  await send(1, '只剩 Nostr 和 MQTT');
  await mqtt.stop();
  for (const page of pages) await page.locator('#relay-status').filter({ hasText: '已连接 1/' }).waitFor({ timeout: 20000 });
  await send(2, '最后单靠 Nostr 一个中继');

  // A member leaves: the others see it within seconds.
  await pages.pop().close();
  for (const page of pages) await page.locator('#presence').filter({ hasText: '在线 2 人' }).waitFor({ timeout: 20000 });
  await send(0, '有人离开后继续');
  assert.ok(nostr.stats.rejected === 0);

  // Hosted generator: one click switches to this site's decentralized relay,
  // and the resulting web link works for two members.
  const site = await nodeRelay();
  try {
    const maker = await browser.newPage(); maker.on('pageerror', e => errors.push(e.message));
    await maker.goto(`http://127.0.0.1:${site.port}/`);
    await maker.locator('#mk-advanced summary').click();
    await maker.locator('#mk-mesh').click();
    assert.equal(await maker.locator('#mk-relay').inputValue(), `bc+${site.url}/bc/`);
    await maker.locator('#mk-make').click();
    await maker.locator('#mk-link-row').waitFor({ state: 'visible' });
    const link = await maker.locator('#mk-link').inputValue();
    const members = [await browser.newPage(), await browser.newPage()];
    for (const m of members) { m.on('pageerror', e => errors.push(e.message)); await m.goto(link); await m.locator('#enter').click(); }
    for (const m of members) await m.locator('#safety').filter({ hasText: '安全码' }).waitFor({ timeout: 30000 });
    await members[0].locator('#text').fill('网页链接进入去中心化房间'); await members[0].locator('#send').click();
    await members[1].locator('#messages li').filter({ hasText: '网页链接进入去中心化房间' }).waitFor({ timeout: 20000 });
    await maker.locator('#mk-relay').fill('wss://a.example nostr+wss://b.example'); await maker.locator('#mk-make').click();
    await maker.locator('#mk-error').filter({ hasText: '不能与去中心化中继' }).waitFor();
  } finally { await site.stop(); }
  assert.deepEqual(errors.filter(e => !/WebSocket|ERR_CONNECTION_REFUSED|net::/.test(e)), []);
  console.log(`PASS: decentralized room over ${relays.length} relays (bc node${go ? ', bc go' : ''}, nostr, mqtt): 3 members, one safety code, receipts, relay loss down to Nostr alone, departure; hosted one-click decentralized room via web link`);
} finally {
  await browser?.close();
  await Promise.all([node.stop(), nostr.stop(), mqtt.stop(), go?.stop()]);
  await rm(dir, { recursive: true, force: true });
}
