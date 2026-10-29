#!/bin/sh
# Real installation via a disposable non-root Debian container; no host apt/systemctl.
set -eu
repository=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/htmlroom-install-flow.XXXXXX")
project=htmlroom-$(printf '%s' "$work/install" | cksum | cut -d ' ' -f 1)
cleanup() {
  if [ -f "$work/install/compose.yaml" ]; then
    docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" down -v >/dev/null 2>&1 || :
  fi
  # Installer files are root-owned; return this disposable tree to the CI runner.
  if [ -d "$work/install" ]; then
    docker run --rm -v "$work:$work" htmlroom-installer:test \
      chown -R "$(id -u):$(id -g)" "$work" >/dev/null 2>&1 || :
  fi
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
# Same absolute host/container paths: the host daemon resolves the Caddy bind mount.
chmod 0755 "$work"
# A private checkout can be mode 0700; copy only build inputs into this test fixture.
mkdir "$work/source"
for input in Dockerfile .dockerignore package.json package-lock.json server src dist scripts; do
  cp -R "$repository/$input" "$work/source/$input"
done
chmod -R a+rX "$work/source"
docker build -f "$repository/test/installer/Dockerfile" -t htmlroom-installer:test "$repository/test/installer"
docker run --rm -e LANG=C.UTF-8 -v "$repository:$repository:ro" --entrypoint shellcheck htmlroom-installer:test \
  -s sh "$repository/scripts/install.sh" "$repository/install.sh" "$repository/scripts/test-install.sh"
# Installation runs as non-root; only privileged commands use sudo.
docker run --rm --network host --user installer \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$work:$work" \
  -e HR_SOURCE_DIR="$work/source" -e HR_INSTALL_DIR="$work/install" \
  -e HR_HTTP_PORT="${HR_TEST_HTTP_PORT:-18089}" \
  htmlroom-installer:test sh -c '
    set -eu
    test -r "$HR_SOURCE_DIR/scripts/install.sh"
    cat "$HR_SOURCE_DIR/scripts/install.sh" | sh -s -- --domain localhost --skip-dns-check --build
    cat "$HR_SOURCE_DIR/scripts/install.sh" | sh -s -- --domain localhost --skip-dns-check --build
  '
url=http://localhost:${HR_TEST_HTTP_PORT:-18089}
curl -fsS "$url/healthz"
curl -fsS "$url/hr.js" -o "$work/hr.js"
cmp "$work/hr.js" "$repository/dist/hr.js"
# Trigger a real reverse-proxy error and verify credential header redaction.
docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" stop htmlroom
status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Sec-WebSocket-Protocol: installer-secret-sentinel' "$url/healthz")
[ "$status" = 502 ]
docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" logs caddy >"$work/caddy.log"
if grep -q installer-secret-sentinel "$work/caddy.log"; then
  printf 'Caddy leaked WebSocket credentials\n' >&2
  exit 1
fi
# Check we actually exercised error logging, rather than passing with empty logs.
grep -q 'http.log.error' "$work/caddy.log"
docker run --rm --network host --user installer \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$work:$work" \
  -e HR_INSTALL_DIR="$work/install" \
  htmlroom-installer:test sh "$work/source/scripts/install.sh" --uninstall
[ ! -e "$work/install/compose.yaml" ]
# Uninstall intentionally retains volumes; remove only this disposable test project's volumes.
docker volume rm "${project}_caddy_data" "${project}_caddy_config" >/dev/null
printf '真实容器安装、幂等运行、代理脱敏和卸载验证通过。\n'
