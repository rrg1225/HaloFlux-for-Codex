# v0.4.0-alpha.1 Electron 性能

Electron 采样由 `scripts/test-desktop.cjs` 执行。Canvas FPS 和 P95 来自原绘制链路的真实提交间隔。CPU 是 Electron 进程组的总采样占用率，内存是各进程 Windows working set 之和，可能重复计入共享页。GPU 用 Chromium feature status 和设备信息记录。

Windows 11 25H2 的显示区为 1707 × 1067 DIP，缩放 150%。主窗口客户区分别取 1280 × 720 和 912 × 512 DIP，约 1920 × 1080 和 1368 × 768 像素。双窗、仅主窗口、仅悬浮窗和托盘场景使用同一活跃 Mock 轮次。每场景热身 2.3 秒，随后采样 4.7 秒。

| 场景 | 绘制 FPS 样本范围 | P95 帧间隔范围 | 进程组 CPU | 合计 working set |
| --- | --- | --- | ---: | ---: |
| 主窗 1920 × 1080 | 59.8–60.0 | 27.1–29.4 ms | 6.10% | 1167 MiB |
| 主窗约 1366 × 768 | 59.7–59.7 | 22.1–25.4 ms | 6.05% | 1255 MiB |
| 双窗，主窗 1920 × 1080 | 主窗 20.9–30.1，悬浮窗 19.8–20.1 | 主窗 41.7–55.6 ms，悬浮窗 51.5–85.0 ms | 6.03% | 1536 MiB |
| 仅悬浮窗 | 30.0–30.0 | 33.8–34.1 ms | 3.77% | 1425 MiB |
| 仅托盘 | 主窗样本保持不变 | — | 0.016% | 1027 MiB |

首轮双窗分别配置 60 和 30 FPS，实际均约 19–25 FPS。复测的双窗自动档分别限制为 30 和 20 FPS，悬浮自动档的后备 DPR 上限降至 1。两个窗口共用 Chromium GPU 进程。双窗末的 GPU 进程 working set 约 795 MiB，托盘时约 552 MiB。透明合成和同时绘制与下降相关，尚无 GPU trace 可以拆分两者的因果成本。

12 次悬浮窗创建和销毁中，主窗可见时每四轮的 working set 为 1236、1282 和 1292 MiB。之后隐藏主窗并等待 5.5 秒，进程数从 8 回到 6，合计约 1041 MiB，接近之前的托盘样本 1027 MiB。Chromium 报告 Canvas 2D、GPU 合成和光栅化启用。设备信息列出 Intel、NVIDIA 与 Microsoft 渲染适配器，未确认具体活跃设备。多小时驻留、专用 GPU 内存和与 Edge 的同机配对仍为 **NOT TESTED**。

桌面版作为可选 Alpha 交付，浏览器启动方式独立保留。证据位于工作区 `output/desktop/final/desktop.json`。 [历史 Edge 采样](PERFORMANCE.md)
