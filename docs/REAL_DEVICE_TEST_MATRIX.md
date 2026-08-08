# Magic Printer 真机验证矩阵

该矩阵用于发布前验证，不把测试打印机或测试文档提交到仓库。

## 平台与安装包

| 平台 | 安装包 | 必测项目 | 状态 |
| --- | --- | --- | --- |
| Windows 10/11 | NSIS | 安装、托盘、开机启动、打印、卸载 | 待真机 |
| macOS Intel | DMG/ZIP | 安装、签名提示、打印、更新 | 待真机 |
| macOS Apple Silicon | DMG/ZIP | 安装、打印、更新 | 当前开发机可验证 |
| Linux x64 | AppImage/DEB | 安装、CUPS 打印、权限 | 待真机 |

## 文件样本

| 文件 | 检测 | 预览 | 打印 | 预期 |
| --- | --- | --- | --- | --- |
| 普通 PDF | plain | 成功 | 成功 | 允许 |
| PNG/JPG | plain | 成功 | 成功 | 允许 |
| 普通 DOCX | plain | LibreOffice 转 PDF | 成功 | 允许 |
| 普通 XLSX | plain | LibreOffice 转 PDF | 成功 | 允许 |
| Esafenet 加密文件 | encrypted/suspected | 禁止 | 禁止 | 阻断 |
| 损坏 Office 文件 | suspected/转换失败 | 禁止 | 禁止 | 阻断 |

## 打印机能力

- 默认打印机识别是否正确。
- 切换打印机后任务是否调用新设备。
- 彩色/黑白参数是否生效。
- 单面/长边双面/短边双面是否生效。
- A4、Letter 等纸张是否正确。
- 份数和页码范围是否正确。
- 打印机离线、拔线、驱动不可用时是否进入失败状态。

## 记录与清理

- 成功、失败、阻断任务均保留记录。
- 阻断文件源文件立即删除。
- 普通任务文件按七天策略清理。
- 用户删除记录后，关联源文件和预览文件同步删除。

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm inspect:file -- "/path/to/document.docx"
pnpm smoke:file -- "/path/to/document.docx"
```

真实打印验证必须在目标系统和目标驱动上执行，不能仅以 Linux CI 构建结果代替。
