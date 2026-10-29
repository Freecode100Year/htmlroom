import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { derive, hex } from '../html-room/crypto.js';

// Node lacks cloudflare:workers. Only replace its base class; execute the
// actual fetch handler, origin/access validation and routing unchanged.
async function worker() {
  const result = await build({ entryPoints: ['src/worker.js'], bundle: true, write: false, format: 'esm', plugins: [{
    name: 'cloudflare-base-class', setup(b) {
      b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'workers', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class DurableObject {}' }));
    }
  }] });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`)).default;
}

test('missing JOIN_LIMIT forwards valid joins and warns only once without request secrets', async (t) => {
  const handler = await worker();
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const d = await derive(new Uint8Array(32).fill(42));
  const request = () => new Request(`https://relay.example/hr/${d.roomId}`, { headers: {
    Upgrade: 'websocket', Origin: 'https://relay.example',
    'Sec-WebSocket-Protocol': `pt2,a${hex(d.access)}`, 'CF-Connecting-IP': '192.0.2.42'
  } });
  let forwarded = 0;
  const env = { ROOMS: { idFromName: n => n, get: () => ({ fetch: () => { forwarded++; return new Response('forwarded'); } }) } };
  for (let i = 0; i < 3; i++) assert.equal(await (await handler.fetch(request(), env)).text(), 'forwarded');
  assert.equal(forwarded, 3);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]), /JOIN_LIMIT/);
  for (const secret of [d.roomId, hex(d.access), '192.0.2.42']) assert.ok(!String(warnings).includes(secret));
  let limited = 0;
  env.JOIN_LIMIT = { limit: async ({ key }) => { assert.equal(key, '192.0.2.42'); limited++; return { success: true }; } };
  assert.equal((await handler.fetch(request(), env)).status, 200);
  assert.equal(limited, 1);
  assert.equal(warnings.length, 1);
});
