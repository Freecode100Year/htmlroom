# HTML Room

**一个不用注册、不用装软件的加密聊天室。** 打开网页点一下，就能建好一个房间，把文件或链接发给朋友，大家打开就能聊天。

[![Tests](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/test.yml)
[![GitHub Pages](https://github.com/Freecode100Year/htmlroom/actions/workflows/pages.yml/badge.svg)](https://github.com/Freecode100Year/htmlroom/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

👉 **[马上创建房间](https://freecode100year.github.io/htmlroom/)**　（打不开时可用 [备用入口](https://chat.nya.je/)）

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
