# QuickLaunch Dock

一款极简、零依赖的浏览器边缘快捷启动插件，原生兼容 **Chrome / Edge / Firefox（Manifest V3）**。
专为高频使用**自定义 URL 协议**（如 `vscode://`、`obsidian://`、`steam://`、`dingtalk://`、`weixin://` 等）快速跳转打开本地软件的场景设计。

## 核心特性

- **边缘常驻，悬停即出**：网页边缘极细半透明拉手（可上下拖拽定位、可切换左/右侧），鼠标移上自动平滑滑出小窗，离开自动收起；编辑表单/搜索时自动锁定不误关。
- **全站“一次勾选，永久免确认”**：所有自定义 URL 协议均经由插件同源中转页（`launcher/launch.html`）统一拉起，浏览器只记住插件本身来源，首次勾选“始终允许”后全站直达，告别换一个网站弹一次确认框的烦恼。
- **空白页无死角兜底**：在新建标签页、`chrome://`、`edge://`、`about:` 等无法注入悬浮条的页面，点击工具栏扩展图标或按 **`Alt + Q`** 即可呼出同款浮窗，数据实时同步。
- **专为无图标协议优化**：支持首字母自动彩色徽章、Emoji 快捷图标、图片 URL 或上传本地小图（自动压缩为 64×64 存储）。
- **支持 `.reg` 注册表文件一键批量导入**：完美兼容 [url-protocol-manager](https://github.com/symudo/url-protocol-manager) 与 Windows `regedit` 导出的 `.reg` 文件（UTF-16LE / UTF-8），自动提取自定义 URL 协议与友好名称，预览勾选即可批量添加。
- **跨浏览器互通备份**：支持网格/列表切换、浅色/深色自动适配，一键导入/导出 JSON 配置。

## 安装方式

### Chrome / Edge
1. 前往本仓库 **Releases**（或 GitHub Actions 构建产物）下载 `quicklaunch-dock-chrome-edge.zip` 并解压（或直接克隆本仓库）。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`，开启右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后的文件夹即可。

### Firefox
1. 下载云端构建产物 `quicklaunch-dock-firefox.zip`。
2. **临时测试**：打开 `about:debugging#/runtime/this-firefox` → 点击「临时载入附加组件」→ 选择解压目录中的 `manifest.json`。
3. **长期永久使用**：将 `quicklaunch-dock-firefox.zip` 上传至 [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) 选择「自行分发（Self-distribution）」自动免费签名获取 `.xpi` 安装包。
4. 安装后在 Firefox 扩展管理 → 权限中开启「访问所有网站的数据」，即可在所有网页显示边缘悬浮拉手。

## 云端构建与测试

本仓库配置了 GitHub Actions（`.github/workflows/build.yml`）：
- 每次 `push` 自动执行自动化测试并产出 Chrome/Edge 与 Firefox 双端安装包（Workflow Artifacts）。
- 推送 `v*` 版本标签（如 `git tag v1.0.0 && git push --tags`）会自动创建 GitHub Release 并附带双端 `.zip` 安装包。

本地如需运行测试或打包（需 Node.js 20+）：
```bash
node --test tests/*.test.mjs
node scripts/build.mjs
```
