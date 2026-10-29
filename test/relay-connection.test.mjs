import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayConnection } from '../html-room/relay-connection.js';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
  const sockets = [], active = [], frames = [];
  const controller = new RelayConnection(['wss://a.example', 'wss://b.example'], {
    roomId: '0'.repeat(64), protocols: () => ['pt2'],
    createSocket: url => {
      const ws = { url, readyState: 0, close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }, send() {},
        hello() { this.readyState = 1; this.onmessage({ data: JSON.stringify({ type: 'hello', you: 1, resume: 'a'.repeat(32) }) }); },
        frame(m) { this.onmessage({ data: JSON.stringify(m) }); } };
      sockets.push(ws); return ws;
    },
    onactive: async (ws, index, changed) => active.push([index, changed]),
    onmessage: m => frames.push(m), onnotice() {}, onfatal() {}, ondisconnect() {},
  });
  t.after(() => controller.stop());
  controller.start();
  return { controller, sockets, active, frames };
}
test('relay failure rotates in order; failed primary probe preserves backup; healthy primary takes over', async t => {
  const { sockets, active, frames } = fixture(t);
  sockets[0].close(); t.mock.timers.tick(1000);
  assert.equal(sockets[1].url, 'wss://b.example/hr/' + '0'.repeat(64));
  sockets[1].hello(); await settle();
  assert.deepEqual(active, [[1, false]]);
  t.mock.timers.tick(60000); assert.equal(sockets[2].url, sockets[0].url);
  sockets[2].close(); assert.equal(sockets[1].readyState, 1);
  // Keep heartbeat alive while testing the second probe.
  sockets[1].frame({ type: 'pong' });
  t.mock.timers.tick(60000);
  sockets[3].hello(); await settle();
  assert.deepEqual(active, [[1, false], [0, true]]);
  assert.equal(sockets[1].readyState, 3);
  const count = frames.length;
  sockets[1].frame({ type: 'msg', from: 2 });
  assert.equal(frames.length, count, 'late backup messages must be ignored');
});
test('handshake timeout advances and stop cancels pending retries', t => {
  const { controller, sockets } = fixture(t);
  t.mock.timers.tick(10000); t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  controller.stop(); t.mock.timers.tick(120000);
  assert.equal(sockets.length, 2);
});
test('heartbeat timeout switches relay even when the peer never completes close', async t => {
  const { sockets } = fixture(t);
  sockets[0].hello(); await settle();
  sockets[0].close = function () { this.readyState = 2; };
  t.mock.timers.tick(66000); t.mock.timers.tick(1000);
  assert.equal(sockets[1].url, 'wss://b.example/hr/' + '0'.repeat(64));
});
