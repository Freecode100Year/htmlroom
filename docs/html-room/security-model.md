# Security model and boundaries

默认无口令：此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。持有文件的人可加入。可选口令包装无法彻底解决文件泄密；弱 PIN 可被离线暴力猜测，建议高熵密码，并通过独立渠道传递口令。本机尝试节流不能阻止离线猜测。

Master never reaches relay. WebSocket subprotocol access is sensitive bearer authentication visible to relay, reverse proxy, diagnostics and monitoring. Redact the entire Sec-WebSocket-Protocol header (including resume), never log secrets, disable third-party scripts/analytics and error reporting. Access is not an E2EE secret. Valid TLS certificates recommended. A WSS failure may be certificate trust or network/Origin/auth failure; browser API cannot distinguish. Visiting HTTPS may help inspect trust but cannot guarantee WSS works in every browser; never disable certificate verification.

Memory-only identities/messages/queues, no cookies/localStorage/IndexedDB, random session deviceId. Files saved by users necessarily persist master/wrapped master. Injectable storage adapter must be explicit and must not silently persist identities.

Meta CSP: default-src none; exact executable-script/style hashes, exact relay connect-src (except custom-relay files, below), no broad schemes, no blob images, no inline style attributes. Meta cannot enforce frame-ancestors, and cannot defend a replaced/tampered entire HTML. Verify file/script hashes through an independent trusted channel. JSON config is intentionally mutable per room and not executable.

Optional #hr1= entry can expose master to the hosting page's code; it is not equivalent to a verified offline file. No third-party code. Relay can deny, reorder, drop and misrepresent presence; safety code verification via independent channel matters. Shared master holders can introduce their own identities. No claim of anonymity against traffic analysis, protection on compromised devices, or independently audited ML-KEM.

Local file scripts/WebCrypto/WSS vary in iOS and WeChat/QQ previews. Real-device testing is mandatory before compatibility claims. Absent hardware must be marked unverified. Remote relay is still necessary.

## 网站与离线创建器

网站就是一个空白房间文件，与离线文件运行同一份按 SHA-256 固定的脚本和样式；服务器的 HTTP CSP 也固定这两个哈希，不加载任何外部资源。网页可读取 `#hr1=`，读取后清除地址栏，并可连接链接中的任意 wss 中继（CSP `wss:`）：被诱导打开攻击者构造的链接，等同于进入攻击者的房间，攻击者中继仍拿不到其他房间的密钥。新文件只在页面内由已运行的脚本字节和新配置拼出，下载使用内存 Blob URL；生成过程不联网。托管网页的安全性仍依赖站点提供的代码，与经独立渠道核验的离线文件不等同；离线创建器可用 `verify-room-file.mjs` 核验。对整个网页或 HTML 的替换仍无法由其自身 CSP 防御。

## 多中继可达性与分裂风险（V2）

1–3 个中继按同一有序列表切换，并每 60 秒探测首选，目的是帮助同配置成员汇合，不是跨服务器同步。中继没有共享房间状态和消息存储。各成员的网络、Origin 放行、限流或证书状态不同时可能连接不同中继，彼此看不到；后台页面定时器节流和网络分区可能让分裂持续。页面的在线人数仅为当前中继报告，不能代表全体成员，恶意中继仍可伪造人数。恢复首选不保证所有成员同时切回。

本版复用同一主密钥派生的 roomId/access，而不是中继域分离。因此多个中继运营者可关联房间和入房凭证；access 是入房 bearer，不是消息解密密钥。首选探测也会向首选提交 access，短暂占用成员位置，泄露探测时间和该房间的活跃情况。没有未解锁探测，不向不在清单的中继发送连接或凭证。

跨中继清除旧的 resume、群组密钥状态和编号签名绑定后重新握手，不能把不同中继的同号成员视作同一身份。切换后必须再次用电话或当面核对安全码；无法声称切换前后的身份连续性已经验证。恶意中继可以主动断连迫使切换。未发送的内存队列可在新握手完成后发送；已提交但未确认的消息不自动跨中继重放，需要人工核实，避免重复或在新成员集合中意外重发。

