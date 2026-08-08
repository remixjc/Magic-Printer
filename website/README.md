# Magic Printer GitHub Pages

该目录是 Magic Printer 的项目介绍站，采用无构建依赖的 HTML、CSS 和 JavaScript，可由 GitHub Pages 直接发布。

## 本地预览

在仓库根目录执行：

```bash
python3 -m http.server 8080 --directory website
```

然后访问 `http://localhost:8080`。

不要直接双击 `index.html` 作为最终验证方式，因为部分浏览器对 `file://` 的行为和 GitHub Pages 不同。

## 发布

仓库中的 `.github/workflows/pages.yml` 会在以下场景部署：

- `main` 分支的 `website/**` 文件发生变化；
- 手动触发 workflow。

首次发布前，需要在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中将 Source 设置为 **GitHub Actions**。

## 正式发布前需要替换

- 将首页的 `PREVIEW` 标记替换为实际版本。
- 将“正在构建中”替换为最新稳定版下载信息。
- 增加真实应用截图、安装说明和发行说明。
- 确认项目版权主体和有效联系邮箱。
- 配置自定义域名时增加 `CNAME` 文件。
- 为社交分享增加 1200×630 的 Open Graph 图片，并在 `index.html` 中配置绝对地址。
- 根据最终产品行为补充正式隐私声明。

## 设计原则

- 视觉参考现代开发者工具站点，但不复制第三方代码、文案、商标或受保护资产。
- 深浅主题均可使用，选择保存在浏览器本地。
- 使用语义 HTML、键盘可访问控件和 `prefers-reduced-motion` 降级。
- 页面在 320px、平板和桌面宽度下保持可读。
