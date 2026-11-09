# ADR 001 · v0.4.0 Windows 桌面容器

状态为技术选型，待准入后实施。当前采用 **C. 独立浏览器界面和 Windows 启动器**，作为 v0.4.0 的可运行基线。保留 Node.js 桥接、现有 UI、原版 Canvas 嵌入和 stdio Codex 适配器。正式桌面版本仍需完成下文的准入验证。

| 维度 | Electron | Tauri 2 | 浏览器与启动器 |
| --- | --- | --- | --- |
| Windows 兼容性 | 随包 Chromium，渲染引擎可随版本固定。需要验证目标 Windows 构建及 GPU 驱动。 | 依赖 Windows WebView2，需覆盖运行时安装、更新和不同部署方式。 | 使用现有系统默认浏览器。有头 Edge 已有回归基准。 |
| 开发复杂度 | JS 主进程能复用 Node 桥接。新增受隔离的 renderer、生命周期、IPC 安全和安装流程。 | 保留 Node 需 sidecar 或另行分发 Node，新增 Rust 外壳、权限配置和子进程管理。 | 已实现，维护现有 CMD、Node 服务和浏览器入口。 |
| 内存占用 | Chromium 与 Node 多进程，预计独立运行开销较高。 | 系统 WebView2 加 Node sidecar，需分别测空闲和任务负载。 | 依赖浏览器是否已启动及标签隔离。当前有 Edge V8 堆证据。 |
| Canvas GPU 加速 | Chromium Canvas 可复用，需在有头安装包上复测透明度和 GPU 合成。 | WebView2 上需独立测量同等画质、驱动与呈现路径。 | 保留现有 Edge 画布、自动档和 1080p A/B 复测。 |
| 进程管理 | 主进程可持有 Node 服务与 App Server 的生命周期。 | Rust 外壳需管理 Node sidecar，再由 Node 管理 Codex。 | 启动器拥有 Node，Node 负责 stdio、连接关闭和端口释放。 |
| 本地 Codex CLI | Node 主进程可继续用当前绝对路径解析和 stdio。 | 仍由 Node sidecar 使用当前路径解析和 stdio。 | 复用进程级 `CODEX_BIN` 与 Schema 探测。 |
| 系统托盘 | `Tray` API 可实现，需定义关闭窗口和退出的行为。 | 框架提供系统托盘，仍需和 sidecar 生命周期联动。 | 当前无独立托盘。 |
| 透明悬浮窗口 | `BrowserWindow` 提供透明窗口能力，需原型验证置顶、输入和 GPU。 | 需验证 Windows WebView2 透明合成、拖动和命中区域。 | 当前浏览器入口无系统级透明悬浮窗口。 |
| 打包尺寸 | 随包 Chromium 和 Node，预计体积最大。 | 外壳较轻，完整尺寸取决于 WebView2 分发方式和 Node sidecar。 | 当前 Windows ZIP 由应用源码和原版资源组成，系统另装 Node 与浏览器。 |
| 维护成本 | Electron 安全更新、安装包、签名和 IPC 回归。 | Rust、Windows 安装器、WebView2 版本与 sidecar 更新。 | 现有 Node 22/24、Windows ZIP 和 Edge 回归。 |

框架体积、内存、驱动与透明窗口成本是待原型验证的判断。 [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) · [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security) · [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) · [Tauri 架构](https://v2.tauri.app/concept/architecture/) · [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/) · [Tauri 托盘](https://v2.tauri.app/learn/system-tray/) · [Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)

## 边界与准入

- 当前浏览器壳继续使用回环、同源和操作令牌。未来若托盘或透明置顶成为硬需求，优先做 Electron 小样。启用上下文隔离和 renderer 沙箱，保持 Node 特权在主进程，限制导航和 IPC 能力，沿用同一桥接和审批策略。
- 产品侧复测安装、重复启动、关停、多个标签页和原版 1080p Canvas。在支持的 Windows 环境上验证命令回显、人工审批和中断。桌面壳需单独证明浏览器或 renderer 无法绕过作用域与票据校验。
- 上游侧需要授权后的候选 CLI 隔离验证，以及普通只读沙箱执行的实机证据。应用的离线成熟度与沙箱兼容性分别评估。 [本版验收](VERIFICATION.md) · [CLI 兼容性](SANDBOX.md)
