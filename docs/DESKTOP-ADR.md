# ADR 001 · Windows 桌面容器

v0.4.0-alpha.1 采用 Electron 45.2.3，Windows x64 便携分发。浏览器模式仍有独立入口和 ZIP。

| 维度 | Electron | Tauri 2 |
| --- | --- | --- |
| 后端复用 | 随包 Node，utility process 可直接导入现有桥接，仍用 stdio 启动已安装 CLI。 | Rust 壳需额外分发 Node sidecar，并处理 Rust、Node 和 CLI 三段生命周期。 |
| Canvas 与 Windows | 固定 Chromium 156，便于按版本检查 Canvas 和 DPI。透明合成有额外 GPU 成本。 | 复用 HTML Canvas，WebView2 的版本、硬件加速和透明合成需要单独采样。 |
| 托盘与悬浮 | 原生 Tray，透明 BrowserWindow。拖动使用窗口区域，独立缩放柄调用原生窗口边界。 | 托盘可用，Windows WebView2 透明窗口和输入命中仍需要实机原型。 |
| 安全 | Electron 主进程与 utility process 可信，renderer 隔离、沙箱化、限制网络与 IPC。Chromium 随版本更新。 | Tauri Capabilities 可限权，另需限制 Node sidecar 的参数和运行环境。 |
| 大小与依赖 | Chromium、Node 和 DLL 随包，包体与运行内存都需测量。用户无需安装 Node。 | 外壳体积更小，仍要考虑 WebView2 和 Node 的可用性、分发尺寸及维护。 |

选择 Electron 是为了固定渲染引擎并复用现有 Node 进程模型。透明窗口默认上限 30 FPS，主窗口隐藏时显式停止 Canvas，悬浮窗隐藏时销毁。Electron 的实际资源开销由独立报告记录。 [性能报告](DESKTOP-PERFORMANCE.md) · [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) · [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)

## 准入记录

1. **Stage 0 VERIFIED**。干净的 `main` 和 `v0.3.3-rc.1` 指向 `9b0b5c5`。基线 23 项测试、原文件哈希、浏览器 ZIP 可重建及中文空格路径启动通过。
2. **Stage 1 VERIFIED**。Windows 11 原型启动独立 Electron 窗口、加载现有 UI 并完成 Canvas 绘制，随后关闭。DPR 为 1.5，Canvas 后备缓冲为 837 × 583，样本约 16.4 FPS（待机上限 20 FPS）。初次窗口受遮挡时未取得可见帧，前台重试通过。
3. **Stage 2 VERIFIED / MOCK VERIFIED**。独立 worker 就绪后加载页面，端口冲突时拒绝启动。未授权请求和只读能力读取控制台被拒绝，桌面 HTML 无操作令牌。模拟场景可用，关闭后回环端口和 worker 已释放。通过后接入托盘与悬浮窗。

普通 Windows 沙箱执行单独验收。桌面原型的通过没有改变现有浏览器启动器的角色。 [总验收](VERIFICATION.md) · [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security) · [透明窗口行为](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#transparent-windows)
