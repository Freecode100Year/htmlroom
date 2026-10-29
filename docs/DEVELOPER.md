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

这是首次安装脚本，支持 Docker 官方仓库仍支持的 Ubuntu/Debian 版本，使用 Bash 4+。服务器需要能访问 GitHub、Docker 软件仓库、镜像仓库和证书颁发服务。先将域名 A/AAAA 解析到服务器；如存在 AAAA 记录，也须指向可访问的本机 IPv6。开放 TCP 80/443，停止占用这两个端口的其他服务。

```sh
curl -fsSL https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/install.sh | sudo bash
```

脚本通过 `/dev/tty` 读取域名，适用于管道执行；无终端时可设置环境变量：

```sh
curl -fsSL https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/install.sh \
  | sudo env HR_DOMAIN=chat.example.com HR_INSTALL_DIR=/opt/htmlroom bash
```

也可以先下载审阅并只运行预检（无需 root；只校验域名格式和目标目录，不检查网络或安装软件）：

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/install.sh
HR_DOMAIN=chat.example.com bash install.sh --check
sudo env HR_DOMAIN=chat.example.com bash install.sh
```

默认目录 `/opt/htmlroom` 必须不存在，包括空目录。脚本不会删除或更新已有安装，也不会卸载其他 Docker 软件。已有 Docker 时复用它，但需要支持 `--wait` 的 Compose v2 或更新版本；缺少插件时停止并提示安装，不会替换已有引擎。首次安装无 Docker 时从 Docker 官方 apt 仓库安装。

`compose.production.yaml` 在内部网络运行 Node 中继，只有 Caddy 发布 80/443；Node 启用 `TRUST_PROXY=1`。Caddy 持久卷保存证书，默认不启用 HTTP 访问日志。脚本先等待 Node 健康检查，再分别检查本机 Caddy 和公网域名的 HTTPS 证书，并将返回的 `hr.js` 与本次安装的资源比对，避免域名指向其他网站时误报成功。全部通过后才报告完成。若证书尚未签发或 DNS/端口有误，脚本返回失败并保留容器，修复后可使用下面的命令检查，无需重跑安装脚本。

日常操作：

```sh
cd /opt/htmlroom
sudo docker compose --env-file .env.install -f compose.production.yaml ps
sudo docker compose --env-file .env.install -f compose.production.yaml logs --tail=80 caddy
curl -f https://chat.example.com/
```

更新（会重启中继，在线连接和内存会话会中断）：

```sh
cd /opt/htmlroom
sudo git pull --ff-only
sudo docker compose --env-file .env.install -f compose.production.yaml up -d --build --wait --wait-timeout 90
```

需要额外允许外部前端时，在 `.env.install` 中追加 `HR_ALLOWED_ORIGINS=https://my-room.vercel.app`，再执行上述 Compose `up` 命令。本站前端使用同源中继，无需此设置。仅停止/卸载容器但保留源码和证书：

```sh
cd /opt/htmlroom
sudo docker compose --env-file .env.install -f compose.production.yaml down
```

本次验证不在真实公网服务器上安装系统软件或申请证书。远程安装命令及部署按钮使用 `main` 分支发布的版本。

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

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FFreecode100Year%2Fhtmlroom)

按钮会从公开仓库创建项目，读取 `package.json` 的 `build` / `deploy` 脚本，并按 Wrangler 配置创建 Durable Objects。前端与中继同源，默认不需设置 `HR_ALLOWED_ORIGINS`。参见 [Cloudflare 部署按钮文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

官方按钮资源支持列表列出了 Durable Objects，未明确列出 Rate Limiting。实测按钮正确跳转到 Cloudflare 控制台，但当前浏览器测试环境遇到验证页（HTTP 403），未完成登录账户后的端到端部署。如果按钮报告不支持 `JOIN_LIMIT`，在创建的仓库中删除 `wrangler.jsonc` 的 `ratelimits` 项后重试，或使用下方 CLI 部署。Worker 已使用 `if (env.JOIN_LIMIT)` 检查绑定是否存在；移除后会跳过该层加入速率限制。不要移除 `ROOMS` 或 Durable Objects 迁移。

命令行部署：

```sh
npm ci
npx wrangler login
npm run deploy
```

使用本项目的 [wrangler.jsonc](../wrangler.jsonc)，发布前检查 Worker 名称和目标账户。配置会创建 `Room` Durable Object 命名空间，使用 WebSocket Hibernation API 及自动心跳响应。

需要连接外部静态前端时，在 `vars` 中加入对应 `HR_ALLOWED_ORIGINS`。GitHub Pages 工作流只发布前端，**不会自动部署或更新 Worker、Node 中继**。

中继使用根路径下的 `/hr/<roomId>`，不支持 `ENTRY_PATH`；这不影响 Pages 前端部署在项目子路径。

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

