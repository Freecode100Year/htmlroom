# HTML Room

**在浏览器中创建房间，下载一个 `index.html`，用文件或链接进入同一个加密文字聊天室。**

[![Tests](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml)
[![GitHub Pages](https://github.com/Freecode100Year/htmlroom/actions/workflows/pages.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[打开房间生成器](https://freecode100year.github.io/htmlroom/) · [备用网页入口](https://chat.nya.je/) · [安全模型](docs/html-room/security-model.md) · [协议说明](docs/html-room/protocol.md)

## 开始聊天

1. 打开 [GitHub Pages 生成器](https://freecode100year.github.io/htmlroom/)。默认中继为 `wss://chat.nya.je`，无需修改。
2. 按需设置打开口令。建议点击“随机生成高熵口令”，并通过独立渠道传递口令。
3. 点击“创建房间”，下载 `index.html`，或复制生成的房间链接。
4. 将**同一份文件或同一个房间链接**交给其他成员，打开后进入房间。
5. 通过独立渠道核对安全码，再开始聊天。

重新点击“创建房间”会生成新房间，即使使用相同口令和中继地址，也不会进入之前的房间。

文件包含运行聊天室所需的客户端代码，但**实际聊天仍需联网并连接中继**。无口令文件及无口令房间链接包含加入房间的能力，请谨慎分发；口令保护也不能阻止对弱口令的离线猜测。

## 功能与范围

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

## 手机、微信和 QQ

iOS「文件」、微信或 QQ 的文件预览可能不执行 JavaScript。若下载文件无法操作，请复制房间链接到 Safari、Chrome 等浏览器地址栏打开。

下载文件在脚本成功启动并验证配置前，会禁用输入和进入按钮，并显示静态打开说明及备用链接。WebCrypto 或 WebSocket 不可用时，页面会提示更换浏览器。

已通过 Chromium 验证禁用脚本、CSP 拦截和网页恢复场景；**尚未完成 iPhone、Android、微信或 QQ 真机兼容性验证**。

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

仓库中的 [Pages 工作流](.github/workflows/pages.yml) 在 `main` 更新时自动构建并发布，也可手动触发。自行部署时，在仓库 **Settings → Pages → Source** 中选择 **GitHub Actions**。

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

```sh
npm ci
npx wrangler login
npm run deploy
```

使用本项目的 [wrangler.jsonc](wrangler.jsonc)，发布前检查 Worker 名称和目标账户。配置会创建 `Room` Durable Object 命名空间，使用 WebSocket Hibernation API 及自动心跳响应。

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

[测试工作流](.github/workflows/test.yml) 还包含 Windows、macOS、Linux、Chromium 和 Docker 验证。

主要源码目录：`html-room/` 为客户端与生成器，`server/` 为 Node 中继，`src/` 为 Worker 及共享规则，`scripts/` 为构建与核验工具。

## 安全边界

- **文件与链接需要保密。** 无口令文件和链接包含加入能力；口令保护的文件仍可被离线猜测，短 PIN 不能提供可靠保护。
- **网页入口需要信任托管代码。** 网页脚本能读取 Fragment 中的房间配置；它与经过可信渠道核验的独立文件具有不同的信任边界。
- **中继能看到连接信息。** 中继转发聊天密文，但可看到加入凭证、连接时间和流量，也能丢弃消息、拒绝连接或错误报告在线人数。
- **会话状态不持久化。** 关闭页面会丢失该页面的聊天状态；中继重启会丢失服务端内存状态。用户下载的房间文件仍保存在其设备中。
- **加密不替代终端安全。** 网站或整个 HTML 被替换、设备失陷、流量分析和拒绝服务等风险无法由本项目消除。
- **尚未获得独立密码学审计。** 请通过独立渠道核对安全码；CSP、哈希与消息签名都不能替代可信分发和安全审计。

更多说明见 [安全模型](docs/html-room/security-model.md)、[协议](docs/html-room/protocol.md) 和 [验证记录](docs/VALIDATION.md)。

## 来源与许可证

本项目从 [private-talk](https://github.com/Freecode100Year/private-talk) 提取，保留 HTML Room 的文件格式、密码学域分离字符串和协议，使用独立的运行与部署配置。详见 [来源说明](docs/PROVENANCE.md)。

采用 [MIT 许可证](LICENSE)，保留原作者版权及 [第三方声明](THIRD_PARTY_NOTICES.md)。
