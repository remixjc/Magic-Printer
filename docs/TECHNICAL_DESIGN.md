# Magic Printer 技术设计与开发方案

- 文档版本：1.0
- 文档日期：2026-08-07
- 推荐架构：Electron + TypeScript 单仓库

## 1. 技术选型结论

推荐 Electron，而不是首期采用 Tauri。该项目的主要复杂度在系统托盘、打印机枚举、Chromium/PDF 打印、后台 WEB 服务、Office 子进程和 GitHub 自动更新。Electron 的 Node.js 运行时和成熟打包生态能降低三端差异；代价是安装包与内存占用较大。若后续实测常驻资源不满足目标，再评估将后台服务和平台层迁移到 Rust，而无需重写 React WEB 界面。

| 层级 | 推荐方案 | 说明 |
|---|---|---|
| 桌面容器 | Electron + TypeScript | 托盘、窗口、生命周期、更新 |
| WEB/设置 UI | React + Vite | 两端复用组件和主题 token |
| 本地 API | Fastify | 上传、配置、记录、任务状态 |
| 状态通信 | REST + SSE | 控制操作用 REST，任务进度用 SSE |
| 数据库 | SQLite + Drizzle ORM | 单机、事务、迁移简单 |
| 校验 | Zod | API、配置和共享类型 |
| 预览 | PDF.js + 浏览器图片能力 | Office 先转 PDF |
| Office 转换 | LibreOffice headless | 外部依赖，可检测和降级 |
| 构建 | pnpm workspace + electron-builder | 多包管理与三端产物 |
| 更新 | electron-updater + GitHub Releases | 重启完成更新 |
| 测试 | Vitest + Playwright | 单元、集成和端到端 |

## 2. 总体架构

```text
┌──────────────── Desktop App (Electron) ────────────────┐
│ Main Process                                            │
│  Tray / Settings / Lifecycle / Auto Update / Auto Start│
│        │ IPC                         │                  │
│        ▼                             ▼                  │
│  Platform Adapters             Local API (Fastify)      │
│  - Printer discovery           - Auth / upload          │
│  - Native printing             - config / history       │
│  - Dependency install          - jobs / SSE             │
│        │                             │                  │
│        └──────── Print Job Service ──┤                  │
│                  │                   │                  │
│          Converter / Detector      SQLite               │
│          LibreOffice / E-safe                           │
└───────────────────────┬─────────────────────────────────┘
                        │ localhost or authenticated LAN
                        ▼
                 React WEB Print UI
```

### 2.1 进程模型

- Electron 主进程拥有所有高权限能力：打印、文件系统、子进程、设置和更新。
- 设置页 renderer 开启 `contextIsolation`，关闭 `nodeIntegration`，只通过白名单 preload API 通信。
- Fastify 与 Electron 主进程首期可运行在同一 Node 进程，但按独立模块管理生命周期。
- LibreOffice 等不可信/易阻塞工作必须运行在受控子进程中，并设置超时与资源限制。
- 若转换负载导致主进程稳定性下降，可将 API/worker 拆为 Electron utility process，接口保持不变。

## 3. 单仓库设计

```text
apps/
  desktop/
    src/main/          Electron main、tray、window、updater
    src/preload/       最小 IPC bridge
    src/renderer/      设置界面
  web/
    src/               WEB 打印页面
packages/
  api/                 Fastify routes、auth、SSE
  core/                Job service、状态机、领域错误
  database/            schema、migration、repositories
  platform/
    windows/           PowerShell/Win32 适配
    macos/             CUPS、LaunchAgent 等适配
    linux/             CUPS、desktop autostart 等适配
  converters/          PDF、图片、LibreOffice 转换
  encryption/          E-safe detector 接口与实现
  shared/              contracts、schemas、logging
  ui/                  主题 token、共享组件
build/                 图标、entitlements、installer 配置
.github/workflows/     CI 与 release
```

## 4. 核心领域模型

### 4.1 打印任务状态机

