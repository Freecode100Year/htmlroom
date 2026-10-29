# HTML Room 独立仓库实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current session.

**Goal:** 从 private-talk 提取可独立使用、测试和部署的 HTML Room，创建 Freecode100Year/htmlroom 公开仓库。

**Architecture:** 沿用 HTML Room V1 客户端和 v3.2 加密协议，保留 Node 与 Cloudflare 中继。移除游戏、大厅、旧 /ws/ 协议入口；共享密码学模块作为本仓库 lib 源码保存。独立生成 dist 资源，原仓库和线上部署不变。

**Tech Stack:** Node.js >=22、原版本 ws/esbuild/Playwright/Wrangler、浏览器 Web Crypto、Cloudflare Durable Objects。

## Global Constraints

- 来源为 private-talk commit 9fac2c32c8159662eb5f1fcfa9ff33cd3486dd50；保留 MIT 及第三方版权。
- 密钥域分离字符串、文件配置、Fragment 和加密协议不变；保留 iOS 预览修复。
- 公开仓库仅包含必要源码、测试、构建资源与文档；不导入原仓库历史、真实房间文件或部署凭证。

## Review Focus

旧 /ws/ 与游戏/大厅路径拒绝；Origin/鉴权先于入房；静态目录不可越界；无脚本预览有同房间恢复入口；生成器和文件聊天双向确认。

## Tasks

- [x] 提取客户端、密码学库、构建脚本及相关测试，执行并记录新中继隔离测试的失败。
- [x] 从现有 Node/Worker 中继剥离桌游、大厅和旧网页聊天入口，独立运行所有单元与集成测试。
- [x] 添加 README、来源说明、MIT 第三方声明、Docker 与 CI；构建一致性、浏览器互通、Worker 本地测试。
- [x] 独立审查、核对公开文件清单，提交并创建公开仓库，验证远端 Public/main 状态；远端 CI 以 Actions 为准。
