import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const assets = new Map();
// The whole site is one file: index.html is the creator (hr.html is the same).
for (const [name,type] of [['index.html','text/html'],['hr.html','text/html'],['hr-template.html','text/html']]) {
  assets.set('/htmlroom/'+(name==='index.html'?'':name),{body:await readFile(new URL('../pages/'+name,import.meta.url)),type});
}
const server=createServer((req,res)=>{
  const asset=assets.get(req.url);
  if(!asset){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':asset.type});res.end(asset.body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const base=`http://127.0.0.1:${server.address().port}/htmlroom/`;
  assert.deepEqual(assets.get('/htmlroom/').body, assets.get('/htmlroom/hr.html').body);
  await page.goto(base);
  await page.locator('#mk-advanced > summary').click();
  assert.equal(await page.locator('#mk-relay').inputValue(),'wss://chat.nya.je');
  await page.locator('#mk-make').click();await page.locator('#mk-out').waitFor({state:'visible'});
  const link=await page.locator('#mk-link').inputValue();assert.ok(link.startsWith(base+'#hr1='));
  const event=page.waitForEvent('download');await page.locator('#mk-download').click();
  const download=await event;assert.equal(download.suggestedFilename(),'index.html');
  const html=await readFile(await download.path(),'utf8');
  const config=JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(config.relays,['wss://chat.nya.je']);
  assert.ok(/connect-src wss: [^;]*wss:\/\/chat\.nya\.je;/.test(html), 'custom-relay file still lists its relay');
  // A fresh tab, as a friend opening the link would.
  await page.goto('about:blank');await page.goto(link);await page.waitForFunction(()=>location.hash==='');
  await page.locator('#enter').waitFor({state:'visible'});
  assert.equal(await page.locator('#enter').isEnabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: Pages project subpath, one-file site with preset relay, local download index.html, and Fragment room entry');
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