```text
UPLOADED → VALIDATING → BLOCKED
                     ↘ CONVERTING → READY → QUEUED → PRINTING → SUCCEEDED
                                      │         │          └→ FAILED
                                      └─────────┴────────────→ CANCELLED
```

- 每次状态变化写入事务和时间戳。
- 进入 `PRINTING` 前保存不可变任务快照。
- 应用启动时，遗留的 `PRINTING` 状态改为 `INTERRUPTED/FAILED`，绝不自动重打。
- 每个打印机使用独立单并发队列；转换可配置少量并发。

### 4.2 建议数据表

- `settings`：键、JSON 值、更新时间。
- `printers_cache`：设备标识、显示名、能力、最后发现时间。
- `print_jobs`：任务元数据、参数快照、状态、错误码、时间。
- `job_events`：状态事件和诊断摘要。
- `auth_sessions`：LAN 会话哈希、过期时间、最后活动时间。
- `schema_migrations`：数据库版本。

文件本体不进入 SQLite。源文件、转换结果和缩略图存储在随机任务目录，并由清理服务管理。

## 5. API 草案

基础路径：`/api/v1`

| Method | Path | 用途 |
|---|---|---|
| GET | `/health` | 服务和依赖状态 |
| POST | `/auth/pair` | LAN 配对/登录 |
| GET | `/capabilities` | 预览、格式、当前打印机能力 |
| POST | `/uploads` | 流式上传并创建任务 |
| GET | `/jobs/:id` | 获取任务详情 |
| POST | `/jobs/:id/prepare` | 检测、转换和生成预览 |
| POST | `/jobs/:id/print` | 校验参数并入队 |
| POST | `/jobs/:id/cancel` | 取消未进入驱动的任务 |
| GET | `/jobs/:id/events` | SSE 状态流 |
| GET | `/jobs` | 最近七天记录 |
| DELETE | `/jobs/:id` | 删除记录及残留文件 |
| DELETE | `/jobs` | 清空记录 |
| GET | `/jobs/:id/preview` | 鉴权后的预览资源 |

设置写操作只允许桌面 IPC，或要求单独的管理员凭据，不能开放给普通 WEB 会话。

## 6. 打印实现策略

### 6.1 统一打印中间格式

所有输入先规范化为 PDF，打印服务只接收 PDF 和标准化参数。这能减少 Word、Excel、图片在各操作系统上行为不一致的问题，也便于预览与最终输出保持一致。

### 6.2 平台适配接口

```ts
interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  getCapabilities(printerId: string): Promise<PrinterCapabilities>;
  printPdf(input: PrintPdfRequest): Promise<NativePrintResult>;
  cancel(nativeJobId: string): Promise<void>;
}
```

建议实现路径：

- Windows：优先使用 Chromium/Electron 对指定 `deviceName` 静默打印；通过 Windows API 或 PowerShell/CIM 补充枚举和状态。原型阶段验证页码、双面、纸张参数在主流驱动上的一致性。
- macOS：使用系统 CUPS 的 `lp`/`lpstat`，通过参数映射指定打印机与选项。
- Linux：使用 CUPS 的 `lp`/`lpstat`；启动时检测 CUPS 客户端和服务状态。

禁止仅调用操作系统“默认打印机”，因为需求要求 WEB 任务严格使用设置页选定设备。内部保存稳定的系统设备 ID，而不是只保存展示名称。

### 6.3 能力协商

- UI 仅展示打印机明确支持的高级选项。
- 驱动不报告能力时只提供安全的基础参数。
- 打印前重新检查设备存在和状态。
- 参数映射失败时返回明确错误，不偷偷忽略关键参数。

## 7. 文件处理与预览

### 7.1 安全上传管线

1. 流式写入随机临时文件，边写边计算 SHA-256 和限制大小。
2. 使用 magic bytes/MIME 检测真实类型。
3. 清理展示文件名，拒绝可执行文件和未知容器。
4. 调用 E-safe 检测器。
5. 对 ZIP 容器格式（DOCX/XLSX）限制解压条目与总大小，防止压缩炸弹。
6. 转换使用独立临时目录、超时、取消令牌和进程树回收。
7. 生成 PDF 后进行基本完整性验证，再开放预览和打印。

