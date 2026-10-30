import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '../scripts/build-html-room.mjs';

for (const kind of ['node', 'file']) for (const upgrade of [false, true]) {
  test(`${kind}: malformed ${upgrade ? 'WebSocket upgrade' : 'HTTP'} URL returns 400 and keeps relay alive`, { timeout: 10000 }, async (t) => {
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    let args = ['server/server.mjs'];
    if (kind === 'file') {
      const dir = await mkdtemp(join(tmpdir(), 'hr-malformed-'));
      t.after(() => rm(dir, { recursive: true, force: true }));
      const file = join(dir, 'index.html');
      await writeFile(file, (await render({}, [])).html);
      args = [file, '--port', String(port), '--host', '127.0.0.1'];
    }
    const server = spawn(process.execPath, args, {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CONFIG_FILE: '', ENTRY_PATH: '', TLS_CERT: '', TLS_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill();
        await once(server, 'exit');
      }
    });
    await new Promise((resolve, reject) => {
      server.stdout.on('data', data => { if (String(data).includes('listening')) resolve(); });
      server.once('exit', code => reject(new Error(`relay exited: ${code}`)));
      server.once('error', reject);
    });
    const response = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      let text = '';
      socket.setTimeout(3000, () => socket.destroy(new Error('no HTTP response')));
      socket.on('error', reject);
      socket.on('data', data => { text += data; });
      socket.on('end', () => resolve(text));
      socket.on('connect', () => socket.write(
        `GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: ${upgrade ? 'Upgrade' : 'close'}\r\n${upgrade ? 'Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' : ''}\r\n`
      ));
    });
    assert.match(response, /^HTTP\/1\.1 400 /);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  });
}
