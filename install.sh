#!/usr/bin/env bash
# Ubuntu/Debian first installation. Run as root; prompts use /dev/tty for curl | bash.
set -Eeuo pipefail
trap 'printf "安装失败（第 %s 行）；请检查上方错误。已有文件不会被自动删除。\n" "$LINENO" >&2' ERR

die() { printf '%s\n' "$*" >&2; exit 1; }
mode=${1:-}
[[ $# -le 1 && ( -z "$mode" || "$mode" == --check ) ]] || die '用法：bash install.sh [--check]'
domain=${HR_DOMAIN:-}
destination=${HR_INSTALL_DIR:-/opt/htmlroom}
if [[ -z "$domain" ]]; then
  [[ -r /dev/tty ]] || die '无交互终端；请设置 HR_DOMAIN=chat.example.com。'
  read -r -p '已解析到本服务器的域名（不含 https://）：' domain </dev/tty
fi
domain=${domain,,}
[[ ${#domain} -le 253 && "$domain" == *.* && "$domain" != *[!a-z0-9.-]* && ! "$domain" =~ ^[0-9.]+$ ]] || die '请输入有效公网域名，不含协议、路径或端口。'
IFS=. read -r -a labels <<< "$domain"
[[ "$domain" != *. ]] || die '域名不能以点结尾。'
for label in "${labels[@]}"; do
  [[ ${#label} -ge 1 && ${#label} -le 63 && "$label" != -* && "$label" != *- ]] || die '域名标签不能为空、超过 63 字符或以连字符开头/结尾。'
done
[[ "$destination" == /* && "$destination" != *$'\n'* && "$destination" != *$'\r'* ]] || die 'HR_INSTALL_DIR 必须是绝对路径。'
[[ ! -e "$destination" && ! -L "$destination" ]] || die "安装目录已存在：$destination；为避免覆盖，已停止。更新请参考 docs/DEVELOPER.md。"
if [[ "$mode" == --check ]]; then
  printf '预检通过：域名 %s，安装目录 %s（未修改系统；DNS、端口和证书尚未验证）。\n' "$domain" "$destination"
  exit 0
fi
[[ "$EUID" -eq 0 ]] || die '请以 root 运行，例如 curl -fsSL URL | sudo bash。'
[[ -r /etc/os-release ]] || die '仅支持 Ubuntu/Debian。'
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] || die '自动安装仅支持 Ubuntu/Debian。'
[[ -n "${VERSION_CODENAME:-}" ]] || die '无法确定系统发行代号。'
printf '将安装到 %s；请确保域名 %s 已解析到本机，TCP 80/443 已开放且未被占用。\n' "$destination" "$domain"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location --connect-timeout 15 --max-time 120 \
    "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version >/dev/null 2>&1 || die 'Docker 已存在但缺少 Compose 插件，请安装支持 --wait 的 Docker Compose v2 或更新版本后重试。'
if ! docker info >/dev/null 2>&1; then
  systemctl enable --now docker
fi
docker info >/dev/null
git clone --depth 1 https://github.com/Freecode100Year/htmlroom.git "$destination"
cd "$destination"
[[ -f compose.production.yaml && -f deploy/Caddyfile ]] || die '拉取的版本尚未包含部署文件，请等待新版发布或使用包含这些文件的分支。'
umask 077
printf 'HR_DOMAIN=%s\n' "$domain" >.env.install
docker compose --env-file .env.install -f compose.production.yaml config --quiet
docker compose --env-file .env.install -f compose.production.yaml up -d --build --wait --wait-timeout 90
printf '容器已启动，正在检查本机与公网 HTTPS（证书签发可能需要约一分钟）……\n'
check_file=$(mktemp)
trap 'rm -f -- "$check_file"' EXIT
for target in local public; do
  resolve=()
  if [[ "$target" == local ]]; then
    resolve=(--resolve "$domain:443:127.0.0.1" --noproxy '*')
  fi
  if ! curl --fail --silent --show-error --output "$check_file" --connect-timeout 5 --max-time 10 \
    --retry 5 --retry-delay 3 --retry-max-time 60 --retry-all-errors "${resolve[@]}" "https://$domain/hr.js" \
    || ! cmp -s "$check_file" dist/hr.js; then
    die "HTTPS 或应用资源校验失败（$target）。请检查 DNS、80/443 端口和 Caddy 日志：cd '$destination' && docker compose --env-file .env.install -f compose.production.yaml logs --tail=80 caddy"
  fi
done
printf '部署完成：https://%s/\n安装目录：%s\n' "$domain" "$destination"
