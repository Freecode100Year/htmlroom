# HTML Room V2 房间配置与冻结密码协议

Master: CSPRNG 32 bytes. HKDF-SHA-256 salt = 32 zero bytes, info = UTF-8 `private-talk/html-room/v1/access`, `/key`, `/bind` (full prefix for each), output = 32 bytes each. No integers or byte-order conversions. Master and binary fields use canonical lowercase hex in config. access header = `pt2, a<access hex>`; optional resume is memory-only. roomId = lowercase hex SHA-256 of raw access bytes. Byte-level public test vector: hkdf-vector.json (00..1f is a published vector, never a production room).

Announcement key: AES-256-GCM imported from key output. Random 12-byte IV, AAD UTF-8 `private-talk/html-room/v1/keys|<roomId>`, pad/unpad from existing crypto.js. Only announcements use this key. Validate kind, from, random 8-byte ID, +/-10-minute timestamp, duplicate ID, v32 and signature. Reject identity changes until a new session. Existing Group v3.2 is reused unchanged. Ordinary text and kind=seen receipts use Group.seal/open and require verified signatures and hybrid readiness. Receipt l entries identify [sender, chain-header]. Relay echo means submitted, never receiver confirmation.

Dedicated /hr/<roomId> permits pt2 authentication before room admission, Origin exactly null or relay same origin, distinct hr namespace, only ping/key/msg/seen accepted. seen carries v3 h. table/lobby/ref/file/lock/remove discarded. The standalone project does not serve the old /ws path (404). Access is a replayable bearer; stolen access permits admission and resource abuse, but does not derive E2EE keys. Message chain counters and bounded announcement age/ID cache prevent ordinary replay within session; malicious relay can withhold traffic and lie about membership. New session keys prevent old wraps from decrypting.

Config is non-executable application/json, escape < > / U+2028 U+2029. Schema version 2; ordered relays whitelist validates 1–3 distinct exact ws(s) origins before generation (ws allowed only localhost/127.0.0.1/[::1] tests). Secret mode includes master. Wrapped mode includes encrypted=true, salt (16 bytes), iv (12), ciphertext (48), kdf={name:PBKDF2,hash:SHA-256,iterations:310000}, version and relays/roomId only. PBKDF2 uses UTF-8 password without normalization and AES-256-GCM wrapping with AAD UTF-8 `private-talk/html-room/v1/wrap|<roomId>`. Reject other KDF parameters before work. UI password maximum 1024 UTF-8 bytes; one in-flight unlock, local increasing delay. No connection before unlock and roomId verification.

## V2 多中继配置与凭证

Canonical 配置为 `{version:2,relays:[...],roomId,encrypted,...}`。relays 有序、去重，1–3 项；每项由 relayOrigin 规范化并校验。远程仅 WSS；回环 WS 只供开发测试。生成时可规范化尾部斜杠和去重，读取文件时要求列表已经规范化。旧 version 1/relay 配置明确拒绝，需重新生成文件和链接。

本版本选择跨中继复用同一 roomId、access、公告密钥和 bind（上文 HKDF v1 域字符串不变），以保持冻结派生向量和现有中继鉴权。roomId 仍为 SHA-256(access)，master 不发送给中继；仅 access/resume 通过 WebSocket 子协议用于鉴权，不放在查询参数或日志里。这个选择让多个中继可以关联同一房间；未采用按中继域分离，不主张跨中继不可关联。

口令包装格式、310000 轮 PBKDF2 和 wrap AAD 不变。

更换中继：relays 不参与 roomId 派生和 wrap AAD，因此只替换 relays 即得到同一房间的新配置（master 或 salt/iv/ciphertext 原样保留，无需口令）。房间文件读取自身 `currentScript` 与 `<style>` 的精确字节，用与构建脚本共用的 `html-room/template.js` 重新生成整份 HTML，CSP connect-src 仍为新列表的精确源；结果与 `render(newConfig)` 逐字节一致。网页生成器与 CLI `retarget` 读取旧文件配置后用当前模板重建。relays 是公开路由配置，不作为身份保证；不能通过修改此列表获得主密钥，仍需通过可信渠道核验整个房间文件。

## 连接状态与切换

所有客户端从 relays[0] 开始；失败后按 `(index+1) % length` 尝试，使用现有 1–30 秒指数退避，收到合法 hello 后重置退避。10 秒内未收到合法 hello 视为连接失败；活动连接每 25 秒发 ping，65 秒无 pong 即切换，不依赖对端完成 close 握手。单中继的明确拒绝码仍停止会话，多中继允许尝试下一项。

备用连接上每 60 秒发起首选探测；探测也是带 access 的普通入房连接。只有收到合法 hello（成员号 1–25、32 位小写十六进制 resume）才关闭备用并接管，不会同时向两个中继广播聊天消息。失败探测不会断开备用。探测可能短暂占用首选房间成员名额；平台定时器节流会使后台页面探测延迟。

同一中继重连保留内存 resume 和握手状态。跨中继清空 resume、群组/成员编号、签名身份绑定、重放与回执状态，重新建立 Group 混合加密会话；安全码须重新核对。旧 socket 的迟到帧丢弃。保留未发送的明文队列；已经封装或发出的旧链消息不跨中继自动重放，未确认项标注送达状态未知。页面历史仅留在本次内存中，不会复制到备用中继。

## 文件与网页入口

配置放在不可执行 application/json，转义规则不变。文件 script-src/style-src 保持精确 SHA-256；connect-src 列出 relays 的每一个精确源，禁止通配符、宽泛 wss: 或从链接动态扩展 CSP。CLI 的每个 relay 都须由明确 allow-relay 白名单覆盖。

`#hr1=` 仍为 UTF-8 canonical JSON 的无 padding base64url，最大编码 8192 字符、解码 4096 字节；拒绝坏编码、未知字段和旧配置。读取后清除地址栏。网页默认只允许 ownRelay；静态部署可用 HR_PAGES_RELAYS 构建固定白名单，链接中的所有 relays 必须属于该白名单。生成器可以为任意经过校验的精确中继组合生成离线文件，但只有白名单覆盖全部 relays 时提供本站房间链接。

静态预览恢复链接指向首选中继的 /hr.html，并保留完整配置；目标网页若未预设完整中继白名单将拒绝入房，应改用直接打开的验证过的房间文件。没有引入第三方脚本或持久化存储。普通消息和 seen 回执继续使用 Group 签名链。
