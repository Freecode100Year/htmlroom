// One file is the whole system: `node index.html` serves the creator and
// relays; the browser creates a room there, two members chat through it, and
// the room file they got runs as a relay itself.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { render } from '../scripts/build-html-room.mjs';
import { checkHtml } from '../scripts/check-html-room.mjs';
import { configFromRoomHtml } from '../html-room/template.js';

const dir = await mkdtemp(tmpdir() + '/hr-file-server-');
const children = [];
const start = (file, port) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [file, '--port', String(port), '--host', '127.0.0.1'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); let out = '';
  child.stdout.on('data', d => { out += d; if (out.includes('listening')) done(child); });
  child.on('exit', c => fail(new Error(`exited ${c}: ${out}`)));
});
let browser;
try {
  const blank = await render({}, []);
  await writeFile(dir + '/index.html', blank.html);
  const port = 19700 + Math.floor(Math.random() * 200), site = `http://127.0.0.1:${port}`;
  await start(dir + '/index.html', port);
  browser = await chromium.launch({ headless: true });
  const errors = [], watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); return p; };
  const maker = watch(await browser.newPage());
  await maker.goto(site + '/');
  await maker.locator('#mk-advanced > summary').click();
  assert.equal(await maker.locator('#mk-relay').inputValue(), `ws://127.0.0.1:${port}`, 'the file\'s own relay is the default');
  await maker.locator('#mk-pass').fill('file server');
  await maker.locator('#mk-make').click(); await maker.locator('#mk-link-row').waitFor({ state: 'visible' });
  const link = await maker.locator('#mk-link').inputValue();
  // The QR code beside 复制链接: drawn on a canvas under the page's CSP, toggles off again.
  assert.equal(await maker.locator('#mk-qr-row').isVisible(), false);
  await maker.locator('#mk-qr').click();
  assert.equal(await maker.locator('#mk-qr-out').isVisible(), true);
  const qr = await maker.locator('#mk-qr-out').evaluate(c => { const g = c.getContext('2d'), px = (x, y) => g.getImageData(x, y, 1, 1).data[0];
    let d = 0; while (d < c.width && px(d, d)) d++; const mod = d / 4; // the border is 4 modules
    return { w: c.width, h: c.height, quiet: px(2, 2), finder: px(d + 3.5 * mod, d + 3.5 * mod), ring: px(d + 1.5 * mod, d + 1.5 * mod) }; });
  assert.ok(qr.w >= 300 && qr.w === qr.h, 'square code of a scannable size');
  assert.equal(qr.quiet, 255, 'white border'); assert.equal(qr.finder, 0, 'dark finder centre'); assert.equal(qr.ring, 255, 'light finder ring');
  assert.equal(await maker.locator('#mk-qr').textContent(), '隐藏二维码');
  await maker.locator('#mk-qr').click();
  assert.equal(await maker.locator('#mk-qr-row').isVisible(), false);
  const dl = maker.waitForEvent('download'); await maker.locator('#mk-download').click();
  const roomPath = dir + '/room.html'; await (await dl).saveAs(roomPath);
  const roomHtml = await readFile(roomPath, 'utf8');
  await checkHtml(roomHtml, blank.scriptHash);
  assert.ok(roomHtml.startsWith('<!-- HTML Room'), 'the new file carries the server half');

  // Two members: one by link (served by the file), one by the downloaded file.
  const a = watch(await browser.newPage()), b = watch(await browser.newPage());
  await a.goto(link); await b.goto(pathToFileURL(roomPath).href);
  for (const p of [a, b]) { await p.locator('#password').fill('file server'); await p.locator('#enter').click(); }
  for (const p of [a, b]) await p.locator('#status').filter({ hasText: '已加密连接' }).waitFor({ timeout: 20000 });
  await a.locator('#text').fill('同一个文件既是网站也是中继'); await a.locator('#send').click();
  await b.locator('#messages li').filter({ hasText: '同一个文件既是网站也是中继' }).waitFor({ timeout: 15000 });

  // The room file itself runs as a relay (and keeps its key to itself).
  const port2 = port + 300; await start(roomPath, port2);
  const page = await (await fetch(`http://127.0.0.1:${port2}/`)).text();
  assert.doesNotMatch(page, /pt-room-config/);
  const config = configFromRoomHtml(roomHtml);
  const moved = watch(await browser.newPage()), moved2 = watch(await browser.newPage());
  for (const p of [moved, moved2]) {
    await p.goto(pathToFileURL(roomPath).href);
    await p.locator('#password').fill('file server'); await p.locator('#relay-input').fill(`ws://127.0.0.1:${port2}`); await p.locator('#enter').click();
  }
  for (const p of [moved, moved2]) await p.locator('#relay-status').filter({ hasText: String(port2) }).waitFor({ timeout: 15000 });
  await moved.locator('#text').fill('房间文件自己当中继'); await moved.locator('#send').click();
  await moved2.locator('#messages li').filter({ hasText: '房间文件自己当中继' }).waitFor({ timeout: 20000 });
  assert.equal(config.custom, true);
  assert.deepEqual(errors.filter(e => !/WebSocket|net::/.test(e)), []);
  console.log('PASS: node index.html serves the creator and relays; chat by link and by file through it; the room file runs as a relay itself without exposing its key');
} finally {
  await browser?.close(); for (const c of children) c.kill(); await rm(dir, { recursive: true, force: true });
}
