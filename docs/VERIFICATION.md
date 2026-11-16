# HaloFlux for Codex v0.4.1-beta.1 验收

2026-11-16（UTC+8），基于本地 `v0.4.0-beta.1` 的 `2600172b95aca76f26b147e69d33e0babe451105`。Windows x64、150% 缩放、Electron 45.2.3。测试采用短采样及针对性回归。记录位于工作区 `output/desktop/v041/`。

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 原生窗口、Canvas、预算 | VERIFIED | 两版各采样三种优先级。主窗优先主窗 26.76 FPS，次要悬浮窗 8.00 FPS。悬浮窗优先的失焦主窗 0 FPS，悬浮窗 30.01 FPS，两窗可见。均衡 23.60 / 12.00 FPS。 [测法和对照](DESKTOP-PERFORMANCE.md) |
| 任务、审批与恢复 | MOCK VERIFIED | 两窗保持同一待审批状态，最小化与恢复期间仍持有待审轮次。批准和拒绝后重复票据均被拒。一条主窗 SSE，悬浮窗只用 IPC。关闭悬浮窗销毁 renderer，重新打开仍置顶。 |
| 分数 DPI | VERIFIED | 切换优先级时原生边界不变，两次重开尺寸一致，保存的逻辑宽高保持 420 × 350 DIP。在 150% 缩放下，托盘复位与重新创建的 Windows 读回分别为 420 × 351 与 422 × 354 DIP。 |
| 源码模式安全与退出 | VERIFIED / MOCK VERIFIED | 顶层凭据、Canvas 操作拦截、悬浮只读、外部导航拒绝、托盘退出、进程和端口释放。Node 24.13.0 上 26 项通过，106 个源清单条目及 11 个原版文件哈希通过。 |
| 最终桌面 ZIP 托盘退出 | PACKAGED_TRAY_EXIT = VERIFIED（人工原生操作） · Gate F = PASS | 用户在 Windows 通知区通过 HaloFlux 托盘菜单执行「退出应用」。PowerShell 前后快照确认所属进程退出、监听端口释放，独立进程仍在运行。 |
| 当前 Codex CLI | VERIFIED | 已安装 0.162.0 的 Schema 和无模型握手通过，原生桌面握手退出后所属 CLI、桥接和端口释放。 |
| Windows 沙箱 Error 32 | UPSTREAM_BLOCKED | 引用普通 Windows 沙箱的历史执行记录。 [兼容报告](SANDBOX.md) |
| 候选 Codex CLI 0.163.0 实机测试 | BLOCKED_BY_APPROVAL | 下载、执行及隔离对照待授权。 [兼容报告](SANDBOX.md) |
| 真实 Codex E2E | NOT TESTED | 有授权门控的真实桌面测试入口。无授权路径已核验，模型调用与文件审批均未运行，状态为 `REAL_E2E_NOT_TESTED`。Gate C 的真实任务条件仍待确认。 |
| 固定画质双窗性能目标 | FAILED | 沿用历史固定双窗性能门槛结果。本版短测比较了渲染策略，同画质、同渲染预算的性能复测未运行。 |

## v0.4.1-beta.1 桌面 ZIP 托盘验收

2026-11-16（UTC+8），用户从最终 Windows 桌面候选 ZIP 启动 HaloFlux，在 Windows 通知区右键 HaloFlux 托盘图标并选择「退出应用」。用户提供的 PowerShell 退出前后进程和端口快照显示，退出前有 9 个属于本次启动的相关进程。退出后 `survivingProcesses = []`、`remainingListeners = []`、`missingIndependentProcesses = []`。Bridge PID `30792` 和 Codex PID `15128` 均已退出，监听端口 `127.0.0.1:51047` 已释放。人工原生验收结果为 `PACKAGED_TRAY_EXIT = VERIFIED`，`Gate F = PASS`。

