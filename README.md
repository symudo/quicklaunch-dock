# QuickLaunch Dock

一款极简、零依赖的浏览器边缘快捷启动插件，原生兼容 **Chrome / Edge / Firefox（Manifest V3）**。
专为高频使用**自定义 URL 协议**（如 `vscode://`、`obsidian://`、`steam://`、`dingtalk://`、`weixin://` 等）快速跳转打开本地软件的场景设计。

## 核心特性

- **边缘常驻，悬停即出，全屏零打扰**：网页边缘极细半透明拉手（可上下拖拽定位、可切换左/右侧），鼠标移上自动平滑滑出小窗，离开自动收起；编辑表单/搜索时自动锁定不误关；**全屏播放视频自动隐藏**，支持按域名隐藏边缘栏。
- **键盘极速直达**：按 **`Alt + Q`** 呼出浮窗并自动聚焦搜索框，输入关键字按 **`Enter`** 直接秒开本地软件；支持网格/列表下**直接拖拽卡片排序**。
- **原页静默直连（默认，零新标签页）& 同源中转（自动返回原页）双模式可选**：
  - 默认在网页边缘点击自定义 URL 协议直接静默拉起本地软件，**绝不新开标签页，浏览器稳稳留在原网页**。
  - 若希望 Chrome/Edge 全网每种协议只勾选一次“始终允许”，可在设置中切换为「同源中转（自动返回）」，拉起软件后自动关闭中转页并精准切回原网页，绝不残留标签页。
- **支持 `.reg` 注册表文件拖放/选择一键批量导入**：完美兼容 [url-protocol-manager](https://github.com/symudo/url-protocol-manager) 与 Windows `regedit` 导出的 `.reg` 文件（UTF-16LE / UTF-8），自动提取自定义 URL 协议、匹配常见软件 Emoji 图标，支持在预览页直接修改名称与追加协议参数。
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
