#!/bin/sh
# Start an HTML Room broadcast relay (for decentralized rooms) without root,
# Docker, a domain or an open port:
#
#   curl -fsSL https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/scripts/relay-quickstart.sh | sh -s -- --tunnel
#
#   --tunnel        get a public wss:// address through a free Cloudflare quick
#                   tunnel (downloads cloudflared next to the relay if needed)
#   --port N        local port (default 8080)
#   --dir DIR       where to keep the binaries (default ~/.htmlroom-relay)
#   --from-source   build with a local Go toolchain instead of downloading
#   --check         print what would be downloaded and exit
# Runs on Linux, macOS, FreeBSD, WSL, Termux and OpenWrt (busybox sh).
set -eu
REPO=${HTMLROOM_REPO:-Freecode100Year/htmlroom}
BASE=${HTMLROOM_RELEASE_BASE:-https://github.com/$REPO/releases/latest/download}
PORT=8080 DIR=${HOME:-.}/.htmlroom-relay TUNNEL=0 SOURCE=0 CHECK=0
while [ $# -gt 0 ]; do
  case $1 in
    --tunnel) TUNNEL=1 ;;
    --port) PORT=${2:?--port 需要端口号}; shift ;;
    --dir) DIR=${2:?--dir 需要目录}; shift ;;
    --from-source) SOURCE=1 ;;
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
  shift
done
case $PORT in ''|*[!0-9]*) echo "端口无效：$PORT" >&2; exit 2 ;; esac

platform() {
  os=$(uname -s | tr 'A-Z' 'a-z'); m=$(uname -m)
  case $os in linux|darwin|freebsd) ;; msys*|mingw*|cygwin*) os=windows ;; *) echo "不支持的系统：$os" >&2; exit 1 ;; esac
  [ "$os" = linux ] && [ -n "${PREFIX:-}" ] && case $PREFIX in *com.termux*) os=android ;; esac
  case $m in
    x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7*|armv6*|arm) arch=arm ;;
    i386|i686) arch=386 ;; mips) arch=mips ;; mipsel|mipsle) arch=mipsle ;; riscv64) arch=riscv64 ;;
    *) echo "不支持的处理器：$m" >&2; exit 1 ;;
  esac
  echo "$os-$arch"
}
fetch() { # url file
  if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else echo "需要 curl 或 wget" >&2; exit 1; fi
}

P=$(platform); EXT=; case $P in windows-*) EXT=.exe ;; esac
RELAY=$DIR/htmlroom-relay$EXT
CF_ARCH=${P#*-}; case $CF_ARCH in arm) CF_ARCH=arm ;; esac
CF_URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${P%-*}-$CF_ARCH
[ "${P%-*}" = darwin ] && CF_URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$CF_ARCH.tgz
if [ $CHECK = 1 ]; then
  echo "平台：$P"; echo "中继：$BASE/htmlroom-relay-$P$EXT -> $RELAY"; [ $TUNNEL = 1 ] && echo "隧道：$CF_URL"; exit 0
fi
mkdir -p "$DIR"
if [ $SOURCE = 1 ]; then
  command -v go >/dev/null 2>&1 || { echo "--from-source 需要 Go 1.22+" >&2; exit 1; }
  src=$(cd "$(dirname "$0")/../relay/go" 2>/dev/null && pwd) || { echo "请在仓库中运行 --from-source" >&2; exit 1; }
  (cd "$src" && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$RELAY" .)
elif [ ! -x "$RELAY" ]; then
  echo "下载中继：htmlroom-relay-$P$EXT"
  fetch "$BASE/htmlroom-relay-$P$EXT" "$RELAY.part"
  fetch "$BASE/SHA256SUMS" "$DIR/SHA256SUMS" || { rm -f "$RELAY.part"; echo "无法下载 SHA256SUMS，未安装" >&2; exit 1; }
  want=$(grep " htmlroom-relay-$P$EXT\$" "$DIR/SHA256SUMS" | cut -d' ' -f1)
  got=$( (sha256sum "$RELAY.part" 2>/dev/null || shasum -a 256 "$RELAY.part") | cut -d' ' -f1)
  [ -n "$want" ] && [ "$want" = "$got" ] || { rm -f "$RELAY.part"; echo "校验和不符，已删除下载文件" >&2; exit 1; }
  chmod +x "$RELAY.part"; mv "$RELAY.part" "$RELAY"
fi
ARGS="-listen 127.0.0.1:$PORT"
if [ $TUNNEL = 1 ]; then
  CF=$(command -v cloudflared 2>/dev/null || echo "$DIR/cloudflared")
  if [ ! -x "$CF" ]; then
    echo "下载 cloudflared（Cloudflare 官方隧道客户端）"
    case $CF_URL in
      *.tgz) fetch "$CF_URL" "$DIR/cf.tgz"; tar -xzf "$DIR/cf.tgz" -C "$DIR"; rm -f "$DIR/cf.tgz" ;;
      *) fetch "$CF_URL" "$DIR/cloudflared" ;;
    esac
    chmod +x "$DIR/cloudflared"; CF=$DIR/cloudflared
  fi
  ARGS="$ARGS -tunnel -cloudflared $CF"
else
  ARGS="-listen :$PORT"
  echo "未使用 --tunnel：请在前面配置 HTTPS 反向代理，房间里填写 bc+wss://你的域名/bc/"
fi
# shellcheck disable=SC2086
exec "$RELAY" $ARGS
