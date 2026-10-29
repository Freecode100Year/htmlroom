#!/bin/sh
# Canonical, self-contained installer: safe to consume through curl | sh.
set -eu
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
usage() {
  printf '%s\n' '用法：sh install.sh [--domain relay.example.com] [--build] [--check] [--uninstall]' \
    '开发测试：--domain localhost --skip-dns-check（仅本机 HTTP）' \
    '环境变量：HR_INSTALL_DIR=/opt/htmlroom；HR_DOMAIN；HR_HTTP_PORT=18080（仅开发）'
}
domain=${HR_DOMAIN:-}
destination=${HR_INSTALL_DIR:-/opt/htmlroom}
build=0; check=0; uninstall=0; development=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) [ "$#" -ge 2 ] || fail '--domain 缺少域名'; domain=$2; shift 2 ;;
    --build) build=1; shift ;;
    --check) check=1; shift ;;
    --uninstall) uninstall=1; shift ;;
    --skip-dns-check) development=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; fail '未知参数' ;;
  esac
done
case "$destination" in /*) ;; *) fail 'HR_INSTALL_DIR 必须是绝对路径' ;; esac
case "$destination" in *[!a-zA-Z0-9/_.-]*) fail '安装目录包含不安全字符' ;; esac
case "$destination/" in *'/../'*|*'/./'*|*'//'*) fail '安装目录包含不安全路径' ;; esac
[ ! -L "$destination" ] || fail '拒绝使用符号链接安装目录'
marker=htmlroom-installer-v1
if [ -e "$destination" ]; then
  if ! { [ -f "$destination/.htmlroom-install" ] && [ ! -L "$destination/.htmlroom-install" ] &&
    [ "$(cat "$destination/.htmlroom-install")" = "$marker" ]; }; then
    fail '目录已存在且没有本项目安装标记；拒绝覆盖或卸载'
  fi
fi
if [ "$uninstall" -eq 0 ]; then
  if [ -z "$domain" ]; then
    [ -r /dev/tty ] || fail '无交互终端；请使用 --domain relay.example.com'
    printf '已解析到本服务器的域名（不含协议）：' >/dev/tty
    read -r domain </dev/tty || fail '无法读取域名'
  fi
  domain=$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')
  if [ "$development" -eq 1 ]; then
    [ "$domain" = localhost ] || fail '--skip-dns-check 仅允许 localhost 本机开发 HTTP；公网域名必须检查 DNS 和 HTTPS'
  else
    [ "${#domain}" -le 253 ] || fail '域名过长'
    case "$domain" in *[!a-z0-9.-]*|.*|*.|*..*) fail '请输入有效公网域名' ;; esac
    case "$domain" in *.*) ;; *) fail '请输入有效公网域名' ;; esac
    case "$domain" in *[a-z]*) ;; *) fail '不能使用 IP 地址' ;; esac
    remaining=$domain
    while :; do
      label=${remaining%%.*}
      case "$label" in ''|-*|*-) fail '域名标签不能空白或以连字符开头/结尾' ;; esac
      [ "${#label}" -le 63 ] || fail '域名标签过长'
      [ "$remaining" != "$label" ] || break
      remaining=${remaining#*.}
    done
  fi
fi
if [ "$check" -eq 1 ]; then
  printf '预检通过：%s，目录 %s（尚未验证 DNS、端口和证书）\n' "$domain" "$destination"
  exit 0
fi
[ "$(uname -s)" = Linux ] || fail '仅支持 Linux Debian/Ubuntu'
case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) fail '仅支持 x86_64 / arm64' ;; esac
privileged=0
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || fail '请使用 root 或安装并配置 sudo'
  sudo -v || fail '需要 sudo 权限'
  privileged=1
fi
root() { if [ "$privileged" -eq 1 ]; then sudo "$@"; else "$@"; fi; }
project=htmlroom-$(printf '%s' "$destination" | cksum | cut -d ' ' -f 1)
compose() { root docker compose --project-name "$project" --project-directory "$destination" -f "$destination/compose.yaml" "$@"; }
if [ "$uninstall" -eq 1 ]; then
  if [ ! -e "$destination" ]; then printf '未安装，无需卸载。\n'; exit 0; fi
  if [ -f "$destination/compose.yaml" ]; then compose down; fi
  # Never recursively delete a user directory, source tree, Docker, or certificate volumes.
  root rm -f "$destination/compose.yaml" "$destination/Caddyfile"
  printf '已停止并移除本项目容器；保留目录、源码和证书卷。\n'
  exit 0
fi
[ -r /etc/os-release ] || fail '无法识别系统'
# shellcheck disable=SC1091
. /etc/os-release
case "$ID" in debian|ubuntu) ;; *) fail '自动安装仅支持 Debian/Ubuntu' ;; esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
# Development mode cannot install packages or start system services.
if ! command -v curl >/dev/null 2>&1 || { [ "$development" -eq 0 ] && ! command -v python3 >/dev/null 2>&1; }; then
  [ "$development" -eq 0 ] || fail '开发容器须预装 curl'
  root env DEBIAN_FRONTEND=noninteractive apt-get update
  root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl python3
fi
if [ "$development" -eq 0 ]; then
  # Check every returned A/AAAA address, including machines behind a public NAT.
  public4=$(curl -4fsS --connect-timeout 5 --max-time 10 https://api.ipify.org || :)
  public6=$(curl -6fsS --connect-timeout 5 --max-time 10 https://api6.ipify.org || :)
  local_ips=$(hostname -I)
  python3 - "$domain" "$public4 $public6 $local_ips" <<'PY'
import ipaddress, socket, sys
try:
    own = {ipaddress.ip_address(value) for value in sys.argv[2].split()}
    records = {ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(sys.argv[1], 443, type=socket.SOCK_STREAM)}
    if not records or not records.issubset(own):
        sys.exit('DNS 检查失败：域名的所有 A/AAAA 记录都必须指向本机公网地址；请更正解析后重试。')
except (OSError, ValueError):
    sys.exit('DNS 检查失败：无法解析域名或确认本机公网地址；请检查网络与 A/AAAA 记录。')
PY
fi
if ! command -v docker >/dev/null 2>&1; then
  [ "$development" -eq 0 ] || fail '开发容器须预装 Docker CLI 和 Compose'
  [ -n "${VERSION_CODENAME:-}" ] || fail '无法确定发行代号'
  root env DEBIAN_FRONTEND=noninteractive apt-get update
  root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  root install -m 0755 -d /etc/apt/keyrings
  curl -fsSL --connect-timeout 10 --max-time 60 "https://download.docker.com/linux/$ID/gpg" -o "$work/docker.asc"
  root install -m 0644 "$work/docker.asc" /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" >"$work/docker.list"
  root install -m 0644 "$work/docker.list" /etc/apt/sources.list.d/docker.list
  root env DEBIAN_FRONTEND=noninteractive apt-get update
  root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
root docker compose version >/dev/null 2>&1 || fail '已有 Docker 缺少 Compose v2；请安装 docker-compose-plugin 后重试'
if ! root docker info >/dev/null 2>&1; then
  [ "$development" -eq 0 ] || fail '开发容器无法连接 Docker daemon'
  root systemctl enable --now docker
  root docker info >/dev/null || fail 'Docker daemon 不可用'
fi
# World-readable configuration contains no secrets; unprivileged sudo reruns can read the marker.
root mkdir -p -m 0755 "$destination"
printf '%s\n' "$marker" >"$work/marker"
root install -m 0644 "$work/marker" "$destination/.htmlroom-install"
site=$domain
ports='      - "80:80"
      - "443:443"'
if [ "$development" -eq 1 ]; then
  port=${HR_HTTP_PORT:-18080}
  case "$port" in ''|*[!0-9]*) fail 'HR_HTTP_PORT 必须是端口数字' ;; esac
  if ! { [ "${#port}" -le 5 ] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ]; }; then
    fail '开发端口范围为 1024–65535'
  fi
  site=http://localhost
  ports="      - \"127.0.0.1:$port:80\""
fi
cat >"$work/Caddyfile" <<EOF_CADDY
{
    admin off
    log default {
        format filter {
            wrap json
            fields {
                request>headers>Sec-Websocket-Protocol delete
                request>headers>Authorization delete
                request>headers>Cookie delete
                request>remote_ip delete
                request>remote_port delete
                request>client_ip delete
            }
        }
    }
}
$site {
    # No access log. Preserve the subprotocol upstream for authentication;
    # redact it from runtime errors instead of deleting the request header.
    reverse_proxy htmlroom:8080
}
EOF_CADDY
build_line=''
if [ "$build" -eq 1 ]; then
  source_dir=${HR_SOURCE_DIR:-$destination/source}
  case "$source_dir" in /*) ;; *) fail 'HR_SOURCE_DIR 必须是绝对路径' ;; esac
  case "$source_dir" in *[!a-zA-Z0-9/_.-]*) fail '源码路径包含不安全字符' ;; esac
  if [ -z "${HR_SOURCE_DIR:-}" ] && [ ! -d "$source_dir" ]; then
    curl -fsSL --connect-timeout 10 --max-time 120 https://codeload.github.com/Freecode100Year/htmlroom/tar.gz/refs/heads/main -o "$work/source.tgz"
    root mkdir "$source_dir"
    root tar -xzf "$work/source.tgz" --strip-components=1 -C "$source_dir"
  fi
  if ! { [ -f "$source_dir/Dockerfile" ] && [ -f "$source_dir/dist/hr.js" ]; }; then
    fail '源码不完整，缺少 Dockerfile 或 dist/hr.js'
  fi
  build_line="    build: $source_dir"
fi
cat >"$work/compose.yaml" <<EOF_COMPOSE
services:
  htmlroom:
    image: ghcr.io/freecode100year/htmlroom:latest
$build_line
    restart: unless-stopped
    environment:
      TRUST_PROXY: "1"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
$ports
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      htmlroom:
        condition: service_healthy
volumes:
  caddy_data:
  caddy_config:
EOF_COMPOSE
root install -m 0644 "$work/Caddyfile" "$destination/Caddyfile"
root install -m 0644 "$work/compose.yaml" "$destination/compose.yaml"
compose config --quiet
if [ "$build" -eq 1 ]; then
  compose build htmlroom
else
  compose pull htmlroom || fail '无法拉取 GHCR 镜像；首次发布前或 GHCR 不可达时请使用 --build 从源码构建'
fi
compose up -d --wait --wait-timeout 90
if [ "$development" -eq 1 ]; then
  web=http://localhost:$port; websocket=ws://localhost:$port
else
  web=https://$domain; websocket=wss://$domain
fi
# TLS verification is always enabled. A wrong/non-JSON page is never healthy.
curl -fsS --connect-timeout 5 --max-time 10 --retry 5 --retry-delay 2 --retry-max-time 60 --retry-all-errors \
  "$web/healthz" >"$work/health"
grep -Eq '^\{"ok":true,"version":"[0-9][^"]*"\}$' "$work/health" || fail '/healthz 不是有效中继健康响应；请检查 Caddy、DNS 和证书'
printf '部署完成\n网页地址：%s/\n中继地址：%s\n安装目录：%s\n' "$web" "$websocket" "$destination"