两个 ZIP 及各自的 `.sha256` 文件从 `output/desktop/v041/build-a/` 原样复制到 `dist/`。两个 ZIP 的 SHA-256 均与 `build-b/` 的独立构建及解包验收候选一致。逐文件比对覆盖桌面包 65 个源清单条目和浏览器包 106 个源清单条目，唯一差异是随包的 `docs/VERIFICATION.md` 为构建时快照，最终人工验收以仓库中的本页为准。HaloFlux 许可证和 Required Notice 随两包分发，桌面包同时包含 Electron 及 Chromium 组件的许可证文件。

### 原生托盘自动化记录

上轮 `packaged-desktop-retry.log` 记录 Windows 已为解包的 `HaloFlux.exe` 登记托盘图标。脚本向 Electron 通知窗口发送模拟消息后，等待「退出应用」超时。该记录只确认图标登记和定位超时。

此前原生交互脚本首次在切换实时模式时遇到 UI Automation InvokePattern 不受支持。一次复验改用鼠标点击，成功完成 CLI 0.162.0 的无模型握手。App Server 进程检查使用了符号链接路径做精确匹配，而应用在启动 CLI 前会解析真实路径。进程匹配未通过，脚本在右键托盘之前终止。两个运行记录位于 `output/desktop/v041/tray-gate-native/desktop.json` 和 `output/desktop/v041/tray-gate-native-retry/desktop.json`，用时分别为 12.89 和 11.33 秒。失败后由测试执行进程清理，自动化记录维持当时的 `PACKAGED_TRAY_EXIT_UNVERIFIED`。这些失败保留为测试工具限制。

## v0.4.0-beta.1 历史验收

交付复验于 2026-11-11（UTC+8）在 Windows 11 25H2 x64 上进行。Electron 45.2.3、Chromium 156.0.8078.80、随包 Node 24.22.2。基线是 `feature/desktop-v040-beta1` 分支起点 `6e17909`，与本地 `v0.4.0-alpha.1` 一致。

2026-11-16 收尾时有 29 个已跟踪修改及 4 个未跟踪文件。`runtime-topfix.sha256` 中的应用与测试夹具均与收尾时的工作区匹配，因此沿用 2026-11-11 的运行时验收。收尾时的源清单检查通过 106 个发布路径、11 个原版文件的哈希及许可证、署名、语法和凭据模式检查。历史 Alpha 验收和代码保存在 `v0.4.0-alpha.1` 标签。

## 测试记录

