# 来源与拆分范围

本项目从公开仓库 https://github.com/Freecode100Year/private-talk 提取。

基线提交：`9fac2c32c8159662eb5f1fcfa9ff33cd3486dd50`（包含 iOS HTML 文件预览恢复修复）。

- `html-room/`：原 HTML Room V1 客户端、生成器与传输配置。
- `lib/`：原 `dist/group.js`、`crypto.js`、`state.js`、`vendor/mlkem.js`，作为明确的源码依赖归入独立项目。
- `scripts/`：原房间构建、核验与 ML-KEM 重建工具。
- `server/`、`src/`：从原 Node/Cloudflare 中继提取 HTML Room 所需的准入、鉴权、限速、断线恢复与密文转发；移除游戏、大厅、图片与旧 /ws/ 入口。
- `test/`、`browser-tests/`：迁移相关验证，补充独立入口边界检查。

客户端加密协议、HKDF 标签、文件 schema、Fragment 格式保持原值。提取后的固定内联脚本 SHA-256 与来源提交相同（详见 `docs/html-room/release-integrity.json`），移动模块路径未改变房间文件的可执行内容。

这是源码提取，使用独立 Git 历史；不导入原仓库的提交历史、生产配置、部署凭证或真实用户房间文件。本仓库是可自行部署的项目，不自动迁移或替换原站点服务。

原项目与本项目采用 MIT 许可证，版权属于其各自贡献者。原密码学模块的第三方声明保留在 `THIRD_PARTY_NOTICES.md` 和源码内。