### 7.2 LibreOffice

建议命令形态：使用 `--headless --convert-to pdf --outdir ...`，同时为每个任务指定独立的用户配置目录，避免并发锁和污染用户真实 Office 配置。

依赖管理策略：

- Windows/macOS：检测常见安装路径和可执行文件；用户确认后跳转 LibreOffice 官方下载页。不要在未授权时静默安装系统软件。
- Linux：识别包管理器，展示将执行的命令；在用户确认和系统授权后执行，或复制命令供用户自行运行。
- 每次升级应用后重新做一次兼容性检测；健康页显示可执行路径和版本。

### 7.3 Excel 预览注意事项

电子表格分页受打印区域、纸张、缩放和字体影响。准备阶段需要明确默认值，并让用户在 PDF 预览中确认最终分页。首期不承诺还原所有复杂公式、外部链接、宏和专有字体效果。

## 8. E-safe 适配设计

这是首要技术预研项。亿赛通透明加密可能依赖客户端驱动、策略和进程授权，单纯读取文件头不一定能区分“加密文件”“损坏文件”和“未知二进制”。因此设计如下：

```ts
type EncryptionVerdict = 'plain' | 'encrypted' | 'suspected' | 'unavailable';

interface EncryptionDetector {
  isAvailable(): Promise<boolean>;
  inspect(path: string, metadata: FileMetadata): Promise<DetectionResult>;
}
```

检测优先级：

1. 亿赛通官方 SDK/API/CLI 返回值。
2. 企业安全客户端提供的受支持检测命令或扩展属性。
3. 在明确样本验证后的特征规则，只用于“疑似”结果，不能宣称准确识别。
4. 转换器无法打开文件只能作为补充信号，不能等同于 E-safe 加密。

需要从需求方/厂商获得：产品全称与版本、三端支持范围、授权进程方式、SDK 文档、错误码、普通/加密/损坏样本和再分发许可。

## 9. WEB 与网络安全

### 9.1 默认策略

- 默认绑定 `127.0.0.1` 与 IPv6 loopback。
- LAN 模式需要明确开关，首次开启生成高熵访问口令/配对码。
- 会话 cookie 使用 `HttpOnly`、`SameSite=Strict`；HTTPS 场景加 `Secure`。
- 验证 `Host`、`Origin` 和 CSRF token，限制 CORS。
- 对登录、上传和打印提交做速率限制。
- 局域网模式显示当前绑定地址、防火墙风险和关闭入口。

### 9.2 HTTPS 边界

本地自签名证书会产生浏览器信任问题，因此首期不自动承诺可信 HTTPS。企业局域网可使用已有 CA/反向代理；跨网络访问建议使用 VPN。若产品必须直接公网可用，应拆分为独立云服务项目并重新进行威胁建模。

## 10. 桌面安全