新版文件/链接不兼容 version 1；旧入口不会自动迁移房间。独立文件 CSP 精确列出全部中继源，脚本和样式仍为固定 SHA-256；网页入口只允许构建时预设的精确列表，不会因为链接携带 relays 而扩大信任范围。网页恢复入口若不支持完整列表会拒绝连接；请直接在支持脚本的浏览器中打开房间文件。

## 去中心化中继（V3）

V3 把入房、编号、在线名单和发送者标注从中继移到成员之间。帧密钥由 master 派生，中继看到的只有 topic、IP、时间和帧大小；没有房间文件的人无法产生被接受的帧，因此不能冒充成员或注入消息，只能消耗中继和成员的流量（客户端会丢弃解不开的帧，但仍需下载）。V3 不使用 access 凭证，中继无法也无需鉴权，房间不会因 access 泄露被占座，但任何人都可向已知 topic 灌入垃圾帧。

成员编号是自我声明的：持有房间文件的人可以抢占空闲编号，恶意成员还可以声称更早的认领时间来抢占已有编号，迫使对方重新编号。这不会让他获得别人的签名身份，Group 层仍对每个编号验证签名，编号换主时会先作离开处理再重新验证；但在线名单和编号只代表成员的声明。成员变化后请重新核对安全码。

所有帧同时发往全部中继：可用性取决于至少一个中继可达，不会因中继不同而分裂；但每个中继都能看到全部帧的元数据，中继越多元数据暴露面越大。公共 Nostr 中继和 MQTT 代理由第三方运营，可能记录、限流、拒绝或延迟；Nostr 规范要求不存储 20000–29999 临时事件，但无法验证。Nostr 签名密钥每次会话随机生成，不与任何身份关联；同一会话内的事件可被关联。中继可以选择性丢弃或延迟帧，造成「在线」误判或消息丢失，回执机制会显示未确认。

单文件 Go 中继默认接受任何 Origin（帧已端到端加密），可用 `-allow-origin` 限制网页来源；它不写磁盘、不记录 topic 或地址。`relay-quickstart.sh` 下载的中继强制校验 Release 中的 SHA-256，但该校验和与文件来自同一 Release，不能替代对仓库和 Release 来源的独立核实；cloudflared 由 Cloudflare 官方 Release 提供，临时隧道的流量经过 Cloudflare。

## 文件内自定义中继

默认生成的文件带 `custom: true`，CSP 允许连接任意 `wss:` 源和本机回环 WS，以便持有文件的人改用自己的中继。可执行脚本和样式仍由 SHA-256 固定，页面只连接用户在输入框中填写或文件中列出的中继，主密钥从不发给中继；因此失去的是「文件只能连列出的中继」这层纵深防护。风险主要是社会工程：被诱导填入攻击者中继的成员会把连接元数据（V2 还包括入房 access 凭证，可被用来占座）交给对方，但对方仍无法解密或伪造消息，安全码核对照常有效。不同成员填不同经典中继时彼此看不到消息。需要严格限制时，创建时关闭该选项（CLI `--strict`）。

## 文件即服务器

房间文件开头的 HTML 注释里是中继服务端代码，浏览器不执行；`node index.html` 时由 Node 执行。运行一个文件等于在本机执行其中的代码，请只运行经可信渠道获得或用 `verify-room-file.mjs` 核验过的文件（核验会对整个文件、包括服务端部分，与可复现构建逐字节比对）。浏览器生成的新文件原样携带当前文件的服务端部分，因此被篡改的服务端代码会随之传播，核验能发现这种差异。房间文件运行时不提供网页，避免把含主密钥的文件发给访问者；空白创建器才提供自身。内嵌中继与 Node 中继使用相同的入房、限流和帧规则，默认监听 0.0.0.0，Origin 规则相同（`null`、同源、`--allow-origin`）。

## 定向投递的元数据

密钥帧的 `to` 让中继知道某一帧的密钥包装是给哪些成员号的。中继本来就分配成员号、知道谁在场和每帧的发送者，`to` 只多暴露「谁在给谁补发密钥」这一时序，不涉及任何密钥或内容。去中心化中继看不到成员号，`to` 在加密帧内部，只用于接收方跳过不属于自己的帧。
