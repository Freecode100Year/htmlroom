# HTML Room 开发与部署说明

这份文档面向开发者和自建服务的用户。普通使用说明见 [README](../README.md)。

## 技术特性

- **单文件客户端**：下载名统一为 `index.html`，也支持通过网页房间链接加入。
- **浏览器本地生成**：房间主密钥、口令包装和 HTML 拼装在浏览器内完成，主密钥不发送给中继。
- **端到端加密**：使用 AES-GCM、HKDF，以及 ECDH P-256 + ML-KEM-768 混合密钥交换；支持 ECDSA P-256 消息签名和安全码核对。
- **连接恢复**：心跳检测、指数退避重连、待发消息重试及客户端消息确认。
- **内存会话**：客户端不使用 Cookie、localStorage 或 IndexedDB 保存聊天状态；中继不持久化聊天记录。
- **独立部署**：提供 Node.js、Docker 和 Cloudflare Workers 中继，以及 GitHub Pages 静态前端。

只支持文字聊天，单房间最多 **25 人**，单条消息最多 **500 字**。不包含大厅、图片、文件传输或桌游。

## 前端与中继如何配合

| 部分 | 当前地址 | 职责 |
| --- | --- | --- |
| 静态前端 | <https://freecode100year.github.io/htmlroom/> | 生成房间文件、提供网页聊天入口 |
| 聊天中继 | `wss://chat.nya.je` | 校验加入凭证，转发加密消息 |
| 备用前端 | <https://chat.nya.je/> | 在中继站点提供生成器和网页入口 |

GitHub Pages 只托管前端，不运行 WebSocket 服务。聊天连接使用 `/hr/<roomId>`，由独立中继处理；相同房间配置的成员必须连接到**同一个中继**才能相遇。

Pages 生成的网页房间链接保留在 Pages。下载文件内的静态备用链接指向中继站点的 `/hr.html`，用于文件预览无法运行脚本时恢复进入同一房间。

## 本地运行

需要 **Node.js 22 或更高版本**。

```sh
git clone https://github.com/Freecode100Year/htmlroom.git
cd htmlroom
npm ci
npm start
```

打开 <http://localhost:8080/>，即可在本地创建房间和聊天。仓库已包含 `dist/` 构建资源；修改前端源码后执行：

```sh
npm run build
```

普通构建默认连接页面同源中继。本项目可独立运行，无需下载来源仓库。

## 部署前端到 GitHub Pages

仓库中的 [Pages 工作流](../.github/workflows/pages.yml) 在 `main` 更新时自动构建并发布，也可手动触发。自行部署时，在仓库 **Settings → Pages → Source** 中选择 **GitHub Actions**。

```sh
npm ci
npm run build:pages
```

输出目录为 `pages/`，包含 `index.html`、脚本、样式和无房间秘密的模板，支持 `/htmlroom/` 这样的项目子路径。不要将自行生成的真实房间文件提交到公开仓库。

默认中继为 `wss://chat.nya.je`。使用自己的中继时，设置构建环境变量，并在 Pages 工作流中同步配置：

```sh
HR_PAGES_RELAY=wss://relay.example.com npm run build:pages
```

中继需要允许前端的精确 HTTPS Origin。例如本项目使用：

```text
HR_ALLOWED_ORIGINS=https://freecode100year.github.io
```

Node 使用同名环境变量；Worker 可在 `wrangler.jsonc` 的 `vars` 中设置。多个源用逗号分隔，不接受通配符。放行 Origin 后，连接仍须提供有效房间凭证。

Origin 不包含路径，因此该设置会允许整个 `freecode100year.github.io` 来源，不能只限制到 `/htmlroom/`；同一账号的其他 Pages 项目也共享这个 Origin。

## 部署前端到 Vercel

[一键创建 Vercel 项目](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FFreecode100Year%2Fhtmlroom&env=HR_PAGES_RELAY)。仓库的 `vercel.json` 使用 `npm ci` 安装依赖、`npm run build:pages` 构建，并发布 `pages/`，不启动 `npm start` 或部署 Node 中继。选择 Node.js 22 或更高的受支持版本。

