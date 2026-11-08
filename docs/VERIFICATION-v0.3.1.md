# HaloFlux for Codex v0.3.1-beta.1 验收

2026-11-08（UTC+8），Windows 11 25H2，Node.js 24.13.0，Edge 156.0.4314.58，npm Codex CLI 0.162.0。交付为 Windows 诊断版。两份历史 ZIP 保留各自的原始验收和性能记录。 [v0.2 历史验收](VERIFICATION-v0.2.md) · [性能报告](PERFORMANCE.md) · [沙箱报告](SANDBOX.md)

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 源码、版权与冻结基线 | PASS | 当前目录无 Git 元数据。保留两份原始 ZIP，独立解压并核对原版资产。两版原样离线测试分别为 9 和 11 项。候选版清单 62 项，11 个原版文件 SHA-256 一致，许可证及 Required Notice 检查通过。 |
| 1080p 性能测量 | PASS | 两种 Edge 模式、三版本共 130 个有效窗口，另有 70 个无头基线诊断窗口和 2 条 CDP trace。 |
| 自动质量切换重建 | PASS | 两种 Edge 模式各五轮，对照版每轮重建 4 次，候选版为 0 次。P99 无头 112.3 → 44.2 ms，有头 89.4 → 34.9 ms。 |
| 整体性能 Gate | FAIL | 固定档均值相对 v0.3 小幅增加，有头自动档 49.25 → 49.13 FPS。历史 19.02 → 17.95 FPS 的量级未复现，旧差值的归因未确认。本机固定档未达到 50–60 FPS。 |
| 当前 CLI Schema 与握手 | PASS | 0.162.0 本机生成 Schema、安全参数、App Server stdio、配置读取和只读探针协商。 |
| Windows 沙箱命令 | BLOCKED | 原生 CLI 与 App Server 各在两个目录复现，共 4 次 `ENVIRONMENT_BLOCKED`。进程映像可见，实际共享冲突句柄未确认。 |
| 离线功能与隐私 | PASS | 13 项覆盖线程、模拟、JSONL、审批作用域与拒绝、异常、鉴权、SSE 公开数据与私有读取边界。 |
| 无头 Edge 冒烟与双标签长测 | PASS | 四档布局，低性能档的 DPR 与后备像素，模拟拒绝终态与时间线，实际 SSE 断开时清空私有卡片并重新加载状态，健康导出。双标签 129.1 秒、12 次刷新、24 次模式切换，关掉第二页后收到新的画布样本。强制回收后的浏览器堆约 4.38–5.30 MB。 |
| 有头 Edge 双标签严格长测 | FAIL | 首轮完成 12 次刷新，但结束后的短调度对照不可用于性能判定。加入最终新样本断言后的两次复测，均在刷新后等待模拟审批状态时超时。原因未确认。有头性能矩阵独立完成。 |
| Node 压力与资源释放 | PASS | 120.1 秒，909 轮、90 次 SSE 重连、649 次并发决定争用、46 个夹具子进程，关闭后为 0。回收后堆首窗约 10.9 MB，后六窗约 12.8–12.9 MB，关闭后约 12.5 MB。 |
| Windows ZIP 与解压启动 | PASS | 双次构建摘要一致，逐项校验 ZIP 条目。中文空格路径解压后 13 项测试与本机 Schema 通过。运行 `Start-HaloFlux.cmd` 后检查版本页面、SSE 隐私和无模型握手。Ctrl+C 后监听、Node 和 Codex 子进程退出。 |
| 真实模型轮次与文件审批 | NOT TESTED | `test:live` 的未授权路径输出 `NOT_TESTED` 并退出 2。模拟通过与真实命令执行独立。 |
| 候选 CLI 执行与其他设备 | NOT TESTED | 0.163.0 只完成发布资产与源码核对。本轮没有执行候选 CLI、Node 22、实体触屏或跨机器测试。 |

## 自动化可信度

| 检查层面 | 覆盖范围 |
| --- | --- |
| Schema | 用实际解析到的 CLI 生成 Schema，检查请求、通知、审批响应、只读禁网参数、命令终态及 `exitCode` 和 `aggregatedOutput`。 |
| Mock | 使用生产 JSONL 和 HTTP/SSE 路径，夹具提供生产代码所读取的字段。夹具省略 Codex 持久化、真实工具执行、模型行为和未使用字段，压力测试中的初始化替身也不执行真实 Schema 协商。协议实测另列。 |
| 浏览器 | 检查已渲染状态、恢复后的设置、模拟审批拒绝后的终态与私有时间线、SSE 断开时清空审批及重连恢复。真实模型审批夹具本轮单独跳过。 |
| 性能 | 主 A/B 使用独立轻量采样。详细 JS 计时、trace 和截图独立执行，避免混入主测窗口。记录窗口时间、可见性、重建次数与浏览器图形能力。 |

`test:live` 使用相互独立的结果字段。未设置 `HALOFLUX_LIVE_TEST=1` 时输出 `NOT_TESTED` 并退出 2。获授权执行时，握手可单独取得 `PROTOCOL_PASS`。只有同一线程、同一轮次的实际命令终态、零退出码与预期回显均可核验时才取得 `EXECUTION_PASS`。若观察到真实沙箱错误且失败终态正确进入时间线，可报告 `EXPECTED_FAILURE_HANDLED`，执行仍为 `ENVIRONMENT_BLOCKED`。断言、协议或其他未解释的失败记为 `TEST_FAILURE`，本机探针也在执行未通过时返回非零。

真实模型轮次、实际文件修改审批和候选 CLI 兼容性运行为 NOT TESTED。旧版已有的真实验证保留在对应版本记录中。

## 复测入口

```powershell
npm.cmd test
npm.cmd run check:source
npm.cmd run check:protocol
npm.cmd run diagnose:sandbox
$env:HALOFLUX_SOAK_MS = '120000'
npm.cmd run test:soak
$env:HALOFLUX_PLAYWRIGHT = 'C:/path/to/playwright/index.mjs'
npm.cmd run test:edge
```

以独立会话运行性能矩阵、浏览器回归与 Node 压力测试。 [性能复测方式](PERFORMANCE.md)

`test:edge` 默认使用无头 Edge。可设 `HALOFLUX_EDGE_HEADED=1` 单独检查有头回归。可见性暂停与恢复由冒烟测试的受控事件覆盖。本机的多标签会话仍把两页报告为 `visible`，真实后台节流为 NOT TESTED。压力测试只覆盖短期资源趋势，未测量显存或长时间生产会话。

工作区证据包括 `output/playwright/v031-regression/` 的冒烟、双标签和截图，`output/soak-node-v031.json`、`output/sandbox-v031.json`、`output/live-v031.json` 及最终 ZIP 启动记录。发布 ZIP 只包含文件清单所列源码、资产、脚本和报告。
