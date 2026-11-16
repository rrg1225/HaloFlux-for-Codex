# HaloFlux for Codex

[English](README.md)

HaloFlux for Codex 是非官方、非商业的 Windows Codex 桌面伴侣。它用原版 HaloFlux Canvas 光环展示 Codex 任务状态，并提供本机任务详情和人工审批界面。

## 功能

- **HaloFlux 光环**。节拍驱动的光场核心、旋转数据环和多层光束来自 Ryder191 的原版 HaloFlux。Codex 和模拟事件驱动颜色、运动与粒子的变化。界面可调整构图、缩放和效果。
- **桌面主窗口、悬浮窗和托盘**。主窗处理任务和审批，可选透明悬浮窗显示只读状态，支持置顶和点击穿透。托盘可恢复主窗、复位悬浮窗或退出，桌面设置提供四档渲染预算。
- **实时 Codex 和模拟演练**。实时模式通过本机安装的 Codex CLI 新建或恢复线程、启动或中断任务，以及查看待审批请求提供的决定。模拟模式可演练成功、失败和审批流程，无需 Codex 账户。
- **环境诊断**。健康面板可查看 CLI、协议和渲染状态，并导出脱敏报告。

## 从源码运行

安装 Git 和 Node.js 22 或更新版本。Node.js 附带 npm。项目没有 npm 依赖，克隆后即可启动浏览器桥接。

```powershell
git clone https://github.com/rrg1225/HaloFlux-for-Codex.git
cd HaloFlux-for-Codex
npm.cmd start
```

打开 [http://127.0.0.1:4637](http://127.0.0.1:4637)，选择「模拟演练」。按 Ctrl+C 停止服务。也可以在 Windows 中运行 `Start-HaloFlux.cmd` 自动打开浏览器，在启动器输入 `Q` 并回车即可关停。 [浏览器启动及工作区选项](docs/WINDOWS.md)

使用实时模式时，单独安装官方 Codex CLI 并执行 `codex login`。在 HaloFlux 主界面选择「实时 Codex」，再点「连接 Codex」。创建或恢复线程后提交任务。决定是否批准前，请查看请求中的命令、权限或文件补丁。 [审批与会话安全](docs/SECURITY.md)

## 构建 Windows 桌面 Beta

获取官方运行时 `electron-v45.2.3-win32-x64.zip`。构建脚本会使用 `scripts/desktop-runtime.json` 中固定的 SHA-256 校验运行时。以下命令假设该 ZIP 位于当前目录。 [Electron 运行时](https://github.com/electron/electron/releases/tag/v45.2.3)

```powershell
npm.cmd run check:source
npm.cmd run build:desktop -- -ElectronArchive '.\electron-v45.2.3-win32-x64.zip'
```

脚本在 `dist/` 生成 Windows x64 便携 ZIP 和 SHA-256 校验文件。核对摘要并完整解压后，运行 `HaloFlux.exe`。本地构建的便携包包含 Electron、Chromium 和 Node.js，默认进入模拟模式。 [桌面使用指南](docs/DESKTOP-WINDOWS.md)

## 架构

浏览器版使用监听回环地址的 Node.js 桥接，通过 SSE 向页面推送任务状态。连接实时模式时，桥接启动本机 Codex App Server，并通过 stdio JSON-RPC 通信。Electron 版在 utility process 中运行同一桥接，主窗口走回环连接，悬浮窗通过 IPC 获取限定字段的只读状态。 [架构详解](docs/ARCHITECTURE.md)

## 验证环境和已知限制

v0.4.1-beta.1 的验收覆盖 Windows x64、150% 显示缩放、Electron 45.2.3 和 Node.js 24.13.0 源码检查。前一桌面 Beta 的 Windows 11 25H2 x64 验收覆盖 Node.js 22.13.1、24.13.0，以及 Edge 157.0.4341.46 的模拟浏览器冒烟测试。已安装的 Codex CLI 0.162.0 通过了 Schema 和无模型握手检查。 [验收记录](docs/VERIFICATION.md)

- 固定画质双窗口性能门槛仍未达标。本版以短采样比较不同渲染优先策略。
- Windows 沙箱 Error 32 仍未解决，候选 Codex CLI 0.163.0 的实机隔离对照尚未执行。 [CLI 兼容性](docs/SANDBOX.md)
- v0.4.1-beta.1 的真实 Codex E2E 任务和真实审批尚未验证。
- Windows 桌面客户端仍为 Beta，本地发行包内的应用未签名。

## 署名和许可证

原版 HALOFLUX 及其视觉设计由 **Ryder191（RYDER CODE / Ms MAIKEBAIs CAT）**创作。Codex 适配与新增开发由 **Li Xian（李显）**完成。原版独立演示可通过 `index.html` 打开。 [HALOFLUX 原始仓库](https://github.com/Ryder191/haloflux)

本项目采用 **PolyForm Noncommercial License 1.0.0**，商业使用受许可证限制，再分发须保留原始版权与 Required Notice。随附音乐《Synthwave 421k》由 The Cynic Project（cynicmusic）创作，按 CC0 分发。 [许可证](LICENSE) · [Required Notice 和第三方署名](NOTICE.md)

HaloFlux for Codex 是独立开发的衍生项目。Codex 是 OpenAI 的产品。

[更新日志](CHANGELOG.md) · [安全政策](SECURITY.md)