应用与夹具的 SHA-256 清单保存在工作区 `output/desktop/beta1/delivery-20261111`。置顶修复前的 `runtime-and-fixtures.sha256` 摘要为 `ae588707717a5414f0807b98aebff0bfb58169c539a258e0a9f66318c55de0d2`，修复后的 `runtime-topfix.sha256` 摘要为 `3936b899324ac7bb759c2685969c11f1c15c0ec3ab6f60bb66497d7b6693115e`。日期未单列时为 2026-11-11，时间均为 UTC+8。

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| Node.js v22.13.1 和 v24.13.0 | VERIFIED / MOCK VERIFIED | 15:11 首测和 16:16 置顶修复后复测，两个运行时均通过 26 项。包括桥接、SSE 重连、协议和模拟审批。 |
| 已安装 CLI 0.162.0 | VERIFIED | 15:12:43–15:12:45，通过 Schema、审批响应能力检查、隔离 App Server 握手和关停，模型调用为 0。 |
| 150% DPI 原生窗口 | VERIFIED / MOCK VERIFIED | 最终代码 16:13:06–16:13:18。连续 20 次重开与独立进程重启，置顶、几何、双窗状态与唯一 SSE 均经断言。移动使用 `setPosition()`，缩放使用产品 IPC。 |
| 100% 与 125% DPI | VERIFIED（置顶修复前原生） / MOCK VERIFIED（最终代码） | Windows 原生两档均曾完成 20 次重开及重启。最终复验的系统设置操作受桌面输入打断，使用 Electron 的进程级缩放覆盖补测两档。 |
| 桌面生命周期与审批 | VERIFIED / MOCK VERIFIED | 最终代码 16:48:55–16:49:51。隔离、透明像素、点击穿透恢复、托盘、活动任务退出、桥接异常和双 Renderer 崩溃恢复通过。同一 Mock 审批票据恢复后第一次决定成功，重复提交被拒，SSE 为一条。 |
| 桌面 CLI 握手与 Windows 通知 | VERIFIED / MOCK VERIFIED | 最终代码 16:49:51–16:50:02。隔离无模型 App Server 握手，主窗关闭释放所属 CLI、worker 和监听。另一次测试由 Windows 托盘报告呈现标记为“模拟”的完成通知。 |
| Edge 157.0.4341.46 | VERIFIED / MOCK VERIFIED | 15:53:04–15:56:34，无头冒烟、SSE 重连、模拟审批、双标签 12 次刷新、24 次切换与 120 秒驻留。所属 Edge 进程清理。 |
| Edge 独立原生窗口可见性 | FAILED | 15:58 后的原生后台探针将一个窗口最小化后，两个文档均报告 `hidden`，前窗可见性断言超时。该回归的原因待查。 |
| 尺寸匹配的多窗口矩阵 | VERIFIED | 2026-11-09 18:49–18:55，修复后的 50 个常规样本和 3 个独立 trace 完整写入。主窗固定客户区 1280 × 720 DIP，悬浮窗固定 420 × 350 DIP。 |
| DPI 修复后的 30 分钟耐久 | VERIFIED / MOCK VERIFIED | 15:19–15:49，1810.8 秒、72 轮、216 个样本。每个样本一条 SSE，持有的 Mock 轮次连续，悬浮窗重开稳定，托盘释放缓冲。75 个观测 PID 和回环监听已清理。此轮早于置顶修复。 |
| 最终代码 30 分钟耐久 | VERIFIED / MOCK VERIFIED | 16:13–16:43，1821.7 秒、72 轮、216 个样本。始终一条 SSE，Mock 任务连续，尺寸稳定，托盘释放缓冲，77 个观测 PID 和端口清理。 |
| 连续流畅性 | VERIFIED（最终采样） | 最终长测最大 409.7 ms。置顶修复前曾捕捉到 5.35 秒与 4.16 秒绘制间隔，原因未确认。固定画质 FPS 仍为 FAILED。 |
| 固定画质 FPS 优化目标 | FAILED | 最终矩阵双窗中位数 11.34 / 11.31 FPS，暂停悬浮绘制后主窗回到 21.02 FPS。最终四档预算约 11.6–12.5 FPS。此前矩阵与预算样本保留在性能报告。 |
| 原版完整性与署名 | VERIFIED | 11 个原版文件通过 SHA-256；原版权限条款、Required Notice、Ryder191、Li Xian（李显）与第三方许可证保留。 |
| 普通 Windows 沙箱 Error 32 | UPSTREAM_BLOCKED | 引用已安装 CLI 0.162.0 的历史执行记录。此次仅复验协议和无模型握手。 |
| 候选 Codex CLI 0.163.0 | BLOCKED_BY_APPROVAL | 下载和执行待授权，兼容性待实测。 |
| 真实模型、审批与任务退出 | NOT TESTED | 模拟场景与隔离握手是此次验收范围。 |
| 物理休眠与混合 DPI 多显示器 | NOT TESTED | 测试注入了 suspend/resume 事件。实际休眠、多显示器、Windows ARM64 和其他 Windows 版本仍待覆盖。 |

## DPI 证据

历史缺陷在 150% 下将 422 DIP 的宽度累积到 726 DIP。Beta 记录请求尺寸与原生位置变化。下列各档均通过 20 次重开与独立进程重启，所有测试的保存请求尺寸均为 471 × 383 DIP。原生设置复验后，Windows 缩放确认为 150%。

