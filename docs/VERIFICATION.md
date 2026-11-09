# HaloFlux for Codex v0.4.0-alpha.1 验收

2026-11-09（UTC+8）。Windows 11 25H2（26200），Windows x64。Electron 45.2.3、Chromium 156.0.8078.80、随包 Node 24.22.2。桌面与浏览器分别验收。 [基线验收](VERIFICATION-v0.3.3.md)

| Gate | 状态 | 证据 |
| --- | --- | --- |
| A · 桌面启动 | VERIFIED | Windows 可见窗口加载既有 UI 并提交 Canvas。utility process 先取得操作系统分配的回环端口。 |
| B · 原有能力 | VERIFIED / MOCK VERIFIED | Node 22、24 各 23 项离线测试。有头 Edge 冒烟、双标签 12 次刷新、24 次切换和 120 秒驻留通过。安装的 0.162.0 完成核心 Schema、审批响应能力核对及隔离握手。命令与文件审批使用夹具。模型调用为零。 |
| C · 托盘与退出 | VERIFIED / MOCK VERIFIED | 设置、关闭到托盘、恢复窗口与退出通过。Mock 活动轮次验证继续后台、等待、取消等待及明确中断后退出。 |
| D · 悬浮窗 | VERIFIED / MOCK VERIFIED | Electron 透明 Canvas 像素、窗口拖动区域、DPI 缩放、置顶、透明度、点击穿透及托盘恢复经过探针。共享 Mock 实时状态。 |
| E · 安全 | VERIFIED | renderer 隔离、请求角色、令牌不进入桌面 HTML、IPC 校验、导航和新窗口限制通过。构建检查原始哈希、许可证与凭据模式。 |
| F · 性能 | VERIFIED（当前机器短测） | 主窗、双窗、悬浮窗、托盘、DPR 1.5 与两种原生客户区大小均完成 Electron 采样。双窗成本和显存相关待测项记录在报告。 |
| G · 便携发布 | VERIFIED | 138 个条目逐项核对，ZIP 与侧车一致，中文空格目录连续三轮启动和关闭成功。单实例锁生效，本次所属进程归零，外部 Node 仍存活。浏览器 ZIP 独立保留。 |

通知为 **MOCK VERIFIED**。审批、完成和失败经过固定文案检查，Windows 托盘报告一次 Mock 完成通知已呈现。系统通知策略可能改变实际呈现。

普通 Windows 沙箱 Error 32 为 **UPSTREAM_BLOCKED**，依据 v0.3.3 兼容报告中的历史实测。候选 CLI 0.163.0 的下载与执行为 **BLOCKED_BY_APPROVAL**。真实模型任务、真实审批、真实任务退出以及实际系统休眠为 **NOT TESTED**。 [沙箱边界](SANDBOX.md)

原版 11 个文件按基线 SHA-256 校验。原版作者 Ryder191、Codex 集成和新增开发者 Li Xian（李显）、PolyForm Noncommercial 1.0.0、Required Notice 以及 Electron 和 Chromium 许可证均保留。

[架构与准入](DESKTOP-ADR.md) · [桌面使用与已知问题](DESKTOP-WINDOWS.md) · [进程清理](DESKTOP-PROCESSES.md) · [安全审查](DESKTOP-SECURITY.md) · [性能数据](DESKTOP-PERFORMANCE.md)