1. 先部署自己的 Cloudflare/Node 中继，在 Vercel 环境变量里设置 `HR_PAGES_RELAY=wss://relay.example.com`。
2. 部署后确认固定生产域名，例如 `https://my-room.vercel.app`。
3. 在中继设置 `HR_ALLOWED_ORIGINS=https://my-room.vercel.app` 并重新部署或重启中继。来源不带路径或末尾斜杠，多个来源用逗号分隔。Preview 域名如需使用也须逐个放行，不支持通配符。
4. 用两个浏览器打开同一房间链接，检查双方在线和消息互通。

未设置 `HR_PAGES_RELAY` 时，静态构建仍默认使用 `wss://chat.nya.je`；该服务不保证允许你的 Vercel 来源。修改构建变量后需要重新部署前端。前端 CSP 在构建时允许指定中继；改用另一个中继时也应更新该变量并重新构建。

本次只提供静态前端部署。现有 Node 中继把房间放在单进程内存中，不可直接当作多实例 Vercel Function 使用；完整中继适配及 Redis 消息分发未实现。参见 [Vercel Deploy Button 文档](https://vercel.com/docs/deploy-button)。

## 服务器一键安装（Ubuntu/Debian）

支持 Docker 官方 apt 仓库支持的 Debian/Ubuntu、x86_64 与 arm64，安装脚本为 POSIX sh。服务器须能访问 GitHub、Docker 软件仓库、GHCR 和证书颁发服务。将域名的所有 A/AAAA 记录指向本机；IPv6 记录也必须可访问。开放 TCP 80/443，并停止占用这两个端口的服务。DNS 核验使用系统解析器、网卡地址及 ipify HTTPS 返回的公网地址；不匹配时在安装 Docker 前停止。若服务器的 NAT/代理导致公网出口与入口不同，需先修正网络，脚本不会跳过公网域名的 DNS 核验。

```sh
curl -fsSL https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/scripts/install.sh \
  | sh -s -- --domain chat.example.com
```

省略 `--domain` 时从 `/dev/tty` 读取域名；非 root 用户会按命令使用 sudo，不会将管道中的脚本重新执行为文件。保留兼容入口 `install.sh` 和环境变量 `HR_DOMAIN`、`HR_INSTALL_DIR`。域名与路径格式预检无需 root，不访问网络，也不安装软件：

```sh
HR_INSTALL_DIR=/opt/htmlroom sh scripts/install.sh --domain chat.example.com --check
```

默认拉取 `ghcr.io/freecode100year/htmlroom:latest`。仓库的 **Publish relay image** 工作流在推送任意 tag 时发布 linux/amd64 与 linux/arm64，同时支持手动 `workflow_dispatch` 发布首次镜像。GHCR 包首次发布可能仍为私有；维护者须确认公开可见性并验证匿名拉取，公开仓库本身不保证包可匿名访问。首次发布前或 GHCR 不可用时使用 `--build`：脚本下载 `main` 源码并用 Docker 构建，不依赖 GHCR，但需要 GitHub、Docker Hub、npm 可达。也可设置 `HR_SOURCE_DIR=/绝对路径/htmlroom` 使用已审阅的本地源码（含提交的 `dist/`）。

已有 Docker 时跳过安装，但需 Compose v2 支持 `--wait`；缺少插件时明确停止，不替换已有引擎。Docker 不存在时使用官方 apt 仓库。安装工具仅用系统软件包（curl、证书、Python 3 参与 DNS 地址规范化），未增加中继运行时依赖。

默认目录 `/opt/htmlroom` 必须不存在，或持有 `.htmlroom-install` 安装标记。该目录中的 `compose.yaml` 与 `Caddyfile` 由唯一实现 `scripts/install.sh` 生成；修改后重跑脚本会覆盖这两个文件。重复执行保留证书卷和源码，重新写入配置并启动服务。默认模式拉取最新镜像，`--build` 模式重建现有源码；要更新已下载源码，先审阅并更新 `/opt/htmlroom/source`，或使用新的 `HR_SOURCE_DIR`。更新重启会中断当前连接与内存会话。此版本的安装器不接管旧版 git clone 安装；请使用新的空目录，旧目录不会被覆盖。

只有 Caddy 发布 80/443；Node 仅在内部网络运行并启用 `TRUST_PROXY=1`。Caddy 默认不开启访问日志，运行时错误日志删除 `Sec-WebSocket-Protocol`、Authorization、Cookie、客户端 IP/端口字段；认证子协议头仍完整转发给中继。生产验证始终使用带证书校验的 HTTPS `/healthz`，不自动降为 HTTP。证书签发或 DNS 有误时保留现场并返回失败，修复后可重复执行。

```sh
# 安装与更新（默认拉取 GHCR）
sh scripts/install.sh --domain chat.example.com
# 从源码安装与重建
sh scripts/install.sh --domain chat.example.com --build
# 查看状态；项目名由安装目录稳定派生
HR_PROJECT=htmlroom-$(printf '%s' /opt/htmlroom | cksum | cut -d ' ' -f 1)
sudo docker compose -p "$HR_PROJECT" -f /opt/htmlroom/compose.yaml ps
curl -f https://chat.example.com/healthz
# 卸载；自定义目录时保留相同 HR_INSTALL_DIR
sh scripts/install.sh --uninstall
```

卸载只操作有安装标记的项目：停止其 Compose 服务，删除生成的配置，保留安装标记、目录、自有文件、源码及证书卷，支持重复卸载。不删除 Docker、其他服务或其他项目卷。若需允许外部前端，可手动给生成 Compose 的 `htmlroom.environment` 增加 `HR_ALLOWED_ORIGINS` 精确 HTTPS 来源；重跑安装器会覆盖手动配置，本站同源前端无需此设置。

仅本机开发允许 HTTP：

```sh
HR_INSTALL_DIR=/tmp/my-htmlroom HR_HTTP_PORT=18080 \
  sh scripts/install.sh --domain localhost --skip-dns-check --build
```

`--skip-dns-check` 只能搭配 `localhost`，仅发布 `127.0.0.1` 高位端口，须预装 Docker/Compose 与 curl；该模式不安装软件或启动系统服务。它不能用于公网域名或公网证书绕过。CI 的 `sh scripts/test-install.sh` 在 Debian 容器中以非 root 用户通过 sudo 和 Docker socket 实际安装，验证幂等、资源与健康响应、Caddy 错误日志脱敏及卸载。容器与宿主机绑定目录保持相同绝对路径，避免宿主 Docker daemon 找不到 Caddyfile。仅测试项目的临时目录和证书卷会被清理；不会在宿主机安装软件或申请公网证书。

本步骤不改变房间格式、客户端 CSP 或协议，现有房间文件仍可用。公网全新服务器安装、自动证书签发及远程 arm64 运行需在对应基础设施验证，容器测试不能替代这些检查。

## 部署聊天中继

### Node.js 与 HTTPS 反向代理

以下示例适用于 POSIX Shell；Windows 可使用 PowerShell 设置对应环境变量。

```sh
HOST=127.0.0.1 \
PORT=8080 \
TRUST_PROXY=1 \
HR_ALLOWED_ORIGINS=https://your-account.github.io \
npm start
```

将前端源替换为实际地址。仅在可信反向代理之后设置 `TRUST_PROXY=1`，并配置有效的 HTTPS 证书。例如 Caddy：

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Node 也支持通过 `TLS_CERT`、`TLS_KEY` 直接提供 HTTPS。可用 `JOIN_LIMIT`、`MAX_CONNECTIONS` 限制连接，通过 `GET /healthz` 检查服务状态。

代理、诊断和监控应对整个 `Sec-WebSocket-Protocol` 请求头脱敏，其中包含敏感的 access/resume 凭证。不要记录房间链接、口令或密钥，不要关闭 TLS 证书校验。

### Docker

```sh
docker compose up -d --build
```

默认仅绑定 `127.0.0.1:8080`，仍需前置 HTTPS 代理。若前端部署在其他源，请在 Compose 服务的 `environment` 中配置 `HR_ALLOWED_ORIGINS`；使用可信代理时同时配置 `TRUST_PROXY=1`。

### Cloudflare Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Freecode100Year/htmlroom)

按钮会从公开仓库创建项目，读取 `package.json` 的 `build` / `deploy` 脚本，并按 Wrangler 配置创建 Durable Objects。前端与中继同源，默认不需设置 `HR_ALLOWED_ORIGINS`。参见 [Cloudflare 部署按钮文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

官方按钮资源支持列表列出了 Durable Objects，未明确列出 Rate Limiting。实测按钮正确跳转到 Cloudflare 控制台，但当前浏览器测试环境遇到验证页（HTTP 403），未完成登录账户后的端到端部署。如果按钮报告不支持 `JOIN_LIMIT`，在创建的仓库中删除 `wrangler.jsonc` 的 `ratelimits` 项后重试，或使用下方 CLI 部署。Worker 已使用 `if (env.JOIN_LIMIT)` 检查绑定是否存在；移除后会跳过该层加入速率限制，并在每个 Worker isolate 第一次合法加入时仅记录一次固定警告，不记录 IP、房间号或凭证；房间人数、访问校验和帧大小限制继续生效，但抗批量加入能力降低。不要移除 `ROOMS` 或 Durable Objects 迁移。

`durable_objects.bindings` 的 `ROOMS` 对应导出的 `Room` 类，`migrations` 中 `v1/new_sqlite_classes` 用于首次创建 SQLite Durable Object；参见[官方入门](https://developers.cloudflare.com/durable-objects/get-started/)与[迁移文档](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)。官方目前也提供新的 `exports` 声明方式，并明确旧 `migrations` 仍受支持；这里保留现有迁移，避免更改部署生命周期。`ratelimits` 的 `name/namespace_id/simple` 格式来自[官方 Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)，Wrangler dry-run 接受这些配置不等于按钮已通过线上授权部署。

部署完成后到 Cloudflare 控制台 **Workers & Pages → 自己的 Worker → Visit / 访问**，复制显示的 `workers.dev` HTTPS 地址。`/` 提供前端，`/hr/<roomId>` 提供同源中继；无需配置 `HR_ALLOWED_ORIGINS`。自定义域名与 ECH 的开启及验证见 [ECH 说明](ECH.md)。

全新克隆需要 Node.js 22+，先运行 `npm ci`，再 `npm run build` 和 `npm run deploy`。构建只依赖仓库文件及锁定依赖，不依赖本地 `.wrangler`、房间文件或私有配置；实际发布需要 Cloudflare 登录或构建环境提供凭证。仅检查打包可执行 `npm run deploy -- --dry-run`。

命令行部署：

```sh
npm ci
npx wrangler login
npm run deploy
```

使用本项目的 [wrangler.jsonc](../wrangler.jsonc)，发布前检查 Worker 名称和目标账户。配置会创建 `Room` Durable Object 命名空间，使用 WebSocket Hibernation API 及自动心跳响应。

需要连接外部静态前端时，在 `vars` 中加入对应 `HR_ALLOWED_ORIGINS`。GitHub Pages 工作流只发布前端，**不会自动部署或更新 Worker、Node 中继**。

中继使用根路径下的 `/hr/<roomId>`，不支持 `ENTRY_PATH`；这不影响 Pages 前端部署在项目子路径。

## 多中继房间

房间配置使用 `version: 2` 和有序的 `relays` 列表，最多 3 个不同的精确中继源。旧 `version: 1` 文件和链接不兼容，需要重新生成。网页生成器接受逗号或空格分隔的多个中继；CLI 可以重复传入 `--relay`，同时必须逐个用 `--allow-relay` 明确放行全部源：

```sh
node scripts/build-html-room.mjs room \
  --out out/index.html \
  --relay wss://primary.example.com \
  --relay wss://backup.example.com \
  --allow-relay wss://primary.example.com \
  --allow-relay wss://backup.example.com
```

所有成员使用同一份配置，按同一顺序尝试中继。握手 10 秒未收到合法 `hello` 或心跳超过 65 秒未响应时切换；重试间隔从 1 秒指数增长，最多 30 秒；备用连接建立后每 60 秒探测首选，收到合法 `hello` 才接管当前连接。不是所有浏览器都把 CSP 的 `self` 视作 WebSocket 来源，文件始终列出精确 WS/WSS 源；参考 [MDN connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src) 和 [WebSocket 错误事件](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/error_event)。远程仅 WSS，回环 WS 只用于本地开发。

跨中继会重新握手并清除旧中继的 resume、成员编号绑定和回执状态；未发送的内存消息继续排队，已提交但未确认的消息显示送达状态未知，不自动跨中继重放。请核实后手动重发并重新核对安全码。不同网络环境下成员仍可能暂时分裂，在线人数只代表当前中继，不能保证全局汇合。

网站就是一个空白房间文件（创建器），能打开任意中继的房间链接。静态前端可在构建时预设创建器的默认中继（同时也是默认顺序）：

```sh
HR_PAGES_RELAYS='wss://primary.example.com,wss://backup.example.com' npm run build:pages
```

Vercel 配置同名构建变量并重新部署。旧 `HR_PAGES_RELAY` 仍接受单项，`HR_PAGES_RELAYS` 优先。经典中继须放行该前端的精确 HTTPS Origin（`HR_ALLOWED_ORIGINS`）才能从网站链接入房；从文件打开（Origin 为 `null`）不受影响。不要把房间主密钥放到查询参数中。

## 单文件：每个文件都是创建器

整个前端只有一个文件，由 `html-room/template.js` 生成，脚本入口是 `html-room/file.js`：

| 文件内容 | 打开后 |
| --- | --- |
| 房间配置 | 聊天；「换中继」；折叠的「创建一个新房间」 |
| 空白配置 `{}` 或 `{"relays":[…]}` | 创建器（创建房间、转换旧文件、托管时可下载离线版） |
| 空白配置 + `#hr1=` 链接 | 用链接里的房间聊天 |

新文件由当前页面正在运行的脚本和样式字节（`currentScript`、`<style>`）加上新配置拼出（`htmlFor`），不联网、不请求任何资源，结果与 `render(config)` 逐字节一致，可用 `verify-room-file.mjs` 核验。空白文件的 CSP connect-src 为 `wss: ws://localhost:* ws://127.0.0.1:*`，以便打开任意房间链接。

`npm run build` 生成 `dist/hr.html`（网站首页，服务器在运行时以自身地址作为默认中继）、`dist/hr-template.html`（空白创建器，发布核验基准）和 `dist/_headers`（HTTP CSP 固定同一脚本/样式哈希）。`build:pages` 把预设中继写进空白配置，输出 `index.html`/`hr.html`。旧的 `hr.js`/`hr.css` 网页入口已移除。

## 去中心化房间（version 3）

中继列表中出现带前缀的地址时，房间使用 `version: 3`。经典中继与去中心化中继不能混用；去中心化中继 1–5 个，全部同时连接：

| 前缀 | 连接地址 | 兼容条件 |
| --- | --- | --- |
| `bc+wss://host/path/` | `wss://host/path/<topic>`（路径缺省为 `/bc/`） | 把收到的文本帧转发给同一路径的其他连接；帧最大约 12 KB；不需要回显给发送者 |
| `nostr+wss://host` | 原地址 | NIP-01；发布临时事件 kind `20111`，标签 `["t", topic]`，订阅 `{kinds:[20111], "#t":[topic]}`；每次会话使用一次性 secp256k1 密钥签名；需接受临时事件、不要求 NIP-42 登录或 NIP-13 工作量证明 |
| `mqtt+wss://host/mqtt` | 原地址，WebSocket 子协议 `mqtt` | MQTT 3.1.1，QoS 0，clean session，主题 `htmlroom/<topic>`，允许匿名 |

`topic` 由主密钥派生（HKDF `private-talk/html-room/v3/topic` 的前 32 个十六进制字符），与 roomId 无法互相推出。每个帧都是 AES-256-GCM 密文（密钥来自 HKDF `private-talk/html-room/v3/mesh`，AAD 绑定 topic），中继和没有房间文件的人既读不懂也伪造不了；解不开的帧被直接丢弃。帧按 IV 去重，所以同一条消息经多个中继到达只处理一次。

本项目的 Node/Docker 服务器和 Cloudflare Worker 都提供 `/bc/<32 位十六进制>`：只转发文本帧，帧大小 16000 字节、每连接每 10 秒 60 帧、每个 topic 50 个连接上限，Origin 规则与 `/hr/` 相同（文件的 `null`、同源、`HR_ALLOWED_ORIGINS`）。生成器「中继服务器（一般不用改）」里的「改用去中心化中继」按钮会填入本站的 `bc+` 地址；只有全部中继都是本站 bc 路径时才提供网页链接，其他组合请使用房间文件。

成员协商规则见 [协议说明](html-room/protocol.md#v3-去中心化中继)。

### 单文件中继（Go）

`relay/go` 是一个只用 Go 标准库实现的 bc 中继，交叉编译后单个文件约 6 MB，可在 Windows、macOS、Linux、FreeBSD、Android（Termux）以及 OpenWrt 路由器（mips/mipsle/arm）上运行，没有运行时依赖。推送 tag 时 **Relay binaries** 工作流会把各平台文件和 `SHA256SUMS` 附加到 Release。

```sh
htmlroom-relay                                  # 监听 :8080，前面放 HTTPS 反向代理
htmlroom-relay -tls-cert cert.pem -tls-key key.pem -listen :443
htmlroom-relay -tunnel                          # 用 cloudflared 临时隧道得到公网 wss:// 地址
htmlroom-relay -allow-origin https://chat.example.com   # 只允许指定网页（文件打开的 null 始终允许）
```

其他参数：`-max-conns`、`-max-peers`、`-max-frame`、`-rate`。中继不写磁盘、不记录 topic 或 IP。没有 Go 时可用 `scripts/relay-quickstart.sh` 下载预编译文件（强制校验 SHA-256），`--tunnel` 会在缺少 cloudflared 时一并下载官方版本；`--from-source` 用本机 Go 编译。也可以 `docker build -t htmlroom-relay relay/go`。

自己写兼容中继只需满足上表 bc 行：例如 `websocat -t ws-l:127.0.0.1:8080 broadcast:mirror:` 也能工作（它会把帧回显给发送者，客户端会忽略自己的帧）。

### 测试

```sh
node --test test/mesh.test.mjs test/mesh-relays.test.mjs   # 成员协商、帧封装、Nostr/MQTT 编码、真实中继互通
npm run test:mesh                                            # 浏览器：4 个中继、3 名成员、逐个断开中继
```

`test/fixtures/mesh-relays.mjs` 启动本项目 Node 中继、Go 中继、校验签名的 Nostr 中继和 aedes MQTT 代理；有 Go 工具链时才运行 Go 相关用例。

## 在房间文件里自定义中继

配置可带 `"custom": true`（网页生成器和 CLI `room` 默认开启，生成器取消勾选或 CLI 加 `--strict` 则关闭）。开启后文件的 CSP connect-src 为 `wss: ws://localhost:* ws://127.0.0.1:*` 加上列出的中继，进房界面显示「中继服务器」输入框，默认填文件里的中继。改填的地址只用于本次打开（不存储、不改文件），经 `relayList` 校验后决定 version 2（经典）或 3（去中心化）；密钥、口令和 roomId 不变。网页链接入口不显示该输入框，因为网页 CSP 只能连站点预设的中继。

`retarget` 和转换器默认保留原文件的设置；CLI `retarget` 可加 `--custom` 或 `--strict` 改变，网页转换器用「允许在新文件里自定义中继」勾选框。

## 更换中继（迁移到自建中继）

`relays` 只是公开路由配置：roomId 由主密钥派生，口令包装的 AAD 只绑定 roomId，二者都不含中继地址。因此同一房间可以搬到任何兼容中继（本项目的 Node/Docker 或 Cloudflare 中继），新中继无需任何房间预配置——文件以 `Origin: null` 连接，中继默认放行。

经典中继和去中心化中继之间也可以互相转换（version 2 ↔ 3），密钥材料和 roomId 不变。三种方式，结果逐字节相同，都能通过 `verify-room-file.mjs`：

- **房间文件内**：打开 `index.html`，展开「换一个中继服务器」，填写新中继（如 `wss://relay.example.com`，可在后面保留旧中继作备用），点击「生成新文件」并下载。无需口令。
- **网页生成器**：在「已经有房间文件？换一个中继服务器」中选择旧文件并填写新中继。文件只在浏览器内读取；会用本站模板重建，所以没有该按钮的旧文件也能转换（旧 `version: 1` 文件除外）。
- **命令行**：

```sh
node scripts/build-html-room.mjs retarget \
  --in old/index.html --out new/index.html \
  --relay wss://relay.example.com [--relay wss://backup.example.com]
```

新文件的 CSP `connect-src` 仍只列出精确的新中继源，不使用通配符。注意：所有成员必须改用同一份新文件，连到不同中继的成员互相看不到消息；新中继运营者可看到 roomId 和入房凭证（可借此占用旧中继名额），但拿不到主密钥、无法解密；切换后重新核对安全码。浏览器要求 WSS 证书有效，用裸 IP 时需要为该 IP 签发的证书，使用域名配合一键安装脚本最简单。

## 命令行生成与核验房间文件

```sh
mkdir -p out
node scripts/build-html-room.mjs room \
  --out out/index.html \
  --relay wss://chat.nya.je \
  --allow-relay wss://chat.nya.je
node scripts/verify-room-file.mjs out/index.html
```

使用口令时，设置 `HR_PASSWORD_STDIN=1`，通过标准输入传入口令；不要将口令放进命令行参数。浏览器生成器也提供随机高熵口令按钮。

中继地址必须是精确的 WS/WSS 源，不接受路径、查询参数、Fragment 或用户名密码。远程中继必须使用 WSS；明文 WS 只允许 localhost 或回环地址。

文件核验用于检查配置、CSP 和发布脚本完整性，不能替代可信文件分发，也不能证明收到的整个仓库未被替换。

## 开发与验证

```sh
npm test
npm run build:check
npx playwright install chromium
npm run test:browser
npm run test:pages
npm run test:worker
npx wrangler deploy --dry-run
```

- `npm test`：单元测试和 Node 中继探针；默认跳过需要 workerd 的 Worker 探针。
- `test:browser`：真实文件下载、网页/文件互通、加密消息与确认、口令保护、重连和预览恢复。
- `test:pages`：Pages 项目子路径、默认外部中继、下载文件名和 Fragment 入口。
- `test:worker`：使用本地 workerd 验证 Worker 路由、Origin 校验、鉴权及消息转发。
- `build:check`：检查 `dist/` 是否与源码构建一致；`deploy --dry-run` 只检查 Worker 打包，不发布。

[测试工作流](../.github/workflows/test.yml) 还包含 Windows、macOS、Linux、Chromium 和 Docker 验证。

主要源码目录：`html-room/` 为客户端与生成器，`server/` 为 Node 中继，`src/` 为 Worker 及共享规则，`scripts/` 为构建与核验工具。

## 安全边界

- **文件与链接需要保密。** 无口令文件和链接包含加入能力；口令保护的文件仍可被离线猜测，短 PIN 不能提供可靠保护。
- **网页入口需要信任托管代码。** 网页脚本能读取 Fragment 中的房间配置；它与经过可信渠道核验的独立文件具有不同的信任边界。
- **中继能看到连接信息。** 中继转发聊天密文，但可看到加入凭证、连接时间和流量，也能丢弃消息、拒绝连接或错误报告在线人数。
- **会话状态不持久化。** 关闭页面会丢失该页面的聊天状态；中继重启会丢失服务端内存状态。用户下载的房间文件仍保存在其设备中。
- **加密不替代终端安全。** 网站或整个 HTML 被替换、设备失陷、流量分析和拒绝服务等风险无法由本项目消除。
- **尚未获得独立密码学审计。** 请通过独立渠道核对安全码；CSP、哈希与消息签名都不能替代可信分发和安全审计。

更多说明见 [安全模型](html-room/security-model.md)、[协议](html-room/protocol.md) 和 [验证记录](VALIDATION.md)。

