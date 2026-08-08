# macOS 签名与公证

Magic Printer 的 macOS Release 使用 Developer ID 直接分发模式，不走 Mac App Store。macOS 任务会根据 GitHub Secrets 自动选择发布方式：

- Secrets 完整：签名并提交 Apple 公证，生成适合公开分发的 DMG/ZIP。
- Secrets 不完整：生成未签名 DMG/ZIP，便于开发测试；用户首次打开时可能需要在“系统设置 → 隐私与安全性”中允许。

## 需要准备的凭据

请在 macOS 的“钥匙串访问”中导出 `Developer ID Application` 证书为加密 `.p12` 文件。不要把 `.p12`、私钥、Apple 登录密码或专用密码提交到仓库，也不要直接发送到聊天窗口。

需要配置以下 GitHub Actions Secrets：

| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | `.p12` 文件的 Base64 内容 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | Apple Developer 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID 专用密码，不是登录密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID，通常为 10 位字母数字串 |

将 `.p12` 转成 Base64：

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

然后在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中创建上表 Secrets。`MAC_CSC_LINK` 只保存 Base64 文本，不保存原始文件路径。

## 验证签名和公证

发布完成后，在 macOS 上下载 DMG 并执行：

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Magic Printer.app"
spctl --assess --verbose --type exec "/Applications/Magic Printer.app"
xcrun stapler validate "/Applications/Magic Printer.app"
```

签名证书类型、导出方式和公证要求以 Apple Developer 文档为准；项目不需要也不应收集 Apple 账号登录密码。
