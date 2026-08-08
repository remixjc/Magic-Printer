# Magic Printer 开发指南

## 当前阶段

当前代码完成了 P1 基础能力和 P2 预览管线的首版：

- Electron 桌面进程与系统托盘。
- Fastify 本地 WEB 服务，默认 `127.0.0.1:17890`。
- SQLite 配置与打印记录存储。
- Electron 打印机枚举和指定设备打印适配器。
- React WEB 上传、打印机选择、基础参数和记录列表。
- PDF 和常见图片的上传 → 准备预览 → 任务 → 打印闭环。
- LibreOffice 检测和 Office 转 PDF 接口；不可用时 API 明确降级。
- LibreOffice 缺失时能力接口会返回对应系统的官方下载地址和建议安装命令，供 WEB 设置页提供安装引导。
- 任务 SSE 事件流和预览 PDF 资源接口。
- 七天记录清理和上传/预览临时文件清理。
- LAN 模式 6 位数字验证码和本地配对入口；配对后使用 24 小时会话令牌。
- WEB 设置区可开启/关闭 LAN 监听，并显示当前可访问的局域网地址。

PDF.js 画布预览、E-safe 官方检测器、CUPS 高级参数映射仍按路线图实现。

## 环境要求

- Node.js 22+
- pnpm 9+
- Electron 能运行的桌面环境
- 至少一台系统已安装的打印机
- Office 预览开发需要 LibreOffice（当前代码尚未接入转换器）

## 安装依赖

```bash
pnpm install
```

如果公司网络无法访问默认 registry，可以按团队规范配置 npm registry；不要把访问令牌提交到仓库。

## 启动开发版

```bash
pnpm dev
```

当前 `dev` 会先构建 WEB 和桌面代码，再启动 Electron。修改代码后需要重新执行命令；接下来会增加 Vite/Electron 热重载。

单独预览 WEB 页面：

```bash
pnpm dev:web
```

## 检查与构建

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 发布流程

Release 工作流通过版本 Tag 触发。建议按以下顺序发布：

1. 更新根目录和桌面端版本号，例如 `0.1.1`。
2. 提交并推送代码到 `main`。
3. 创建并推送 Tag：`git tag v0.1.1 && git push origin v0.1.1`。
4. GitHub Actions 会在 Windows、macOS 和 Linux runner 上分别构建安装包，并发布到 GitHub Releases。
5. Pages 下载区域会自动读取最新 Release；若暂时没有正式 Release，则显示预览版建设状态。

### 签名配置

- Windows：配置 `WINDOWS_CSC_LINK` 和 `WINDOWS_CSC_KEY_PASSWORD`。
- macOS：配置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，并准备 Developer ID 证书。
- 未配置签名时仍可生成测试安装包，但系统可能显示未验证开发者提示。

### 发布前检查

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- 确认 Release workflow 的 `GITHUB_TOKEN` 具备 `contents: write` 权限。
- 确认 Pages workflow 已启用 GitHub Pages，并使用 GitHub Actions 作为部署来源。

## 本地数据

桌面应用使用 Electron `app.getPath('userData')` 下的 `magic-printer.sqlite`。上传文件位于同一目录的 `uploads/<job-id>/`，后续清理服务会按任务完成时间删除临时文件。

## 首次真实打印验证

1. 先上传 PDF，确认设置页能枚举目标打印机。
2. 确认 WEB 页面显示的设备名称与系统打印机一致。
3. 提交 1 页测试文件，观察系统打印队列与历史记录。
4. 再测试设备离线、打印机切换和应用退出重启。
5. 未完成转换器前，不要把 DOCX/XLSX 当作已支持的真实打印格式。

## 原生模块与跨平台打包

`better-sqlite3` 是原生模块，必须使用目标平台和 Electron 版本重新编译。GitHub Actions 的 Windows、macOS、Linux runner 会分别完成自己的 native rebuild；不要在同一个 `node_modules` 目录中交替执行多个平台的 `electron-builder`，否则后一次构建可能覆盖前一次的 `.node` 文件。

如果本机在 Linux 打包验证后无法启动 macOS Electron，可执行：

```bash
npm_config_target=33.4.11 \
npm_config_runtime=electron \
npm_config_arch=arm64 \
npm_config_target_arch=arm64 \
npm_config_disturl=https://electronjs.org/headers \
pnpm --filter @magic-printer/database rebuild better-sqlite3
```

## 当前已知限制

- 依赖环境缺少 LibreOffice 时只报告不可用，不会自动安装。
- E-safe 检测器暂时返回 `not-configured`。
- 当前已接入本地启发式检测器：识别 `Esafenet` 等文件标记及异常 Office 容器时阻断任务；该策略用于风险拦截，不等同于厂商官方检测结果。
- 未知格式会被 API 明确阻止，避免未经转换直接误印；Office 需要先经过 LibreOffice 转换。
- LAN 绑定地址切换和完整会话过期策略仍需在桌面设置页完成；当前已先接入访问口令校验。
- 自动更新仅在签名、打包后的应用中生效；开发模式下不会访问 GitHub Releases。
- 任务文件路径只在当前进程内存中维护，应用重启后历史记录仍在，但原任务文件不会自动恢复。
- Electron 打印高级能力需要在 Windows、macOS、Linux 真机和真实驱动上逐项验证。
