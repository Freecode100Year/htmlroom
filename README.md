# HTML Room

[![test](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml)

独立的 HTML 文件加密聊天室。一个房间对应一份可下载的 HTML 文件，也可以通过网页链接进入同一房间；支持可选打开口令、消息签名、混合密钥交换、自动重连和消息确认。只提供文字聊天，最多 25 人，每条最多 500 字。

Standalone encrypted HTML chat rooms, extracted from [private-talk](https://github.com/Freecode100Year/private-talk). Includes a browser generator, portable room files, a Node.js relay and a Cloudflare Worker relay. MIT licensed.

## 快速运行

需要 Node.js 22 或更高版本。

```sh
git clone https://github.com/Freecode100Year/htmlroom.git
cd htmlroom
npm ci
npm start
```

打开 <http://localhost:8080/>（会跳转到 `/hr.html`），创建房间并下载文件。相同文件或相同房间链接中的成员进入同一房间。房间文件可以离线生成，但实际聊天需要在线中继。

`dist/` 已包含构建资源；修改客户端后运行 `npm run build`。项目运行、测试、构建均不依赖原仓库。

## 手机与 iOS

iOS「文件」、微信和 QQ 的文件预览可能不执行 JavaScript。遇到预览无法操作时，复制生成器提供的“房间链接”到 Safari 等浏览器地址栏中打开。

文件默认禁用密码输入和进入按钮，直到脚本成功启动并验证配置。脚本未运行时会显示静态说明和进入同一房间的备用链接，不会一直停留在“正在自检”。备用网页入口需要中继站点提供 `/hr.html`。

已用 Chromium 验证禁用脚本和 CSP 拦截场景；**尚无 iPhone、微信或 QQ 真机兼容性结论**。网页入口代码可以读取 Fragment，安全性依赖该网站提供的代码。

## 生成与核验独立文件

```sh
mkdir -p out
node scripts/build-html-room.mjs room \
  --out out/room.html \
  --relay wss://relay.example \
  --allow-relay wss://relay.example
node scripts/verify-room-file.mjs out/room.html
```

将示例地址替换为自己的中继。使用口令时，设置 `HR_PASSWORD_STDIN=1` 并通过标准输入提供口令；不要把口令放进命令行参数。浏览器生成器可直接随机生成高熵口令。

生成器只接受精确的 WS/WSS 源，不接受路径、查询参数、Fragment 或用户名密码。远程中继必须用 WSS，明文 WS 仅限 localhost/回环地址。网页入口与中继均使用站点根路径，不支持 `ENTRY_PATH`。

## 部署

### Node.js

```sh
HOST=127.0.0.1 PORT=8080 TRUST_PROXY=1 npm start
```

仅在位于可信反向代理之后时设置 `TRUST_PROXY=1`。将域名通过 HTTPS 反向代理到该端口，例如 Caddy：

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

代理与监控必须对整个 `Sec-WebSocket-Protocol` 请求头脱敏（其中包含 access/resume），不要启用记录凭证或房间链接的日志。使用有效 TLS 证书，不要关闭证书校验。Node 也支持通过 `TLS_CERT`、`TLS_KEY` 直接提供 HTTPS。

可设置 `JOIN_LIMIT`、`MAX_CONNECTIONS` 限制连接，`GET /healthz` 用于健康检查。中继仅接受 `/hr/<roomId>`，不提供原项目的 `/ws/`、`/lobby`、桌游或图片功能。

### Docker

```sh
docker compose up -d --build
```

默认仅绑定本机 `127.0.0.1:8080`，仍需前置 HTTPS 代理。代码与配置随本仓库一起构建，无需拉取 private-talk。

### Cloudflare Workers

```sh
npm ci
npx wrangler login
npm run deploy
```

使用本仓库的 `wrangler.jsonc`，会创建名为 `htmlroom` 的 Worker 及其独立的 `Room` Durable Object 命名空间，不要改用原项目的部署配置。请自行检查 Worker 名称和目标账户。发布到 GitHub 不会自动部署到 Cloudflare。

## 测试

```sh
npm test
npm run build:check
npx playwright install chromium
npm run test:browser
npm run test:worker
npx wrangler deploy --dry-run
```

`npm test` 默认跳过 8 项需要 workerd 的探针；`npm run test:worker` 单独执行它们。浏览器测试覆盖实际文件下载、网页/文件互通、双向签名消息与确认、口令保护、预览恢复、重连与 TLS 拒绝。CI 包含三平台单元测试、Chromium、Worker 本地运行和 Docker 检查，不包含原项目耗时的桌游测试。

## 安全边界

- 无口令文件包含完整房间加入能力；文件持有人可加入。口令文件仍可被离线猜测，建议随机高熵口令并通过独立渠道传递。
- 聊天密钥、身份、队列和消息保存在页面内存，不使用 Cookie、localStorage 或 IndexedDB。服务端转发密文，不保存聊天记录；服务重启会丢失内存状态。
- 使用 AES-GCM、HKDF、ECDH P-256、ECDSA P-256 和 ML-KEM-768 混合密钥交换。请通过独立渠道核对安全码；本项目未获独立密码学审计。
- 网站或整个 HTML 被替换、终端失陷、流量分析、拒绝服务等不在本项目能消除的风险范围内。CSP 与文件核验不能替代可信分发。
- 保留原文件格式和密码学域分离字符串，确保提取不改变现有密钥派生与协议。独立中继保存自己的房间状态；相同房间配置只有连接到同一个中继时才会相遇。

详见 [安全模型](docs/html-room/security-model.md)、[协议](docs/html-room/protocol.md)、[来源说明](docs/PROVENANCE.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 许可证

[MIT](LICENSE)。来源与第三方许可证随源码保留。
