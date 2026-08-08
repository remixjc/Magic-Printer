# Magic Printer 实施路线图与验收计划

- 文档版本：1.0
- 基准日期：2026-08-07
- 估算口径：2 名全职开发（桌面/后端、前端）+ 兼职测试/产品；未包含等待厂商 SDK、证书审核和打印机采购时间。

## 1. 总体建议

建议采用“先验证最大风险，再完善产品体验”的顺序。可用 MVP 预计 10–14 周；达到三端正式发布质量预计 16–22 周。若只有 1 名开发者，周期通常需要按 1.6–2 倍估算。

## 2. 阶段计划

### P0：需求冻结与技术预研（第 1–2 周）

交付物：

- 确认局域网/公网边界、支持系统、打印参数和文件限制。
- 获取 E-safe 版本、官方接口、授权方式和测试样本。
- 在三端完成打印机枚举与测试 PDF 打印原型。
- 验证 LibreOffice 对 DOCX/XLSX 的转换、并发、超时和字体表现。
- 确认 Windows 签名证书与 Apple Developer 账号采购。

退出条件：

- 至少 Windows/macOS/Linux 各有一个测试打印路径可行。
- E-safe 有明确的“可接入接口”或形成书面降级范围。
- 对首期支持格式和系统版本完成冻结。

### P1：工程骨架与基础桌面能力（第 3–4 周）

交付物：

- pnpm monorepo、TypeScript、lint、format、test、提交规范。
- Electron 主进程、preload、设置窗口和托盘菜单。
- Fastify 健康检查、本地端口管理和 SQLite 迁移。
- 打印机枚举、选择和配置持久化。
- 自动/深色/浅色主题框架。
- CI 基础检查。

退出条件：

- 三端开发包能启动并驻留托盘。
- 设置页能选择打印机；WEB 健康页能读到当前设备摘要。

### P2：上传、预览和打印主链路（第 5–8 周）

交付物：

- 安全上传、格式识别、任务状态机和 SSE。
- 图片/PDF 预览和统一 PDF 管线。
- LibreOffice 检测、安装引导、DOC/DOCX/XLS/XLSX 转换。
- 打印参数表单、能力协商、打印队列和错误处理。
- 打印记录、手动删除和七天清理。

退出条件：

- 四类文件在支持环境中完成上传 → 预览 → 打印闭环。
- 崩溃恢复不会重复打印。
- 缺少 LibreOffice 时能按需求降级。

### P3：E-safe 与局域网安全（第 9–11 周）

交付物：

- E-safe detector 接口和厂商适配实现。
- 加密/疑似/不可用的阻断和提示流程。
- LAN 开关、配对/口令、会话、CSRF/Host/Origin 校验和限流。
- 设置页服务状态、访问地址与诊断信息。

退出条件：

- 官方样本集的检测结果达到厂商接口能力范围内的预期。
- 未授权 LAN 客户端无法上传、预览、打印或读取记录。

### P4：系统集成与发布能力（第 12–14 周）

交付物：

- 三端开机启动。
- 日志、诊断包、临时文件回收。
- electron-builder 三端配置。
- GitHub Actions 构建、签名、公证、校验和和 Draft Release。
- electron-updater 检查、下载、重启更新和失败处理。
- GitHub Pages 项目介绍页、下载入口、许可与隐私说明。

退出条件：

- 标签可生成三端 Release 产物。
- 上一稳定版本可升级到当前版本且记录不丢失。
- Pages 能由 `main` 分支自动部署，并在 Release 后展示最新稳定版下载入口。

### P5：兼容性、性能与正式发布（第 15–22 周）

交付物：

- 真机/真打印机矩阵回归。
- 安全测试、资源和大文件压力测试。
- 安装/升级/卸载测试。
- 用户手册、故障排除、隐私说明和发布清单。
- RC 灰度和正式版。

退出条件：

- 产品需求文档中的验收标准全部通过，或例外项有签字确认。
- Windows/macOS 安装包完成有效签名，macOS 完成公证。
- 没有阻断级或高危未处理问题。

## 3. MVP 与正式版边界

### MVP

- 三端启动、托盘、设置和单打印机选择。
- 本机 WEB 访问。
- 图片/PDF/DOCX/XLSX 上传、预览和基础打印参数。
- 本地记录与七天清理。
- E-safe 适配接口，可使用模拟器验证流程。

### 正式版 1.0

- 官方 E-safe 集成或经需求方确认的限制说明。
- 安全的局域网模式。
- 三端签名安装包、自动启动、更新与 Release 自动化。
- 真机矩阵、诊断能力、完整错误体验和安全加固。

## 4. 工作分解

| Epic | 主要任务 | 建议负责人 |
|---|---|---|
| Desktop Shell | 生命周期、托盘、窗口、IPC、开机启动、更新 | 桌面/后端 |
| Print Platform | 枚举、能力、队列、平台打印、取消 | 桌面/后端 |
| File Pipeline | 上传、检测、转换、预览、清理 | 桌面/后端 |
| WEB UX | 上传、预览、参数、状态、记录、主题 | 前端 |
| Security | LAN 鉴权、限流、文件安全、Electron 加固 | 共同负责 |
| Release | CI、签名、公证、安装包、Release | 桌面/DevOps |
| QA | 自动化、系统矩阵、打印机矩阵、回归 | QA/共同负责 |

## 5. 发布门禁

每个候选版本必须满足：

- lint、typecheck、unit、integration、E2E 全部通过。
- 安装包校验和与 SBOM 已生成。
- 无已知高危依赖漏洞，或有正式风险接受记录。
- 三个平台完成安装、首次启动、打印、升级和卸载烟雾测试。
- 临时文件、七天记录和日志清理验证通过。
- 真实打印机至少各完成一份图片、PDF、Word、Excel 打印。
- E-safe 加密样本被阻断且普通样本不被误阻断到不可接受程度。

## 6. 首批应创建的 GitHub Issues

1. `spike: validate printer discovery and PDF printing on three OSes`
2. `spike: obtain and validate E-safe detection interface`
3. `spike: LibreOffice conversion and isolation`
4. `chore: bootstrap pnpm Electron monorepo`
5. `feat: tray lifecycle and settings window`
6. `feat: printer selection and capability API`
7. `feat: secure upload and print job state machine`
8. `feat: PDF/image preview`
9. `feat: Office conversion and preview fallback`
10. `feat: local history and seven-day retention`
11. `feat: authenticated LAN access`
12. `ci: multi-platform build and draft release`
13. `feat: application auto-update`
14. `test: real printer and OS compatibility matrix`

## 7. 项目启动前输入清单

- 亿赛通技术联系人、接口文档、三端客户端和样本。
- Windows 代码签名证书；Apple Developer Team 与公证凭据。
- 至少两类真实打印机，包含 USB/网络、单双面或彩色能力差异。
- UI 品牌名称、图标、版权信息、许可证选择。
- 局域网访问的用户规模、网络环境和安全责任边界。
- 支持系统的最终版本列表及 Linux 发行版优先级。
