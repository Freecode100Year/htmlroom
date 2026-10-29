import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../install.sh', import.meta.url));
test('installer preflight validates input before making host changes', { skip: process.platform !== 'linux' && 'Ubuntu/Debian installer requires Linux and Bash 4+' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'htmlroom-install-'));
  const destination = join(root, 'new-install');
  const run = (domain, dir = destination) => spawnSync('bash', [script, '--check'], {
    env: { ...process.env, HR_DOMAIN: domain, HR_INSTALL_DIR: dir }, encoding: 'utf8', timeout: 5000,
  });
  try {
    const valid = run('chat.example.com');
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /chat\.example\.com/);
    assert.equal(existsSync(destination), false, 'check-only must not create files');
    for (const domain of ['https://chat.example.com', 'chat.example.com/path', 'bad\n{', '*.example.com', '-bad.example.com', 'a..example.com', 'localhost', '127.0.0.1']) {
      assert.notEqual(run(domain).status, 0, domain);
    }
    assert.notEqual(run('chat.example.com', 'relative/path').status, 0);
    const marker = join(root, 'keep.txt');
    writeFileSync(marker, 'preserve me');
    assert.notEqual(run('chat.example.com', root).status, 0);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve me');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Installation effects are external: replace package/network/container commands,
// but execute the real installer and inspect its exit status and written files.
test('installer refuses unrelated public HTTPS content before reporting success', {
  skip: process.platform !== 'linux' || process.getuid?.() !== 0,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'htmlroom-install-readiness-'));
  const bin = join(root, 'bin');
  const { status: mkdirStatus } = spawnSync('mkdir', ['-p', bin]);
  assert.equal(mkdirStatus, 0);
  const command = (name, body) => writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o755 });
  command('apt-get', 'exit 0\n');
  command('docker', 'exit 0\n');
  command('git', 'destination=${@: -1}\nmkdir -p "$destination/deploy" "$destination/dist"\ntouch "$destination/compose.production.yaml" "$destination/deploy/Caddyfile"\nprintf "expected application" >"$destination/dist/hr.js"\n');
  command('curl', 'output=/dev/stdout\nbody=$TEST_PUBLIC_BODY\nwhile (($#)); do\n if [[ "$1" == --resolve ]]; then body="expected application"; fi\n if [[ "$1" == --output || "$1" == -o ]]; then output=$2; shift; fi\n shift\ndone\nprintf "%s" "$body" >"$output"\n');
  const run = (leaf, body) => spawnSync('bash', [script], {
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, HR_DOMAIN: 'chat.example.com',
      HR_INSTALL_DIR: join(root, leaf), TEST_PUBLIC_BODY: body }, encoding: 'utf8', timeout: 5000,
  });
  try {
    const unrelated = run('unrelated', '<html>another website</html>');
    assert.notEqual(unrelated.status, 0, unrelated.stdout + unrelated.stderr);
    assert.doesNotMatch(unrelated.stdout, /部署完成/);
    const valid = run('valid', 'expected application');
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /部署完成/);
    assert.equal(readFileSync(join(root, 'valid/.env.install'), 'utf8'), 'HR_DOMAIN=chat.example.com\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
