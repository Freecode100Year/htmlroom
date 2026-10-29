# 独立提取验证

来源：private-talk `9fac2c32c8159662eb5f1fcfa9ff33cd3486dd50`。
本地环境：Node.js 24.20.0、Playwright 1.64.1、Chromium 156.0.8078.4；Docker 使用 Node.js 22 Alpine。

## 本地结果

- `npm test`：35 项，27 通过，8 项 Worker 探针按设计跳过，失败 0。
- `npm run test:worker`：真实本地 workerd 8/8 通过，无跳过。
- `npm run test:browser`：文件聊天 11 项、网页/文件互通 9 项通过；禁用脚本、CSP 拦截、同房间恢复与正常启动回归通过。
- `npm run build:check`：通过；固定房间脚本与来源提交哈希相同。
- `npx wrangler deploy --dry-run`：构建通过，没有向 Cloudflare 发布。
- Docker：镜像构建通过；以非 root、只读根文件系统、移除 capabilities 的容器运行共享 HTTP/WebSocket 探针，8/8 通过。
- 公开边界：仅房间静态资源可读取，`.env`、`config.env`、package.json、lib 源码不通过 HTTP 开放；旧 `/ws/`、大厅与游戏入口不提供。
- 独立代码审查未发现其他重要的提取回归或公开发布阻塞问题。

补充验证曾发现 Worker 默认 HTML 路径规范化导致 `/hr.html` 跳转后 404，现通过 `assets.html_handling: "none"` 固定字面路径；相关静态入口回归现已通过。依据：[Cloudflare HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)。

Docker 本地构建曾继承源文件的严格权限，使非 root 用户无法读取服务文件；现使用 `COPY --chown=node:node`，只读容器全套探针通过。

首次远端 CI 的 Windows 静态入口检查发现响应头解析不接受 CRLF 换行，导致安全头缺失；现拆出解析函数并增加 LF/CRLF 回归，同时保留来源项目的 `.gitattributes`，固定各平台检出的 LF 换行，确保 CSP 哈希和构建资源一致。最终远端结果以 Actions 中最新提交为准。

## 未验证

没有真实 iPhone、Android、微信或 QQ 设备，因此不宣称这些文件预览环境可直接执行脚本。已模拟禁用脚本和 CSP 拒绝启动，并验证静态网页恢复入口。

本次只创建公开源码仓库，不部署新站点，也不迁移原服务。远端 CI 结果以仓库 Actions 为准，不能用本地结果代替未完成的远端检查。
