# Magic Printer

Magic Printer 是一个面向 Windows、macOS 和 Linux 的本地优先打印工作台。它将桌面托盘应用、浏览器打印界面和系统打印能力组合在一起，让用户可以在当前电脑上安全地选择打印机、上传文件、预览并提交打印任务。

> 当前最新验证版本：`v0.1.8`。三平台 Release 已通过 GitHub Actions 构建并发布。

[![CI](https://github.com/remixjc/Magic-Printer/actions/workflows/ci.yml/badge.svg)](https://github.com/remixjc/Magic-Printer/actions/workflows/ci.yml)
[![Release](https://github.com/remixjc/Magic-Printer/actions/workflows/release.yml/badge.svg)](https://github.com/remixjc/Magic-Printer/actions/workflows/release.yml)
[![Pages](https://github.com/remixjc/Magic-Printer/actions/workflows/pages.yml/badge.svg)](https://github.com/remixjc/Magic-Printer/actions/workflows/pages.yml)

项目介绍页：<https://remixjc.github.io/Magic-Printer/>

## 项目定位

Magic Printer 适合个人、教育、研究、公益和内部非商业场景。应用默认运行在本机，局域网访问必须由用户主动开启并通过配对码建立会话。项目不会将打印文件上传到第三方云服务，也不接入正式的亿赛通/E-safe 厂商 SDK 或授权接口。

## 已实现能力

- Windows、macOS、Linux 跨平台 Electron 安装包
- 系统托盘常驻、最小化到状态栏、单实例运行和开机启动选项
- 枚举本机打印机并配置默认打印设备
- 本地 Web 服务和可选局域网访问，支持 6 位数字配对码
- 图片、PDF、Word、Excel 等常见文件上传
- 图片/PDF 预览；Office 文件通过 LibreOffice 转换为 PDF 后预览
- LibreOffice 缺失检测、安装提示和安全降级（关闭预览但保留必要流程）
- 打印参数：份数、纸张、方向、颜色、双面和页码范围
- 最近七天打印记录，本地查看并支持主动删除
- 自动、深色、浅色主题，整体风格接近 VS Code 默认主题
- 本地启发式加密文件风险拦截：疑似 E-safe/Esafenet 文件会阻断预览和打印
- GitHub Pages 项目介绍页、GitHub Actions CI、三平台 Release 和 SHA256 校验和
- `electron-updater` 自动更新配置，可通过 GitHub Release 分发更新

## 风险文件拦截

为避免加密文件进入打印机导致设备异常，上传阶段会进行本地静态检查。检测到 `Esafenet`、`E-safe`、`ESAFE` 等特征，或发现异常 Office 容器时，任务会被标记为阻断、不会生成预览文件，也不会调用打印机，并提示：

> 文件疑似已加密，请先解密后再打印

该检测器是风险控制措施，不对文件是否加密作法律或取证意义上的确定性判断。正式打印前仍应由用户确认文件来源和可打印性。

## 快速开始

### 下载发行版

从 [GitHub Releases](https://github.com/remixjc/Magic-Printer/releases) 下载对应系统安装包：

- Windows：`Magic-Printer-Setup-*.exe`
- macOS Apple Silicon：`*.dmg` 或 `*.zip`（当前为未签名构建）
- Linux：`*.AppImage` 或 `*.deb`

每个 Release 同时提供 `SHA256SUMS-*.txt`，建议在部署前校验文件完整性。

### 从源码运行

要求 Node.js 22、pnpm 9。

```bash
pnpm install
pnpm dev
```

常用检查命令：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm inspect:file -- "/path/to/document"
pnpm smoke:file -- "/path/to/document"
```

Office 预览需要本机安装 LibreOffice。缺少该工具时，应用会给出对应系统的官方下载入口和安装建议；用户也可以选择不安装，此时 Web 界面不会展示预览功能。

## 工作区结构

```text
apps/
  desktop/          Electron 主进程、托盘、窗口和系统集成
  web/              浏览器打印操作界面
packages/
  api/              Fastify 本地 Web 服务与打印 API
  converters/       文件检测、Office 转 PDF 和预览转换
  database/         SQLite 配置与七天打印记录
  platform/         Windows/macOS/Linux 打印机能力适配
  shared/           公共类型、校验和打印参数模型
website/            GitHub Pages 项目介绍页
docs/               产品、技术、开发和验收文档
```

## 安全与隐私边界

- Web 服务默认只监听 `127.0.0.1`。
- 开启局域网访问后，必须先使用界面展示的 6 位配对码建立短期会话。
- 上传文件和打印记录默认保存在本机；记录保留七天并可手动删除。
- 不建议将服务直接暴露到公网；如确有需要，应使用受控 VPN 或经过认证的反向代理。
- 应用不会绕过文档权限、破解加密或尝试解密 E-safe 文件。

## 文档导航

- [产品需求文档](docs/PRODUCT_REQUIREMENTS.md)
- [技术设计与开发方案](docs/TECHNICAL_DESIGN.md)
- [开发指南](docs/DEVELOPMENT.md)
- [实施路线图与验收计划](docs/ROADMAP.md)
- [三平台真实设备验证矩阵](docs/REAL_DEVICE_TEST_MATRIX.md)
- [许可说明](docs/LICENSE_GUIDE.md)
- [项目介绍页说明](website/README.md)

## 构建与发布

推送 `v*.*.*` 标签会触发 `.github/workflows/release.yml`，自动完成依赖安装、Electron 原生模块重建、三平台打包、GitHub Release 上传和 SHA256 校验和生成。当前公开工作流生成未签名 macOS 包；配置 Apple Developer 证书后可进一步启用签名与公证。

GitHub Pages 由 `.github/workflows/pages.yml` 自动部署，发布来源应设置为 **GitHub Actions**。

## 许可

Magic Printer 使用 [PolyForm Noncommercial License 1.0.0](LICENSE)。允许个人、教育、研究、公益等非商业用途下免费使用、修改和再分发；未经版权持有人书面授权，禁止商业集成、公司内部商业使用、销售、SaaS、收费服务和其他商业用途。

因此本项目属于 **source-available（源码可用）**，不宣称为 OSI 定义下的开源软件。完整边界和授权示例请阅读[中文许可说明](docs/LICENSE_GUIDE.md)。

Required Notice: Copyright (c) 2026 remixjc. Magic Printer is licensed for noncommercial use only.

## 贡献与反馈

欢迎通过 [GitHub Issues](https://github.com/remixjc/Magic-Printer/issues) 报告问题或提出改进建议。提交问题时请附上操作系统、应用版本、相关日志和可复现步骤；请勿上传包含敏感信息或受版权保护的原始打印文件。
