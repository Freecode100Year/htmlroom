// The generated password is readable and copyable, survives creating the room,
// and opens it; the room page can show what is typed. Both on the site and in
// a local file (where the copy may fall back to select-and-copy).
import { chromium } from 'playwright';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { render } from '../scripts/build-html-room.mjs';
import { configFromRoomHtml } from '../html-room/template.js';
import { unlock } from '../html-room/crypto.js';
import { nodeRelay } from '../test/fixtures/mesh-relays.mjs';

const FORMAT = /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){4}$/;
const dir = await mkdtemp(tmpdir() + '/hr-pw-');
const relay = await nodeRelay();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = []; const watch = p => { p.on('pageerror', e => errors.push(e.message)); return p; };
  const page = watch(await ctx.newPage());
  await page.goto(`http://127.0.0.1:${relay.port}/`);
  await page.locator('#mk-gen').click();
  const pw = await page.locator('#mk-pass').inputValue();
  assert.match(pw, FORMAT, 'readable groups, no look-alike characters');
  assert.equal(await page.locator('#mk-pass').getAttribute('type'), 'text', 'shown after generating');
  assert.equal(await page.locator('#mk-show').textContent(), '隐藏');
  await page.locator('#mk-copy-pass').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), pw, 'copied to the clipboard');
  await page.locator('#mk-show').click();
  assert.equal(await page.locator('#mk-pass').getAttribute('type'), 'password');
  await page.locator('#mk-show').click();
  await page.locator('#mk-make').click(); await page.locator('#mk-out').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#mk-pass-row').isVisible(), true, 'the password stays readable with the result');
  assert.equal(await page.locator('#mk-pass-out').inputValue(), pw);
  await page.evaluate(() => navigator.clipboard.writeText('-'));
  await page.locator('#mk-pass-copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), pw);
  const dl = page.waitForEvent('download'); await page.locator('#mk-download').click();
  const roomPath = dir + '/room.html'; await (await dl).saveAs(roomPath);
  const config = configFromRoomHtml(await readFile(roomPath, 'utf8'));
  assert.equal(config.encrypted, true);
  assert.equal((await unlock(config, pw)).roomId, config.roomId, 'the shown password opens the room');

  // The room page: show what is typed, then enter with the copied password.
  const room = watch(await ctx.newPage()); await room.goto(pathToFileURL(roomPath).href);
  await room.locator('#password').fill(pw);
  assert.equal(await room.locator('#password').getAttribute('type'), 'password');
  await room.locator('#pw-show').click();
  assert.equal(await room.locator('#password').getAttribute('type'), 'text');
  await room.locator('#enter').click();
  await room.locator('#relay-status').filter({ hasText: relay.url }).waitFor({ timeout: 15000 });

  // A local creator without clipboard permission: copy falls back, and the text is left selected.
  const blankPath = dir + '/creator.html'; await writeFile(blankPath, (await render({}, [])).html);
  const local = watch(await (await browser.newContext()).newPage()); await local.goto(pathToFileURL(blankPath).href);
  await local.locator('#mk-gen').click();
  const pw2 = await local.locator('#mk-pass').inputValue();
  assert.match(pw2, FORMAT); assert.notEqual(pw2, pw);
  await local.locator('#mk-copy-pass').click();
  await local.locator('#mk-error').filter({ hasText: /口令已复制|口令已选中/ }).waitFor();
  assert.equal(await local.evaluate(() => getSelection().toString() || document.activeElement.value.slice(document.activeElement.selectionStart, document.activeElement.selectionEnd)), pw2, 'selected for copying by hand');
  assert.deepEqual(errors, []);
  console.log('PASS: generated password readable and copyable, kept on the result, opens the room; show/hide on both forms; local-file copy fallback');
} finally {
  await browser?.close(); await relay.stop(); await rm(dir, { recursive: true, force: true });
}
