import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { makeConfig } from '../html-room/crypto.js';
import { fragmentFor } from '../html-room/transport.js';
import { render } from '../scripts/build-html-room.mjs';

const port = 19230 + Math.floor(Math.random() * 100), ports = [port, port + 200];
const relays = ports.map(p => `ws://127.0.0.1:${p}`);
const dir = await mkdtemp(tmpdir() + '/hr-failover-');
const servers = [];
async function start(index) {
  const process_ = spawn(process.execPath, ['server/server.mjs'], {
    env: { ...process.env, PORT: String(ports[index]), HOST: '127.0.0.1' }, stdio: 'ignore',
  });
  servers[index] = process_;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${ports[index]}/healthz`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('relay fixture did not start');
}
async function stop(index) {
  const server = servers[index];
  if (!server || server.exitCode !== null) return;
  const done = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM'); await done;
}
let browser;
try {
  await start(0); await start(1);
  const config = await makeConfig(relays), rendered = await render(config, relays);
  const path = dir + '/room.html'; await writeFile(path, rendered.html);
  browser = await chromium.launch({ headless: true });
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const errors = [], sockets = [];
  for (const page of pages) {
    page.on('pageerror', e => errors.push(e.message));
    page.on('websocket', socket => sockets.push(socket.url()));
    await page.clock.install({ time: new Date() });
    await page.goto(pathToFileURL(path).href); await page.locator('#enter').click();
  }
  const ready = async index => {
    for (const page of pages) {
      await page.locator('#relay-status').filter({ hasText: relays[index] }).waitFor({ timeout: 12000 });
      await page.locator('#presence').filter({ hasText: '在线 2 人' }).waitFor({ timeout: 12000 });
      await page.locator('#status').filter({ hasText: '已加密连接' }).waitFor({ timeout: 12000 });
    }
  };
  const send = async (sender, text) => {
    await pages[sender].locator('#text').fill(text); await pages[sender].locator('#send').click();
    await pages[1-sender].locator('#messages li').filter({ hasText: text }).waitFor({ timeout: 10000 });
  };
  await ready(0); await send(0, '首选中继消息');
  await stop(0);
  // Advance only browser timers: exercise production retry delays without a long test wait.
  for (const page of pages) await page.clock.runFor(3000);
  await ready(1); await send(0, '备用中继消息'); await send(1, '备用中继回复');
  await start(0);
  for (const page of pages) await page.clock.fastForward(60000);
  await ready(0); await send(1, '首选恢复后的消息');
  assert.deepEqual(errors, []);
  assert.ok(sockets.every(url => relays.some(relay => url === `${relay}/hr/${config.roomId}`)));

  const maker = await browser.newPage();
  await maker.goto(`http://127.0.0.1:${port}/`);
  await maker.locator('#mk-advanced summary').click();
  await maker.locator('#mk-relay').fill(relays.join(', ')); await maker.locator('#mk-make').click();
  await maker.locator('#mk-out').waitFor({ state: 'visible' });
  assert.equal(await maker.locator('#mk-link-row').isHidden(), true, 'hosted entry cannot expand its trusted relay list');
  const download = maker.waitForEvent('download'); await maker.locator('#mk-download').click();
  const html = await readFile(await (await download).path(), 'utf8');
  assert.deepEqual(JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)[1]).relays, relays);
  let opened = 0; maker.on('websocket', () => opened++);
  await maker.goto(`http://127.0.0.1:${port}/hr.html${fragmentFor(config)}`);
  await maker.getByText(/房间链接打不开/).waitFor(); assert.equal(opened, 0);
  console.log('PASS: two real relays, failover, bidirectional backup chat, primary recovery, maker and hosted allowlist');
} finally {
  await browser?.close(); await stop(0); await stop(1); await rm(dir, { recursive: true, force: true });
}
