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
# Exercise the default download/extraction branch with a local source archive.
tar -czf "$work/source.tgz" -C "$work" source
mkdir "$work/bin"
cat >"$work/bin/curl" <<'CURL'
#!/bin/sh
set -eu
case "$*" in
  *https://codeload.github.com/Freecode100Year/htmlroom/tar.gz/refs/heads/main*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -o ]; then cp "$HR_TEST_SOURCE_ARCHIVE" "$2"; exit 0; fi
      shift
    done
    exit 2 ;;
  *) exec /usr/bin/curl "$@" ;;
esac
CURL
chmod 0755 "$work/bin/curl"
docker build -f "$repository/test/installer/Dockerfile" -t htmlroom-installer:test "$repository/test/installer"
docker run --rm -e LANG=C.UTF-8 -v "$repository:$repository:ro" --entrypoint shellcheck htmlroom-installer:test \
  -s sh "$repository/scripts/install.sh" "$repository/install.sh" "$repository/scripts/test-install.sh"
# Installation runs as non-root; only privileged commands use sudo.
install_once() {
  docker run --rm --network host --user installer \
    -v /var/run/docker.sock:/var/run/docker.sock -v "$work:$work" \
    -e HR_SOURCE_DIR= -e HR_INSTALL_DIR="$work/install" \
    -e HR_TEST_SOURCE_ARCHIVE="$work/source.tgz" -e HR_TEST_BOOTSTRAP="$work/source/scripts/install.sh" \
    -e PATH="$work/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    -e HR_HTTP_PORT="${HR_TEST_HTTP_PORT:-18089}" \
    htmlroom-installer:test sh -c '
      set -eu
      test -r "$HR_TEST_BOOTSTRAP"
      cat "$HR_TEST_BOOTSTRAP" | sh -s -- --domain localhost --skip-dns-check --build
      test -r "$HR_INSTALL_DIR/source/Dockerfile"
    '
}
install_once
initial_caddy=$(docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" ps -q caddy)
install_once
[ "$initial_caddy" = "$(docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" ps -q caddy)" ]
url=http://localhost:${HR_TEST_HTTP_PORT:-18089}
curl -fsS "$url/healthz"
curl -fsS "$url/hr.js" -o "$work/hr.js"
cmp "$work/hr.js" "$repository/dist/hr.js"
# Load an old site rule, then prove rerunning the installer replaces the active config.
docker run --rm -v "$work:$work" htmlroom-installer:test sh -c '
  sed "/reverse_proxy/i\\    respond /installer-stale-config stale" "$1" >"$1.next"
  mv "$1.next" "$1"
' sh "$work/install/Caddyfile"
docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" \
  up -d --no-deps --force-recreate --wait --wait-timeout 30 caddy
[ "$(curl -fsS "$url/installer-stale-config")" = stale ]
old_caddy=$(docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" ps -q caddy)
install_once
[ "$old_caddy" != "$(docker compose -p "$project" --project-directory "$work/install" -f "$work/install/compose.yaml" ps -q caddy)" ]
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$url/installer-stale-config")" = 404 ]
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
printf '真实非 root 源码下载安装、幂等运行、Caddy 配置更新、代理脱敏和卸载验证通过。\n'
