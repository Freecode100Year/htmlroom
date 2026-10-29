# Security model and boundaries

默认无口令：此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。持有文件的人可加入。可选口令包装无法彻底解决文件泄密；弱 PIN 可被离线暴力猜测，建议高熵密码，并通过独立渠道传递口令。本机尝试节流不能阻止离线猜测。

Master never reaches relay. WebSocket subprotocol access is sensitive bearer authentication visible to relay, reverse proxy, diagnostics and monitoring. Redact the entire Sec-WebSocket-Protocol header (including resume), never log secrets, disable third-party scripts/analytics and error reporting. Access is not an E2EE secret. Valid TLS certificates recommended. A WSS failure may be certificate trust or network/Origin/auth failure; browser API cannot distinguish. Visiting HTTPS may help inspect trust but cannot guarantee WSS works in every browser; never disable certificate verification.

Memory-only identities/messages/queues, no cookies/localStorage/IndexedDB, random session deviceId. Files saved by users necessarily persist master/wrapped master. Injectable storage adapter must be explicit and must not silently persist identities.

Meta CSP: default-src none; exact executable-script/style hashes, exact relay connect-src, no broad schemes, no blob images, no inline style attributes. Meta cannot enforce frame-ancestors, and cannot defend a replaced/tampered entire HTML. Verify file/script hashes through an independent trusted channel. JSON config is intentionally mutable per room and not executable.

Optional #hr1= entry can expose master to the hosting page's code; it is not equivalent to a verified offline file. No third-party code. Relay can deny, reorder, drop and misrepresent presence; safety code verification via independent channel matters. Shared master holders can introduce their own identities. No claim of anonymity against traffic analysis, protection on compromised devices, or independently audited ML-KEM.

Local file scripts/WebCrypto/WSS vary in iOS and WeChat/QQ previews. Real-device testing is mandatory before compatibility claims. Absent hardware must be marked unverified. Remote relay is still necessary.

## 整合后的网页入口

`/hr.html` 是由服务端提供代码的生成器/入口，安全性依赖该站点代码。只使用本站脚本样式，connect-src self 及构建时明确预设的精确中继源，无第三方分析；网页可读取 `#hr1=`，读取后会清除地址栏。已有会话不因新片段自动切房，须在新窗口打开。网页只为构建白名单完整覆盖的中继列表提供入房；默认仅同源。其他中继组合可生成离线文件，但不提供本站跳转。下载使用内存 Blob URL，仅用于文件下载，离开或重新生成后释放；没有开放 img-src blob。文件仍保持固定脚本/样式 hash CSP，不包含内联 style 属性。对整个网页或 HTML 的替换仍无法由其自身 CSP 防御。

## 多中继可达性与分裂风险（V2）

1–3 个中继按同一有序列表切换，并每 60 秒探测首选，目的是帮助同配置成员汇合，不是跨服务器同步。中继没有共享房间状态和消息存储。各成员的网络、Origin 放行、限流或证书状态不同时可能连接不同中继，彼此看不到；后台页面定时器节流和网络分区可能让分裂持续。页面的在线人数仅为当前中继报告，不能代表全体成员，恶意中继仍可伪造人数。恢复首选不保证所有成员同时切回。

本版复用同一主密钥派生的 roomId/access，而不是中继域分离。因此多个中继运营者可关联房间和入房凭证；access 是入房 bearer，不是消息解密密钥。首选探测也会向首选提交 access，短暂占用成员位置，泄露探测时间和该房间的活跃情况。没有未解锁探测，不向不在清单的中继发送连接或凭证。

跨中继清除旧的 resume、群组密钥状态和编号签名绑定后重新握手，不能把不同中继的同号成员视作同一身份。切换后必须再次用电话或当面核对安全码；无法声称切换前后的身份连续性已经验证。恶意中继可以主动断连迫使切换。未发送的内存队列可在新握手完成后发送；已提交但未确认的消息不自动跨中继重放，需要人工核实，避免重复或在新成员集合中意外重发。

新版文件/链接不兼容 version 1；旧入口不会自动迁移房间。独立文件 CSP 精确列出全部中继源，脚本和样式仍为固定 SHA-256；网页入口只允许构建时预设的精确列表，不会因为链接携带 relays 而扩大信任范围。网页恢复入口若不支持完整列表会拒绝连接；请直接在支持脚本的浏览器中打开房间文件。
