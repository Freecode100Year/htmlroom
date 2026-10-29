# ECH 与域名隐私

ECH（Encrypted Client Hello）加密 TLS 握手中的内部 ClientHello，包括真实网站名（SNI）。它可以减少网络中间人直接按域名识别连接的机会，但不能保证绕过封锁。协议定义见 [IETF RFC 9849](https://www.rfc-editor.org/rfc/rfc9849.html)。

## 在 Cloudflare 上确认或开启

对于自己托管在 Cloudflare 的域名，在控制台选择该域名，进入 **SSL/TLS → Edge Certificates → Encrypted ClientHello (ECH)** 检查开关。官方说明 Free zone 默认启用，其他套餐可以在这里启用或关闭。不要把这个域名设置直接当成 `workers.dev` 的设置；默认 Worker 地址是否支持 ECH **需验证**，本仓库没有账号级开关，也不能替 Cloudflare 开启。参见 [Cloudflare ECH 文档](https://developers.cloudflare.com/ssl/edge-certificates/ech/)。

## 验证浏览器与自己的网址

1. 使用支持 ECH 的最新浏览器，按[Cloudflare 官方浏览器 DoH 指南](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/encrypted-dns-browsers/)开启安全 DNS，例如选择 Cloudflare。可以访问 [1.1.1.1/help](https://1.1.1.1/help)检查解析器连接；它不能单独证明 ECH 生效，参见[官方连接检查说明](https://developers.cloudflare.com/1.1.1.1/check/)。
2. 打开 [Cloudflare Browser Security Check](https://www.cloudflare.com/ssl/encrypted-sni/)，运行检测并查看 Secure SNI / ECH 结果。Mozilla 官方也推荐这个检测入口，见 [Firefox ECH FAQ](https://support.mozilla.org/en-US/kb/faq-encrypted-client-hello)。页面若只显示旧 ESNI 字样或无法运行，应标记 **需验证**，不要把 DNS 检查通过当成 ECH 通过。
3. 检测页只验证它自己的连接；自己的聊天室域名仍**需验证**。重新访问目标地址，核实浏览器实际协商接受了 ECH，必要时使用支持 ECH 解码的抓包工具并结合服务端握手诊断。只看到 `encrypted_client_hello` 扩展不够，它也可能是 GREASE；判定依据见 [RFC 9849 §6.1.4 与 §6.2](https://www.rfc-editor.org/rfc/rfc9849.html#section-6.1.4)。本步没有进行真实用户网络或生产域名抓包。

## ECH 不能隐藏什么

- 目的 IP 仍可见，网络仍能识别连接到 Cloudflare；其外层 SNI 通常是共享的 `cloudflare-ech.com`。Cloudflare 本身可以解密内部握手。参见 [Cloudflare 工作原理](https://developers.cloudflare.com/ssl/edge-certificates/ech/#how-ech-works)。
- 连接时间、流量大小和方向仍可被观察，仍有流量分析风险；ECH 不是流量填充或匿名网络，参见 [RFC 9849 §10.7 Related Privacy Leaks](https://www.rfc-editor.org/rfc/rfc9849.html#section-10.7)。
- 明文 DNS 仍可能泄漏域名，所以应配合加密 DNS；ECH 也不隐藏终端、网站或中继自己能看到的信息。参见 [RFC 9849 §10.2](https://www.rfc-editor.org/rfc/rfc9849.html#section-10.2)。聊天内容的端到端加密边界另外见[安全模型](html-room/security-model.md)。
- 网络可以阻断 ECH 配置获取或连接本身；浏览器和网络策略会影响结果，不能承诺在所有地区可用。参见 [Cloudflare 网络适用性说明](https://developers.cloudflare.com/ssl/edge-certificates/ech/#enterprise-network-applicability)。

以上官方页面核对日期：2026-10-29。控制台界面和浏览器行为可能变化，未实测的部署域名一律视为需验证。
