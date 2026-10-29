# HTML Room

**一个不用注册、不用装软件的加密聊天室。** 打开网页点一下，就能建好一个房间，把文件或链接发给朋友，大家打开就能聊天。

[![Tests](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml)
[![GitHub Pages](https://github.com/Freecode100Year/htmlroom/actions/workflows/pages.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

👉 **[马上创建房间](https://freecode100year.github.io/htmlroom/)**　（也可使用 [Vercel 入口](https://htmlroom6.vercel.app/) 或 [备用入口](https://chat.nya.je/)）

---

## 它是什么？

可以把它想象成一个**带锁的临时小房间**：

- 🏠 **房间**：你在网页上点「创建房间」，就得到一个只属于你们的聊天室。
- 🔑 **钥匙**：房间的钥匙就藏在你拿到的**文件**或**链接**里。谁拿到它，谁就能进门。
- 🔒 **上锁的信**：你们发的每句话都会先“锁”起来再送出去。负责传话的服务器只能看到一堆乱码，看不到内容。
- 💨 **说完就散**：本项目不会持久保存聊天记录。关掉网页，这个页面里的聊天内容就没了；对方仍可复制或截图。

## 三步开始聊天

**第 1 步：创建房间**
打开 [房间生成器](https://freecode100year.github.io/htmlroom/)，其他设置都不用改。
如果想多一层保险，可以点「随机生成高熵口令」设个密码（相当于门上再加一把锁）。

**第 2 步：发给朋友**
点「创建房间」后，你可以：

- 下载一个叫 `index.html` 的文件，发给朋友；**或者**
- 复制房间链接，发给朋友。

如果设了密码，**请用另一种方式**把密码告诉朋友（比如链接用微信发，密码打电话说）。

**第 3 步：核对安全码，开始聊天**
大家进入房间后，屏幕上会显示一个**安全码**。请用电话或当面互相念一遍，确认一致，有助于发现密钥被调换；仍需通过这个独立渠道确认对方身份。

> 💡 每点一次「创建房间」都会生成一个**全新的**房间，就算密码一样，也进不了以前的房间。

## 能做什么，不能做什么

| ✅ 可以 | ❌ 不可以 |
| --- | --- |
| 发文字消息 | 发图片、文件、语音 |
| 一个房间最多 **25 人** | 保存聊天记录 |
| 每条消息最多 **500 字** | 不联网使用（聊天时必须有网） |
| 断网后自动重连 | 找回已关闭页面里的消息 |

创建房间时可按优先级填写 **1–3 个中继**（以逗号或空格分隔）。首选不可用时会尝试备用，并每 60 秒探测首选是否恢复。页面显示当前中继和在线人数；连到不同中继的成员暂时无法互通，切换后请重新核对安全码。所有成员须使用同一份房间配置。

多中继配置使用新版房间格式，旧文件/链接需重新生成。网页房间链接只支持站点预先允许的中继，其他组合请使用下载的房间文件。配置静态网页的多个中继见 [开发说明](docs/DEVELOPER.md#多中继房间)。

## 常见问题

**微信 / QQ / iPhone 里点开文件没反应怎么办？**
这些 App 的“预览”功能经常无法运行聊天室。请**复制房间链接**，粘贴到 Safari、Chrome 等浏览器的地址栏里打开。
（目前还没有在 iPhone、安卓手机、微信、QQ 上做过完整的实机测试。）

**这个文件 / 链接可以随便转发吗？**
**不可以。** 文件和链接就是房间钥匙，转给谁，谁就能进来。请只发给要聊天的人。

**设了密码就绝对安全了吗？**
密码越长越乱越好。像 `1234` 这样的短密码，别人拿到文件后可以慢慢猜出来，所以建议使用「随机生成」的密码。

**服务器能看到什么？**
看不到聊天内容。但它能知道「有人在某个时间连进了某个房间」以及传了多少数据，也可能因为故障导致消息发不出去。

**需要注意什么？**

- 如果你的手机或电脑本身中了病毒，任何加密都保护不了你。
- 本项目还没有经过第三方专业机构的安全审计。
- 想要更放心，就一定要**核对安全码**。

## 部署自己的聊天室

### Cloudflare：前端和中继一起部署（推荐）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FFreecode100Year%2Fhtmlroom)

登录 Cloudflare，按页面提示创建仓库并部署。前端和 Durable Objects 中继在同一个 Worker 上，部署后打开分配的 `workers.dev` 地址即可创建房间，无需另配 Origin。

仓库须公开。实测按钮可跳转至 Cloudflare 控制台，但当前测试环境被其验证页拦截（403），账户授权及 `JOIN_LIMIT` 绑定兼容性尚未完成线上验证；如果页面不支持该绑定，请在创建的仓库中移除 `wrangler.jsonc` 的 `ratelimits` 项后重新部署。代码已支持缺少该绑定时跳过加入限流，房间人数和消息大小限制仍生效。详见 [Cloudflare 部署说明](docs/DEVELOPER.md#cloudflare-workers)。

### Linux 服务器：一条命令安装

需要 Ubuntu/Debian、root 或 sudo 权限，以及一个**已解析到服务器的域名**。请开放 TCP 80/443，并确保没有其他程序占用这两个端口。

```sh
curl -fsSL https://raw.githubusercontent.com/Freecode100Year/htmlroom/main/install.sh | sudo bash
```

按提示输入域名，脚本会安装所需工具、检查或安装 Docker、拉取代码，再通过 Caddy 自动申请 HTTPS 证书并启动前端和中继。默认安装到 `/opt/htmlroom`，已有目录会拒绝覆盖。root 用户可将 `sudo bash` 换成 `bash`。

非交互安装、预检、更新和卸载见 [服务器一键安装](docs/DEVELOPER.md#服务器一键安装ubuntudebian)。

### Vercel：仅部署前端

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FFreecode100Year%2Fhtmlroom&env=HR_PAGES_RELAY&envDescription=WebSocket%20relay%20origin%20such%20as%20wss%3A%2F%2Frelay.example.com&envLink=https%3A%2F%2Fgithub.com%2FFreecode100Year%2Fhtmlroom%2Fblob%2Fmain%2Fdocs%2FDEVELOPER.md)

部署时填写 `HR_PAGES_RELAY`（例如 `wss://你的中继域名`）。这不会部署聊天中继；请先准备 Cloudflare 或 Node 中继，并在中继的 `HR_ALLOWED_ORIGINS` 中加入 Vercel 网站的精确 HTTPS 来源。使用 `chat.nya.je` 也需要其运营者放行你的域名，不能保证复制前端后就能连接。详见 [Vercel 部署说明](docs/DEVELOPER.md#部署前端到-vercel)。

### 部署支持与验证结果

已提供 Cloudflare 完整部署入口、Vercel 静态前端配置，以及 Ubuntu/Debian 的 Docker + Caddy 一键安装脚本。安装脚本支持 `--check` 预检、拒绝覆盖已有目录，并校验本机及公网 HTTPS 返回的应用资源。

本地验证：38 项项目测试通过（默认跳过的 9 项 Worker 探针另行运行，全部通过），静态前端、网页/文件互通及双中继故障切换浏览器测试、构建检查和 Worker 打包检查通过。Docker 镜像构建与 Compose/Caddy 配置也已在部署功能加入时通过检查。这些检查不代表已完成公网服务器安装或云端部署；Cloudflare 按钮的登录后绑定兼容性仍待验证。

## 给开发者

想在自己电脑上运行、搭建自己的服务器，或者了解技术细节？请看：

- [开发与部署说明](docs/DEVELOPER.md)：本地运行、GitHub Pages、Node.js / Docker / Cloudflare Workers 中继、测试命令
- [安全模型](docs/html-room/security-model.md) · [协议说明](docs/html-room/protocol.md) · [验证记录](docs/VALIDATION.md)

快速体验（需要 Node.js 22 或更高版本）：

```sh
git clone https://github.com/Freecode100Year/htmlroom.git
cd htmlroom
npm ci
npm start
```

然后在浏览器打开 <http://localhost:8080/>。

## 来源与许可证

本项目从 [private-talk](https://github.com/Freecode100Year/private-talk) 中独立出来，详见 [来源说明](docs/PROVENANCE.md)。

采用 [MIT 许可证](LICENSE)，保留原作者版权及 [第三方声明](THIRD_PARTY_NOTICES.md)。
