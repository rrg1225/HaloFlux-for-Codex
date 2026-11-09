# HaloFlux for Codex v0.3.3-rc.1 验收

2026-11-09（UTC+8），本地 Windows 11。运行时为 Node.js 22.13.1 和 24.13.0，本轮浏览器为 Edge 157.0.4341.42。1080p 配对使用 11 月 8 日的 Edge 156 记录。 [v0.3.2 历史验收](VERIFICATION-v0.3.2.md) · [v0.3.1 历史验收](VERIFICATION-v0.3.1.md) · [v0.2 历史验收](VERIFICATION-v0.2.md)

## 中断恢复

恢复时 `main` 只有导入提交 `65a2ac9` 和 `v0.3.2-beta.1` 标签。31 个已跟踪文件有修改，另有 12 个未跟踪文件。原修改在原工作区继续完成。备份清单的 174 个文件重新通过 SHA-256，v0.3.2 ZIP 的 65 个条目逐一与导入前备份一致。基线保留了源文件，Git 导入时泛化历史沙箱报告的本机路径并增加仓库控制文件。恢复时已有 1080p A/B、双标签驻留和多次关停探针，`dist` 保存的是历史版本 ZIP。

## 关停与兼容性

早期报告记录了残留 Node 的活动管道。接手续测已带上既有的输入流销毁修复，Ctrl+Break 后 Node、监听与 App Server 均已退出。探针仍在等待 CMD 的原生批处理确认。输入 `Y` 后外壳退出，其非零退出码独立于桥接关停结果。

统一关停入口会拒绝新操作并结束打开的 SSE，取消诊断和 Schema 探针，清理计时器与信号监听器。对本次启动的 App Server 先送 stdin EOF，等待进程与 stdio 关闭，必要时只终止该子进程。进程验收在启动时核对 PID、父 PID、创建时间、映像路径和命令行，报告仅保留脱敏类型。活动模拟和异常退出另用夹具覆盖。 [Windows 使用说明](WINDOWS.md)

实际 CLI Schema 核对请求方法、参数引用、人工审查和禁网字段，并在临时 `CODEX_HOME` 发送 `initialize` 与 `initialized`。安装的 0.162.0 经默认 PATH 解析和显式中文空格路径均通过，模型调用为零。夹具覆盖安全字段缺失或错误关联、未知字段、握手错误、异常退出和实时模式降级后模拟仍可用。 [官方 App Server 协议](https://learn.chatgpt.com/docs/app-server) · [兼容状态和候选计划](SANDBOX.md)

## 发布验收

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 基线与发行内容 | VERIFIED | 原备份、旧 ZIP、11 个原版文件哈希、原 LICENSE、Required Notice 和新增署名核验通过。发布允许列表含 78 个条目，构建逐项核对压缩内容并扫描凭据模式和本机路径。 |
| 离线测试 | VERIFIED / MOCK VERIFIED | Node 22、24 各 23 项通过。真实回环 HTTP/SSE、鉴权、生产 JSONL、进程退出和 DPR 阈值经过测试。Codex 请求、审批和模拟数据使用夹具。两轮 8 秒 Node 压测关闭后夹具进程均为零，时间线最多 200 条。 |
| Windows 解压和关停 | VERIFIED | 在中文和空格目录解压，检查页面、模拟模式、CLI 缺失及无效路径提示、占用端口提示。连续五轮以 0.162.0 完成无模型握手，保持 SSE 打开后退出。每轮均核验 EOF、本次子进程归零和端口重新绑定。三轮用 `Q`，另两轮发出 Ctrl+C 或 Ctrl+Break 后确认 CMD 提示。 |
| 可重建 ZIP | VERIFIED | 两次独立构建比较 ZIP 字节的 SHA-256 和同名侧车。原 v0.3.2 ZIP 保留。 [构建和校验](WINDOWS.md) |
| Edge 浏览器与 Canvas | VERIFIED / MOCK VERIFIED | 有头冒烟、双标签 12 次刷新与 24 次切换、SSE 重连、后台恢复、DPR 阈值和真实比例切换。原生后台探针前两次遇到标签可见性或恢复超时，使用独立测试窗口后通过。保留已有 1080p 对照，补齐 1366 × 768、2560 × 1440 及触摸移动视口 DPR 3。 [性能数据和原始记录](PERFORMANCE.md) |
| 稳定性能提升 | FAILED | 1080p 自动档消除五次同尺寸重建，P99 从 68.9 降至 37.2 ms。固定档首窗对顺序敏感，移动自动档 P99 本轮上升 13.0 ms。短窗支持功能防回归，稳定收益和统计等效均未证实。 [配对数据](PERFORMANCE.md) |
| 0.162.0 普通 Windows 沙箱 | UPSTREAM_BLOCKED | 沿用此前原生 CLI 与 App Server 的 Error 32 实机证据。此次握手不涉及沙箱执行，也未再次触发 runtime 的 ACL 刷新。 [历史诊断](SANDBOX.md) |
| 0.163.0 候选二进制 | BLOCKED_BY_APPROVAL | 静态记录保留，下载、验签和实机运行待授权。 |
| 其余环境 | NOT TESTED | 真实模型轮次、真实审批和真实任务关停，Windows 强制终止与外部 SIGTERM 实机、默认浏览器关联、GitHub Actions 远程运行、物理触屏与长期 GPU 内存趋势。 |

工作区证据包括 `output/recovery-baseline-integrity.json`、`output/recovery-node-*.log`、`output/recovery-soak-*.json`、`output/recovery-shutdown-*.json` 及 `output/playwright/v033/recovery-*`。这些运行记录留在工作区，发行 ZIP 使用固定文件清单。

## v0.4.0 准入

- **应用工程**。本地浏览器版有可回退基线、可重建候选包、进程关停和离线回归。真实任务、审批和中断仍需在可用的沙箱环境验收。
- **Windows 上游环境**。0.162.0 协议兼容已确认，普通沙箱仍受历史 Error 32 阻塞。0.163.0 实机结果待授权。
- **桌面架构**。现有浏览器和 Windows 启动器作为可运行基线。Electron、Tauri 的桌面能力、分发与运行成本留在 ADR 比较，正式桌面壳准入暂缓。 [桌面化架构决策](DESKTOP-ADR.md)