| Windows 缩放 | 时间 UTC+8 | DSF / DPR | 保存与读回位置 DIP | 外窗读回 DIP | `dipToScreenRect` px | Canvas 后备 px |
| --- | --- | --- | --- | --- | --- | --- |
| 100% 原生，置顶修复前 | 15:56:36–15:56:48 | 1 / 1 | `(2020, 64)` | 471 × 383 | 471 × 383 | 471 × 383 |
| 125% 原生，置顶修复前 | 15:57:13–15:57:25 | 1.25 / 1.25 | `(1508, 64)` | 472 × 384 | 590 × 480 | 590 × 480 |
| 150% 原生，最终 | 16:13:06–16:13:18 | 1.5 / 1.5 | `(1167, 64)` | 475 × 386 | 713 × 579 | 711 × 579 |
| 100% 进程缩放覆盖，最终 | 16:51:46–16:51:59 | 1 / 1 | `(2020, 64)` | 471 × 383 | 471 × 383 | 471 × 383 |
| 125% 进程缩放覆盖，最终 | 16:52:12–16:52:23 | 1.25 / 1.25 | `(1508, 64)` | 472 × 387 | 590 × 484 | 590 × 484 |

较早的两次补测分别在位置跳变和主窗不可见时停止。两次失败样本已保留。后续 20 次连续重开以同一位置完成，位置异常的来源仍未确认。

## 原生置顶回归

置顶修复前，解包验收发现默认悬浮窗已创建但被主窗遮挡。Canvas 自身能绘制，Windows 原生窗口命中仍落到主窗。隔离对照在同一 Electron 上测了原默认层级、去掉原生透明度参数、普通显示、重新应用默认层级和 `pop-up-menu`。只有最后一种在重叠区域获得原生窗口命中并显示置顶标志。Beta 在悬浮窗显示后应用该层级，也在用户修改透明度时重应用置顶设置。关闭置顶继续回到普通窗口层级。 [Electron 置顶层级](https://www.electronjs.org/docs/latest/api/base-window#winsetalwaysontopflag-level-relativelevel)

早期解包探针的环境变量没有覆盖 Electron 的 Windows 用户目录路径，启动时为 HaloFlux 创建了默认目录。最终解包探针传入独立 `--user-data-dir`，并检查偏好实际写入测试目录。 [打包探针](../scripts/test-desktop-package.mjs)

## Windows 发行物

桌面 ZIP 为 `HaloFlux-for-Codex-v0.4.0-beta.1-windows-x64-desktop.zip`，浏览器 ZIP 为 `HaloFlux-for-Codex-v0.4.0-beta.1-windows.zip`。每份 ZIP 对应同名 `.sha256`。桌面为未签名 x64 便携包。2026-11-16 的构建日志、哈希对照和最终 ZIP 解包记录见工作区 `output/desktop/beta1/final-20261116/`。2026-11-11 的归档记录保存在原有交付目录。Alpha 发行物与标签可用于回退。 [桌面启动](DESKTOP-WINDOWS.md) · [浏览器启动](WINDOWS.md)

## v0.5.0 准入

| 维度 | 评估 |
| --- | --- |
| 桌面工程成熟度 | Windows x64 单显示器条件下，便携包、150% 原生 DPI、托盘与进程生命周期具备 Beta 交付条件。100% 和 125% 最终原生复验、真实多显示器和休眠待测。 |
| 双窗口性能 | **FAILED**。最终固定双窗约 11–13 FPS，未达优化目标。最终长测未再出现秒级绘制间隔，历史样本仍保留。 |
| 安全与稳定性 | 回环与 IPC 权限、模拟审批、缓冲释放、进程清理和崩溃恢复已验证。未签名包依赖来源及 SHA-256 核对。新的 Electron 补丁需单独验收。 |
| Codex 上游兼容性 | 0.162.0 协议与握手通过。普通 Windows 沙箱为 **UPSTREAM_BLOCKED**，候选 CLI 为 **BLOCKED_BY_APPROVAL**，真实模型与审批为 **NOT TESTED**。 |

整体暂缓 v0.5.0 准入，优先处理双窗长帧和秒级间隔，补齐 Windows 沙箱兼容性实测。

[使用说明](DESKTOP-WINDOWS.md) · [性能报告](DESKTOP-PERFORMANCE.md) · [耐久测试](DESKTOP-SOAK.md) · [进程与资源](DESKTOP-PROCESSES.md) · [安全审查](DESKTOP-SECURITY.md) · [沙箱兼容性](SANDBOX.md)
