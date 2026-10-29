import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/install.sh', import.meta.url));
const linux = process.platform !== 'linux';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'htmlroom-install-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const command = (name, body) => writeFileSync(join(bin, name), '#!/bin/sh\nset -eu\n' + body, { mode: 0o755 });
  // Keep filesystem effects under the test runner's own UID, even on sudo-capable CI.
  command('id', 'printf "0\\n"\n');
  command('sudo', 'echo "unexpected privilege escalation in unit fixture" >&2; exit 78\n');
  // System/network boundaries only: all validation, state and generated files are real.
  command('docker', '[ "${FAIL_DOCKER:-0}" = 0 ] || exit 1\nexit 0\n');
  command('curl', 'case "$*" in *healthz*) printf \'%s\' "$HEALTH_BODY";; *) exit 8;; esac\n');
  command('apt-get', 'echo "unexpected package mutation" >&2; exit 77\n');
  const destination = join(root, 'install');
  const run = (args = [], extra = {}) => spawnSync('sh', [script, ...args], {
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, HR_INSTALL_DIR: destination, HEALTH_BODY: '{"ok":true,"version":"1.0.0"}', ...extra },
    encoding: 'utf8', timeout: 5000,
  });
  return { root, destination, bin, run, command, clean: () => rmSync(root, { recursive: true, force: true }) };
}
test('POSIX preflight rejects unsafe domains and unrelated directories without writes', { skip: linux }, () => {
  const f = fixture();
  try {
    assert.equal(f.run(['--check', '--domain', 'chat.example.com']).status, 0);
    assert.equal(existsSync(f.destination), false);
    for (const domain of ['https://chat.example.com', 'chat.example.com/path', 'bad\n{', '*.example.com', '-bad.example.com', 'a..example.com', 'localhost', '127.0.0.1', 'a.example.com.']) {
      assert.notEqual(f.run(['--check', '--domain', domain]).status, 0, domain);
    }
    assert.notEqual(f.run(['--check', '--domain', 'chat.example.com'], { HR_INSTALL_DIR: 'relative/path' }).status, 0);
    mkdirSync(f.destination);
    writeFileSync(join(f.destination, 'keep'), 'preserve');
    assert.notEqual(f.run(['--check', '--domain', 'chat.example.com']).status, 0);
    assert.equal(readFileSync(join(f.destination, 'keep'), 'utf8'), 'preserve');
  } finally { f.clean(); }
});
test('loopback install is idempotent and uninstall preserves user files and certificates', { skip: linux }, () => {
  const f = fixture();
  try {
    const args = ['--domain', 'localhost', '--skip-dns-check'];
    const installed = f.run(args);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /http:\/\/localhost:/);
    assert.match(installed.stdout, /ws:\/\/localhost:/);
    const compose = readFileSync(join(f.destination, 'compose.yaml'), 'utf8');
    assert.match(compose, /127\.0\.0\.1:/);
    assert.match(compose, /ghcr\.io\/freecode100year\/htmlroom:latest/);
    assert.equal(f.run(args).status, 0);
    writeFileSync(join(f.destination, 'keep'), 'mine');
    assert.equal(f.run(['--uninstall']).status, 0);
    assert.equal(readFileSync(join(f.destination, 'keep'), 'utf8'), 'mine');
    assert.equal(existsSync(join(f.destination, 'compose.yaml')), false);
    assert.equal(f.run(['--uninstall']).status, 0);
  } finally { f.clean(); }
});
test('HTTP escape hatch refuses public domains and production localhost', { skip: linux }, () => {
  const f = fixture();
  try {
    assert.notEqual(f.run(['--domain', 'chat.example.com', '--skip-dns-check']).status, 0);
    assert.notEqual(f.run(['--domain', 'localhost']).status, 0);
    assert.equal(existsSync(f.destination), false);
  } finally { f.clean(); }
});
test('uninstall refuses unmarked directories and symlinked installation paths', { skip: linux }, () => {
  const f = fixture();
  try {
    mkdirSync(f.destination);
    writeFileSync(join(f.destination, 'keep'), 'mine');
    assert.notEqual(f.run(['--uninstall']).status, 0);
    rmSync(f.destination, { recursive: true });
    symlinkSync(f.bin, f.destination);
    assert.notEqual(f.run(['--uninstall']).status, 0);
    assert.ok(existsSync(join(f.bin, 'docker')));
  } finally { f.clean(); }
});
test('invalid health content cannot be reported as a successful installation', { skip: linux }, () => {
  const f = fixture();
  try {
    const result = f.run(['--domain', 'localhost', '--skip-dns-check'], { HEALTH_BODY: '<html>unrelated</html>' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /部署完成/);
  } finally { f.clean(); }
});
test('piped non-root installer uses sudo per command without reexecuting stdin or $0', { skip: linux }, () => {
  const f = fixture();
  try {
    f.command('id', 'printf "1000\\n"\n');
    f.command('sudo', 'if [ "${1:-}" = -v ]; then exit 0; fi\nexec "$@"\n');
    const result = spawnSync('sh', ['-s', '--', '--domain', 'localhost', '--skip-dns-check'], {
      input: readFileSync(script, 'utf8'), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: f.bin + ':' + process.env.PATH, HR_INSTALL_DIR: f.destination, HEALTH_BODY: '{"ok":true,"version":"1.0.0"}' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /部署完成/);
  } finally { f.clean(); }
});

test('production checks every DNS address before Docker and keeps HTTPS mandatory', { skip: linux }, () => {
  const f = fixture();
  try {
    f.command('curl', 'case "$*" in *api6.ipify.org*) printf "2001:db8::1";; *api.ipify.org*) printf "203.0.113.1";; *healthz*) printf \'%s\' "$HEALTH_BODY";; *) exit 8;; esac\n');
    f.command('hostname', 'printf "10.0.0.2\\n"\n');
    // Keep the real Python IP normalization and installer logic, replace only DNS I/O.
    f.command('python3', `shift\nexec /usr/bin/python3 -c 'import os,socket,sys
socket.getaddrinfo=lambda *args,**kwargs: [(0,0,0,"",(ip,443)) for ip in os.environ["DNS_RECORDS"].split()]
exec(sys.stdin.read())' "$@"\n`);
    const called = join(f.root, 'docker-called');
    f.command('docker', 'touch "$TEST_DOCKER_CALLED"\nexit 0\n');
    const mismatch = f.run(['--domain', 'relay.example.com'], { DNS_RECORDS: '203.0.113.99', TEST_DOCKER_CALLED: called });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /DNS/);
    assert.equal(existsSync(called), false, 'DNS failure must precede Docker operations');
    assert.equal(existsSync(f.destination), false);
    const mixed = f.run(['--domain', 'relay.example.com'], { DNS_RECORDS: '203.0.113.1 2001:db8::99', TEST_DOCKER_CALLED: called });
    assert.notEqual(mixed.status, 0, 'a valid A must not hide a wrong AAAA');
    assert.equal(existsSync(called), false);
    const valid = f.run(['--domain', 'relay.example.com'], { DNS_RECORDS: '203.0.113.1 2001:0db8:0:0:0:0:0:1', TEST_DOCKER_CALLED: called });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /wss:\/\/relay\.example\.com/);
    assert.match(valid.stdout, /https:\/\/relay\.example\.com/);
    assert.doesNotMatch(readFileSync(join(f.destination, 'Caddyfile'), 'utf8'), /http:\/\//);
  } finally { f.clean(); }
});

test('changing domain loads the new Caddy site before reporting it ready', { skip: linux }, () => {
  const f = fixture();
  try {
    const active = join(f.root, 'active-caddy');
    f.command('curl', `case "$*" in
      *api6.ipify.org*) printf "2001:db8::1";;
      *api.ipify.org*) printf "203.0.113.1";;
      *healthz*) grep -Fq "$EXPECTED_DOMAIN {" "$ACTIVE_CADDY" || exit 22; printf '%s' "$HEALTH_BODY";;
      *) exit 8;; esac\n`);
    f.command('hostname', 'printf "203.0.113.1\\n"\n');
    f.command('python3', `shift\nexec /usr/bin/python3 -c 'import socket,sys
socket.getaddrinfo=lambda *args,**kwargs: [(0,0,0,"",("203.0.113.1",443))]
exec(sys.stdin.read())' "$@"\n`);
    // A running bind-mounted Caddyfile is not reloaded by ordinary Compose up.
    f.command('docker', `case " $* " in
      *' up '*)
        case " $* " in *' --force-recreate '*) cp "$HR_INSTALL_DIR/Caddyfile" "$ACTIVE_CADDY";;
          *) if [ ! -f "$ACTIVE_CADDY" ]; then cp "$HR_INSTALL_DIR/Caddyfile" "$ACTIVE_CADDY"; fi;; esac;;
      esac\n`);
    const env = { ACTIVE_CADDY: active, EXPECTED_DOMAIN: 'one.example.com' };
    const first = f.run(['--domain', 'one.example.com'], env);
    assert.equal(first.status, 0, first.stderr);
    const changed = f.run(['--domain', 'two.example.com'], { ...env, EXPECTED_DOMAIN: 'two.example.com' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /wss:\/\/two\.example\.com/);
  } finally { f.clean(); }
});
