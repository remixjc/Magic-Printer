# Magic Printer

Magic Printer 是一个本地优先的跨平台打印工作台，面向 Windows、macOS 和 Linux。它将桌面托盘应用、本地 Web 界面和系统打印服务整合在一起，帮助用户在本机完成文件上传、预览、参数配置和打印提交。

应用默认不依赖云端服务，文件和打印记录保存在本机；如需从其他设备访问，可由用户主动开启局域网访问，并通过一次性配对码建立会话。

> 当前发布目标：`v0.1.26`

[![CI](https://github.com/remixjc/Magic-Printer/actions/workflows/ci.yml/badge.svg)](https://github.com/remixjc/Magic-Printer/actions/workflows/ci.yml)
[![Release](https://github.com/remixjc/Magic-Printer/actions/workflows/release.yml/badge.svg)](https://github.com/remixjc/Magic-Printer/actions/workflows/release.yml)
[![Pages](https://github.com/remixjc/Magic-Printer/actions/workflows/pages.yml/badge.svg)](https://github.com/remixjc/Magic-Printer/actions/workflows/pages.yml)

项目介绍页：[remixjc.github.io/Magic-Printer](https://remixjc.github.io/Magic-Printer/)

## 产品定位

Magic Printer 适合个人、教育、研究、公益和内部非商业场景，重点解决以下问题：

- 在一台电脑上统一管理常用打印任务。
- 在正式打印前查看文档或图片预览。
- 为普通文档和 A4 半张发票提供清晰的版式选择。
- 在不上传文件到第三方云服务的前提下，允许可信设备通过局域网发起打印。
- 对打印机能力、Office 预览依赖和疑似风险文件提供明确反馈。

项目目前不接入正式的亿赛通/E-safe 厂商 SDK、授权接口或远程云端打印服务。

## 核心能力

### 文件与预览

- 支持 PDF、常见图片、Word 和 Excel 文件上传。
- PDF 与图片可直接预览。
- Office 文件可通过 LibreOffice 转换后预览。
- macOS 上的 `.doc`、`.docx` 文件支持系统 `textutil` 回退路径；Excel 文件通常仍需要 LibreOffice。
- Office 预览在新安装中默认开启，也可以在桌面端“应用设置”中关闭或重新开启。
- 预览完成后可以直接选择新文件，无需返回页面重新加载。

### 打印控制

- 支持份数、页码范围、方向、颜色、双面、纸张和版式配置。
- 根据打印机能力自动识别颜色、双面和纸张选项。
- 黑白打印机自动切换为灰度模式，避免提交不支持的彩色参数。
- 打印过程中显示排队、打印中、成功和失败等阶段状态。
- 打印成功后显示确认提醒，并保留最近七天的本地打印记录。
- 删除记录前提供确认窗口，同时清理对应的本地文件。

### A4 半张发票

“半张（A4 发票）”表示在一张 A4 纸上以半张区域打印内容，不等同于选择 A5 纸。

操作步骤：

1. 将纸张设置为 `A4`。
2. 将版式设置为 `半张（A4 发票）`。
3. 确认打印机纸盒中装的是 A4 纸后开始打印。

应用会将该模式提交为一张纸两页的版式参数，适合常见的 A4 半张发票场景。

### 桌面端与 Web 端

- 桌面客户端提供“服务与安全”和“应用设置”，用于配置端口、局域网访问、主题、开机启动和 Office 预览。
- 局域网 Web 客户端只提供打印、预览和记录功能，不展示本机服务配置和应用设置。
- 局域网访问默认关闭；开启后需要使用桌面端显示的 6 位配对码建立会话。
- 局域网访问不会自动将服务暴露到公网，仍建议通过受控 VPN 或认证反向代理进行更复杂的网络部署。

### 桌面集成

- Electron 托盘常驻、单实例运行和最小化到状态栏。
- 支持开机启动配置。
- 支持自动更新配置，可通过 GitHub Release 分发安装包。
- macOS PDF 优先通过系统 CUPS 打印队列提交，减少经过浏览器 PDF 打印路径时的兼容性问题。

## 支持格式与依赖

| 文件类型 | 预览方式 | 额外依赖 |
| --- | --- | --- |
| PDF | 直接预览 | 无 |
| PNG、JPG、JPEG、WEBP、BMP、GIF、TIFF | 直接预览 | 无 |
| `.doc`、`.docx` | LibreOffice 或 macOS `textutil` 回退 | macOS Word 文件可优先使用系统转换 |
| `.xls`、`.xlsx` | LibreOffice 转换 | 需要安装 LibreOffice |

缺少 LibreOffice 时，应用会在能力页面和设置区域显示依赖状态，并提供安装建议。Office 预览也可以作为安全降级选项关闭；这不会影响 PDF、图片等无需 Office 转换的文件流程。

## 安装与使用

### 下载发行版

从 [GitHub Releases](https://github.com/remixjc/Magic-Printer/releases) 下载对应平台的安装包：

- Windows：`Magic-Printer-Setup-*.exe`
- macOS：`*.dmg` 或 `*.zip`
- Linux：`*.AppImage` 或 `*.deb`

每个 Release 同时提供对应平台的 `SHA256SUMS-*.txt` 校验文件，建议在部署前验证下载包完整性。

当前 GitHub Actions 生成的 macOS 包未启用签名与公证。首次打开时，如果 macOS 显示安全提示，请在系统设置中允许该应用运行；生产环境建议配置 Apple Developer 证书并启用签名与公证。

### 首次使用

1. 启动 Magic Printer，等待本地服务完成初始化。
2. 在“当前打印机”中选择目标打印机。
3. 选择或拖入 PDF、图片或 Office 文件。
4. 等待预览完成，确认纸张、方向、颜色、双面和版式。
5. 点击“开始打印”，根据进度提示确认任务结果。

如果使用其他电脑或手机访问：

1. 在桌面端“服务与安全”中开启局域网访问。
2. 使用桌面端显示的访问地址打开 Web 界面。
3. 输入 6 位配对码完成授权。

## Office 预览故障排查

如果看到“Office 预览未启用”：

1. 回到运行 Magic Printer 的桌面电脑。
2. 打开“应用设置”。
3. 将“Office 预览”设置为“开启”。
4. 回到 Web 页面重新选择或准备文件。

如果是 Excel 文件仍然无法预览，请确认本机已安装 LibreOffice，并在 Magic Printer 的依赖状态区域确认其可用。macOS 的 Word 文件可以尝试系统转换回退，但复杂排版、嵌入对象和部分旧格式的兼容性仍取决于系统转换能力。

## 安全与隐私边界

- Web 服务默认只监听 `127.0.0.1`。
- 局域网访问需要用户主动开启，并使用短期配对会话授权。
- 局域网客户端不展示本机服务配置和应用设置，降低远程设备修改本机配置的风险。
- 上传文件、预览文件和打印记录默认保存在本机，不上传第三方云端。
- 打印记录默认保留七天，过期记录及关联文件会自动清理，也支持手动删除。
- 应用包含基于特征的本地风险文件检测，疑似 E-safe/Esafenet 或异常 Office 文件会被阻断预览和打印。
- 风险检测属于启发式安全措施，不构成对文件是否加密的法律、取证或厂商级判断。
- 应用不会绕过文档权限、破解密码或尝试解密 E-safe 文件。
- 不建议将本地服务直接暴露到公网。

## 从源码运行

### 环境要求

- Node.js 22
- pnpm 9
- 如需预览 Excel 或在非 macOS 平台预览 Office 文件，建议安装 LibreOffice

### 安装与启动

```bash
pnpm install
pnpm dev
```

### 常用命令

```bash
# 构建全部工作区项目
pnpm build

# 类型检查（包含构建）
pnpm typecheck

# 运行全部测试
pnpm test

# 检查单个文件的格式、风险和支持情况
pnpm inspect:file -- "/path/to/document"

# 执行单个文件的预览冒烟测试
pnpm smoke:file -- "/path/to/document"
```

## 项目结构

```text
apps/
  desktop/          Electron 主进程、托盘、窗口和系统集成
  web/              浏览器打印操作界面
packages/
  api/              Fastify 本地 Web 服务与打印 API
  converters/       文件检测、Office 转换和预览处理
  database/         SQLite 配置与打印记录
  platform/         Windows/macOS/Linux 打印机能力适配
  shared/           公共类型、校验和打印参数模型
website/            GitHub Pages 项目介绍页
docs/               产品、技术、开发和验收文档
```

## 文档导航

- [产品需求文档](docs/PRODUCT_REQUIREMENTS.md)
- [技术设计与开发方案](docs/TECHNICAL_DESIGN.md)
- [开发指南](docs/DEVELOPMENT.md)
- [实施路线图与验收计划](docs/ROADMAP.md)
- [三平台真实设备验证矩阵](docs/REAL_DEVICE_TEST_MATRIX.md)
- [macOS 签名与公证配置](docs/MACOS_SIGNING.md)
- [许可说明](docs/LICENSE_GUIDE.md)
- [项目介绍页说明](website/README.md)

## 构建与发布

推送符合 `v*.*.*` 格式的标签会触发 `.github/workflows/release.yml`，自动完成：

1. 安装依赖并重建 Electron 原生模块。
2. 执行项目构建。
3. 分别生成 Windows、macOS 和 Linux 安装包。
4. 上传 GitHub Release 资产。
5. 生成各平台 SHA256 校验和。

发布前建议执行：

```bash
pnpm typecheck
pnpm test
git diff --check
```

GitHub Pages 由 `.github/workflows/pages.yml` 自动部署，发布来源应设置为 **GitHub Actions**。

## 许可证

Magic Printer 使用 [PolyForm Noncommercial License 1.0.0](LICENSE)。该许可证允许个人、教育、研究和公益等非商业用途下免费使用、修改和再分发；未经版权持有人书面授权，不允许商业集成、公司内部商业使用、销售、SaaS、收费服务或其他商业用途。

因此，本项目属于 source-available（源码可用）项目，不宣称为 OSI 定义下的开源软件。完整授权边界和示例请阅读[中文许可说明](docs/LICENSE_GUIDE.md)。

Required Notice: Copyright (c) 2026 remixjc. Magic Printer is licensed for noncommercial use only.

## 反馈与贡献

欢迎通过 [GitHub Issues](https://github.com/remixjc/Magic-Printer/issues) 报告问题或提出改进建议。提交问题时请附上操作系统、应用版本、相关日志和可复现步骤；请勿上传包含敏感信息或受版权保护的原始打印文件。
