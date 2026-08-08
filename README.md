# Magic Printer

Magic Printer 是一款面向 Windows、macOS 和 Linux 的跨平台本地打印服务。应用提供系统托盘、打印机选择、开机启动、本地 WEB 打印页面、文件预览、七天打印记录和 GitHub Releases 自动更新能力。

> 当前仓库处于需求与技术设计阶段，尚未进入业务代码开发。

## 核心能力

- Windows、macOS、Linux 桌面端安装与运行
- 系统托盘常驻与设置窗口
- 枚举并选择当前电脑可用打印机
- 本机或经授权的局域网设备通过浏览器上传并打印文件
- 支持图片、PDF、Word、Excel 等常见格式
- 图片/PDF 原生预览，Office 文件通过 LibreOffice 转换后预览
- 缺少 LibreOffice 时提供按操作系统区分的官方下载地址与安装命令提示
- E-safe（亿赛通）加密文件检测与阻断适配
- 本地保存最近七天打印记录，支持主动删除
- 跟随系统、深色、浅色三种主题
- 开机启动、更新检测、GitHub Actions 多平台构建和 Release

## 文档

- [产品需求文档](docs/PRODUCT_REQUIREMENTS.md)
- [技术设计与开发方案](docs/TECHNICAL_DESIGN.md)
- [实施路线图与验收计划](docs/ROADMAP.md)
- [许可说明](docs/LICENSE_GUIDE.md)
- [项目介绍页源码](website/README.md)

## 项目介绍页

介绍页源码位于 [`website/`](website/)，通过 [GitHub Pages 工作流](.github/workflows/pages.yml) 自动部署。首次启用时，在仓库 **Settings → Pages** 中将发布来源设置为 **GitHub Actions**；部署成功后，默认地址预计为 `https://remixjc.github.io/Magic-Printer/`。

## 推荐技术栈

- Electron + TypeScript
- React + Vite + Zustand + TanStack Query
- Fastify + WebSocket/SSE
- SQLite + Drizzle ORM
- LibreOffice（Office 转 PDF）+ PDF.js
- electron-builder + electron-updater
- Vitest + Playwright

## 开发

```bash
pnpm install
pnpm dev
```

更多启动方式、当前完成范围和限制见[开发指南](docs/DEVELOPMENT.md)。

## 计划中的目录结构

```text
apps/
  desktop/          Electron 主进程、托盘与设置界面
  web/              浏览器打印界面
packages/
  api/              Fastify 本地服务及 API
  core/             打印任务、策略与领域模型
  database/         SQLite schema 与迁移
  platform/         Windows/macOS/Linux 平台适配
  shared/           公共类型、校验和工具
  ui/               共享 UI 组件与主题
docs/                产品、技术和交付文档
```

## 安全提示

WEB 服务默认只监听 `127.0.0.1`。局域网访问必须由用户主动开启，并启用访问口令、短期会话、上传限制和来源校验。Magic Printer 不应直接暴露到公网；公网使用应通过受控 VPN 或反向代理完成。

## License

Magic Printer 采用 [PolyForm Noncommercial License 1.0.0](LICENSE)：源代码可免费用于个人、教育、研究、公益等非商业目的，并允许在相同非商业边界内研究、修改和分发；未经版权持有人书面授权，禁止公司内部使用、商业集成、销售、SaaS、收费服务及其他商业用途。

由于限制商业使用，本项目属于 **source-available（源码可用）**，不是 OSI 定义下的开源软件。请阅读[中文许可说明](docs/LICENSE_GUIDE.md)了解常见场景。

Required Notice: Copyright (c) 2026 remixjc. Magic Printer is licensed for noncommercial use only.
