// A room made for relay A is re-targeted to relay B (in the file itself, by
// the hosted converter and by the CLI); members then chat through B only.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { makeConfig } from '../html-room/crypto.js';
import { render } from '../scripts/build-html-room.mjs';
import { checkHtml } from '../scripts/check-html-room.mjs';

const base = 19530 + Math.floor(Math.random() * 100), ports = [base, base + 200];
const [relayA, relayB] = ports.map(p => `ws://127.0.0.1:${p}`);
const dir = await mkdtemp(tmpdir() + '/hr-retarget-');
const servers = [];
async function start(port) {
  const child = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  servers.push(child);
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('relay fixture did not start');
}
const configOf = html => JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)[1]);
let browser;
try {
  await start(ports[0]); await start(ports[1]);
  const password = 'correct horse battery staple';
  const config = await makeConfig([relayA], password), original = await render(config, [relayA]);
  const oldPath = dir + '/old.html'; await writeFile(oldPath, original.html);
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));

  // 1. In-file conversion, no password needed.
  await page.goto(pathToFileURL(oldPath).href);
  await page.locator('#retarget summary').click();
  assert.equal(await page.locator('#rt-relay').inputValue(), relayA);
  await page.locator('#rt-relay').fill('http://evil.example/path'); await page.locator('#rt-make').click();
  await page.locator('#rt-status').filter({ hasText: '生成失败' }).waitFor();
  await page.locator('#rt-relay').fill(relayB); await page.locator('#rt-make').click();
  const download = page.waitForEvent('download'); await page.locator('#rt-download').click();
  const newHtml = await readFile(await (await download).path(), 'utf8');
  const next = configOf(newHtml);
  assert.deepEqual(next, { ...config, relays: [relayB] }, 'only relays change; wrapped key, salt, roomId kept');
  assert.equal(newHtml, (await render(next, [relayB])).html, 'byte-identical to a fresh build');
  await checkHtml(newHtml, original.scriptHash);
  assert.match(newHtml, new RegExp(`connect-src ${relayB};`));
  const newPath = dir + '/new.html'; await writeFile(newPath, newHtml);

  // 2. Two members with the new file chat through relay B only.
  const members = await Promise.all([browser.newPage(), browser.newPage()]);
  const sockets = [];
  for (const m of members) {
    m.on('pageerror', e => errors.push(e.message)); m.on('websocket', s => sockets.push(s.url()));
    await m.goto(pathToFileURL(newPath).href);
    await m.locator('#password').fill(password); await m.locator('#enter').click();
  }
  for (const m of members) {
    await m.locator('#relay-status').filter({ hasText: relayB }).waitFor({ timeout: 15000 });
    await m.locator('#presence').filter({ hasText: '在线 2 人' }).waitFor({ timeout: 15000 });
    await m.locator('#status').filter({ hasText: '已加密连接' }).waitFor({ timeout: 15000 });
  }
  await members[0].locator('#text').fill('自建中继你好'); await members[0].locator('#send').click();
  await members[1].locator('#messages li').filter({ hasText: '自建中继你好' }).waitFor({ timeout: 10000 });
  assert.ok(sockets.length && sockets.every(u => u === `${relayB}/hr/${config.roomId}`), 'never touched relay A');

  // 3. Hosted converter on relay B's own page turns the old file into the same result.
  const maker = await browser.newPage(); maker.on('pageerror', e => errors.push(e.message));
  await maker.goto(`http://127.0.0.1:${ports[1]}/`);
  await maker.locator('#cv summary').click();
  await maker.locator('#cv-file').setInputFiles(oldPath);
  await maker.locator('#cv-relay').fill(`${relayB} ${relayA}`); await maker.locator('#cv-make').click();
  const d2 = maker.waitForEvent('download'); await maker.locator('#cv-download').click();
  const hosted = await readFile(await (await d2).path(), 'utf8');
  assert.deepEqual(configOf(hosted).relays, [relayB, relayA]);
  await checkHtml(hosted, original.scriptHash);

  // 4. CLI.
  const cliOut = dir + '/cli.html';
  execFileSync(process.execPath, ['scripts/build-html-room.mjs', 'retarget', '--in', oldPath, '--out', cliOut, '--relay', relayB]);
  assert.equal(await readFile(cliOut, 'utf8'), newHtml);

  assert.deepEqual(errors, []);
  console.log('PASS: in-file, hosted and CLI relay re-targeting; chat on the new relay with the unchanged password');
} finally {
  await browser?.close();
  for (const s of servers) s.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