- Electron `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- preload 暴露最小且带 schema 校验的 API。
- 禁止 renderer 任意打开外部 URL；外链使用 allowlist。
- 启用严格 CSP，避免加载远程脚本。
- 更新包必须验证平台签名及发布元数据。
- 日志使用结构化格式，令牌、路径和文件名按规则脱敏。

## 11. 自动启动

- Windows/macOS 使用 Electron `app.setLoginItemSettings`，并验证实际状态。
- Linux 优先创建符合 XDG Autostart 规范的 `.desktop` 文件；不同桌面环境做兼容测试。
- 自启动参数带 `--hidden`，进入托盘而不显示设置窗口。

## 12. 更新与发布

### 12.1 版本策略

- 遵循 Semantic Versioning。
- `main` 保护分支；PR 必须通过 lint、typecheck、test 和 build。
- 标签 `vX.Y.Z` 触发发布工作流。
- 首期生成 Draft Release，由维护者验证后手动发布；成熟后再切自动发布。

### 12.2 GitHub Actions 矩阵

| Runner | 产物 | 必要密钥 |
|---|---|---|
| `windows-latest` | NSIS exe | Windows 代码签名证书 |
| `macos-13/14` | x64/arm64 DMG/ZIP | Developer ID、notary 凭据 |
| `ubuntu-latest` | AppImage、deb | 可选 GPG/仓库签名 |

工作流建议拆分：

1. `ci.yml`：安装、缓存、lint、typecheck、单元测试、构建 WEB。
2. `e2e.yml`：按需运行无头 UI 测试和平台烟雾测试。
3. `release.yml`：标签触发三平台打包、签名、校验和、SBOM，上传 Draft Release。
4. `dependency-review.yml`：依赖审查和自动更新 PR。

macOS 签名/公证和 Windows SmartScreen 信誉是正式分发的前置条件。没有证书也能产出测试包，但不能视为专业可发布状态。

### 12.3 自动更新限制

- Windows NSIS 与 macOS DMG/ZIP 可走 electron-updater 标准流程。
- Linux 推荐 AppImage 承担应用内更新；DEB/RPM 应尊重系统包管理器。
- 更新只替换应用程序，不迁移或删除用户数据；数据库迁移必须前向兼容并有备份策略。

## 13. 可观测性与诊断

- 本地结构化滚动日志，按大小和天数清理。
- 设置页提供“导出诊断包”，默认排除源文档、令牌和敏感路径。
- 健康信息包含：应用版本、平台、数据库版本、端口、打印机状态、CUPS/LibreOffice/E-safe 检测状态。
- 远程遥测默认关闭；未来增加时必须征得明确同意并公开字段。

## 14. 测试策略

### 14.1 自动化

- 单元测试：任务状态机、参数校验、清理策略、鉴权、文件类型判断。
- 集成测试：SQLite 迁移、Fastify API、LibreOffice 转换、失败与超时。
- E2E：上传 → 预览 → 入队 → 模拟打印 → 记录删除。
- 安全测试：路径穿越、伪造 MIME、超大文件、ZIP bomb、CSRF、暴力登录。
- 更新测试：旧版本升级、失败回滚、数据库迁移。

### 14.2 真机矩阵

- Windows 10/11；macOS Intel/Apple Silicon；Ubuntu LTS，另选一个主流发行版抽测。
- 至少覆盖 USB 与网络打印机、黑白与彩色打印机。
- 用虚拟 PDF 打印机做 CI/回归，用真实设备完成发布前验收。
- E-safe 必须在安装实际安全客户端的授权环境中测试。

## 15. 关键风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---:|---|
| E-safe 无公开稳定检测接口 | 极高 | 第一个迭代做技术验证；以官方接口为验收前提 |
| 三端打印参数和驱动差异 | 高 | 统一 PDF；能力协商；维护真机矩阵 |
| Office 转换版式差异 | 高 | PDF 预览确认；固定转换版本；记录字体缺失 |
| LAN 服务暴露敏感文件与打印能力 | 高 | 默认 loopback；强制认证；限流；不直接公网开放 |
| Windows/macOS 未签名安装受阻 | 高 | 尽早采购证书和开发者账号 |
| Linux 发行版碎片化 | 中 | 首期限定支持矩阵，以 AppImage + Ubuntu LTS 为主 |
| 应用崩溃造成重复打印 | 高 | 持久化状态机；恢复时不自动重打 |

## 16. 建议决策记录（ADR）

- ADR-001：Electron 作为首期桌面容器。
- ADR-002：统一 PDF 作为打印中间格式。
- ADR-003：WEB 默认仅本机，LAN 必须主动开启并认证。
- ADR-004：Office 预览依赖外部 LibreOffice，不随安装包内置。
- ADR-005：E-safe 识别依赖官方适配器，启发式仅可判为疑似。
- ADR-006：任务进入打印状态后崩溃恢复不自动重试。
- ADR-007：GitHub Release 首期为草稿发布，人工验证后公开。
