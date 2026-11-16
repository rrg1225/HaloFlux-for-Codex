# v0.4.0-beta.1 Electron 进程与生命周期

桌面应用拥有一个 Electron 主进程、主窗 renderer、按需创建的悬浮窗 renderer、GPU 进程、Chromium utility 进程和一个 Node Bridge utility process。连接已安装的 CLI 后，由 Node Bridge 启动自己的 Codex App Server。可见性、预算和托盘操作都由主进程管理，桥接在这些状态之间持续运行。

正常退出合并重复关停请求。退出检查在 worker 暂停接收新轮次，活动任务可继续后台运行、等待结束，或者在用户选择且任务支持时先中断。关停先让 SSE 收到 EOF，再走 App Server 的原有关闭路径。清理只使用本次持有的进程句柄。托盘和窗口异常诊断分别处理未知终态及界面恢复。 [架构](ARCHITECTURE.md)

## 资源统计口径

- Windows working set 描述各 PID 的驻留页。跨进程求和可能重复计入共享页，不能用作应用独占 RAM。
- Windows Private Bytes 采用 `Get-Process` 的 `PrivateMemorySize64`。这是进程私有提交量，可能包含非驻留页。
- Electron CPU 百分比采用采样窗的 `app.getAppMetrics()`。主进程和 worker 的 Node heap 来自 `process.memoryUsage()`，renderer JS heap 来自 Chromium 的采样接口。GPU 和 Rust App Server 的 JS heap 不适用。
- Canvas 缓冲区以实际像素尺寸记录，专用显存为 **UNKNOWN**。Chromium GPU 光栅、合成及呈现事件时间另见[性能报告](DESKTOP-PERFORMANCE.md)。

## 进程分布

以下为首轮诊断中 73 个双窗阶段样本的中位数。该轮捕捉到了高 DPI 尺寸漂移，图形资源使用随尺寸变化。Utility 数值是单进程样本，通常有两个 Chromium utility。

| 进程 | working set | Private Bytes | JS heap | CPU |
| --- | ---: | ---: | ---: | ---: |
| Electron 主进程 | 108 MiB | 41 MiB | 8.2 MiB | 0.018% |
| 主窗 renderer | 257 MiB | 184 MiB | 13.5 MiB | 0.445% |
| 悬浮窗 renderer | 183 MiB | 103 MiB | 9.0 MiB | 0.483% |
| GPU | 789 MiB | 753 MiB | — | 4.828% |
| Chromium Utility | 53 MiB | 10 MiB | — | 0.001% |
| Node Bridge | 81 MiB | 76 MiB | 7.3 MiB | 0.005% |

双窗阶段的 GPU 进程 Private Bytes 介于 568 与 932 MiB。仅托盘阶段的中位数为 310 MiB，主 renderer 约 172 MiB。GPU 进程的 Private Bytes 统计的是 Windows 私有提交量。Renderer JS heap 是 Chromium 采样估计。 [长时间稳定性](DESKTOP-SOAK.md)

2026-11-11 DPI 修复后的 72 轮复验在置顶修复前进行。双窗、主窗最小化、托盘 Private Bytes 中位数为 1046、903、613 MiB。相同阶段的 Working Set 中位数为 1349、1235、840 MiB，总 CPU 中位数为 5.92%、4.99%、0.023%。双窗主窗和悬浮窗 Renderer CPU 分别为 0.514% 和 0.604%，GPU 进程为 4.850%。退出后观测到的 75 个所属 PID 全部结束，监听端口释放。 [DPI 修复后分段趋势](DESKTOP-SOAK.md)

最终置顶修复后的 72 轮复验中，双窗、主窗最小化、托盘 Private Bytes 中位数分别为 1067、941、652 MiB。Working Set 分别为 1450、1320、934 MiB，总 CPU 为 5.952%、5.830%、0.015%。双窗 Renderer CPU 分别为 0.506% 和 0.533%，GPU 进程为 4.892%。77 个观测 PID 全部退出，监听端口释放。 [最终分段趋势](DESKTOP-SOAK.md#最终代码完整复验)

已安装的 0.162.0 App Server 在隔离无模型握手时为 40.5 MiB working set、17.2 MiB Private Bytes，2.20 秒观测窗消耗 0.016 秒进程 CPU 时间。握手后关闭主窗，所属 CLI、桥接和 HTTP 监听均退出。

## 生命周期验收

| 操作 | 状态 | 结果 |
| --- | --- | --- |
| 启动、无效工作区和回环端口占用 | VERIFIED | 应用使用独立端口，启动失败路径释放本次 worker。 |
| 最小化、恢复、关闭到托盘、悬浮窗开关 | VERIFIED | 隐藏主窗暂停绘制。主窗或托盘恢复界面。150% DPI 下 20 次重开和独立进程重启，读回边界一致。 |
| 透明度、置顶、拖动区、调整尺寸、点击穿透与复位 | VERIFIED | 原生窗口与 Canvas 透明像素检查通过。托盘复位恢复交互，边界夹取覆盖负坐标的合成输入。 |
| 主窗及悬浮窗 renderer 崩溃 | MOCK VERIFIED | 桥接保持运行。两窗恢复时仍显示同一活动 Mock 轮次。 |
| Node Bridge 异常退出 | MOCK VERIFIED | 来源撤销，原 HTTP 端口关闭，主进程报告未知终态。 |
| 活动任务退出 | MOCK VERIFIED | 继续后台、等待、取消等待以及明确中断后退出通过。 |
| 审批、通知 | MOCK VERIFIED | 批准和拒绝通过，过期或重复票据被拒。Windows 确认呈现一次标明模拟的完成通知。 |
| 休眠与恢复分支 | MOCK VERIFIED | 注入 Electron suspend/resume，验证画布暂停和恢复。 |

真实任务退出、真实审批、系统物理休眠、混合 DPI 的物理多显示器交互、系统强制结束会话为 **NOT TESTED**。

## 验收入口

用已校验的 Electron 运行 `scripts/test-desktop.cjs`，分别覆盖实际窗口、托盘、renderer 崩溃、桥接异常、模拟审批及活动任务退出。使用 `--handshake` 仅运行已安装 CLI 的无模型连接，并检查所属 App Server 和监听端口退出。使用 `--balloon` 单独测原生 Mock 通知。

发行物测试 `scripts/test-desktop-package.mjs` 从中文空格路径启动实际 EXE。按 PID、创建时间及映像路径确认所属进程退出，同时保持脚本创建的独立 Node 进程存活。 [长时间稳定性](DESKTOP-SOAK.md) · [Beta 验收](VERIFICATION.md)
