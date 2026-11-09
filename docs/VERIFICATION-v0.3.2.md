# HaloFlux for Codex v0.3.2-beta.1 验收

2026-11-08（UTC+8）。Windows 11 家庭版 25H2，10.0.26200.7462，Node.js 24.13.0，Edge 156.0.4314.58，Playwright 1.65.0-alpha-2026-10-30。CPU 为 Core i7-14650HX，系统枚举 Intel UHD 32.0.101.7077 和 RTX 5060 Laptop 32.0.15.9636。Edge trace 使用 Intel UHD Direct3D11。

## Stage 0

工作区无 Git 元数据，提交为 N/A。修改前创建独立快照 `%TEMP%/haloflux-v031-frozen-15ade5b3-39a4-438a-8655-d37b2a16b147`，包含当时工作区和历史发布物。冻结源码的 62 个发布条目与 v0.3.1 ZIP 逐项字节相同。v0.3.1 ZIP SHA-256 仍为 `4d5ecaab967c8230b88bc95f6fc7a9bd64acd7c8efb8b8951e5a58e508306cab`，保留原校验文件。原样 13 项离线测试、来源校验和本机 CLI Schema 检查均通过。 [v0.3.1 冻结验收](VERIFICATION-v0.3.1.md) · [v0.2 历史验收](VERIFICATION-v0.2.md)

本机当前 App Server 来自 npm Codex CLI 0.162.0。用原生二进制运行 `app-server generate-json-schema --experimental`。主要生成文件的 SHA-256 如下。CLI 路径、发布来源、二进制签名和其他版本静态比较见兼容性报告。 [Windows CLI 兼容性](SANDBOX.md)

| Schema | SHA-256 |
| --- | --- |
| `codex_app_server_protocol.v2.schemas.json` | `5c0ee37a723e4672108aa5c68b0c63cd540e17d408ca2f8ac1e7ebf76e737ac2` |
| `ClientRequest.json` | `f1425525dae2903cb5b658ee412530ff7a8fcaf78887f182c169b299e7f6b09b` |
| `ServerRequest.json` | `3d7bc481f84dc042984a74420e65c5a8d3c423f37a91b7d5df2365c903a12ac6` |
| `ServerNotification.json` | `071ecc89ba71ce215e1ac01f6e05be509eafa533b2ba6fac43f4c05330305a83` |

## Gate 记录

| Gate | 状态 | 证据 |
| --- | --- | --- |
| 0 离线回归 | VERIFIED / MOCK VERIFIED | 13 项通过。包括生产 HTTP/SSE 与 JSONL、鉴权和脱敏、线程轮次作用域、重复决定及过期、恢复和故障分类。 |
| 1 Windows 沙箱 | UPSTREAM_BLOCKED / BLOCKED_BY_APPROVAL | 0.162.0 在冻结基线四次复现 Error 32。0.163.0 已核对官方资产、修复提交及标签 Schema，下载、验签和运行均待授权。 |
| 2 双标签 | MOCK VERIFIED | 单页有头冒烟通过。五次严格长测连续通过，每轮 12 次刷新、24 次切换和 120 秒停留，退出后无观测到的残留。独立 Edge 确认原生隐藏页仍可接收审批状态，回前台恢复 rAF 和绘制。历史两次超时未重现。 [分段测试和超时证据](DUAL-TAB.md) |
| 3 性能 | VERIFIED（测量） / FAILED（目标） | 1080p / DPR 1 有头 Edge，固定、自动、静态各版本五窗，共 30 窗和两条独立 trace。固定档 46.03 → 44.38 FPS，自动档 50.62 → 51.17 FPS，候选一窗 49.41 FPS。 [A/B 与管线证据](PERFORMANCE.md) |
| 4 协议 | VERIFIED（0.162.0） / BLOCKED_BY_APPROVAL（0.163.0 实机） | 默认与显式 `CODEX_BIN` 通过当前二进制 Schema 检查，错误的绝对路径被拒绝。解压副本完成当前 CLI 的无模型握手。 |
| 5 Windows 诊断包 | VERIFIED | 两次构建字节一致。逐项校验发布清单、11 个原版 SHA-256、许可证及 Required Notice，敏感模式扫描通过。带中文与空格的路径解压后通过 13 项离线测试、Schema 检查、页面与 SSE、0.162.0 无模型握手。Ctrl+C 后桥接监听和已观察到的子进程关闭。 |

本轮真实模型、真实文件及命令审批、Node 22、实体触屏、远程 CI 和跨设备测试为 NOT TESTED。v0.2 已有的真实审批证据单独保留。模型冒烟入口默认返回 NOT_TESTED，需另外启用。

Node 长测为 MOCK VERIFIED。120.097 秒内 916 轮、91 次 SSE 重连、654 次并发决定争用、46 次夹具进程启动。关闭后夹具进程为零，时间线最大 200 项。回收后堆首窗约 10.37 MiB，最后六窗约 12.18–12.25 MiB，退出后约 11.95 MiB。工作区证据为 `output/soak-node-v032.json`。

打包预检中，非交互控制台未答复批处理的 `Terminate batch job (Y/N)?`，一轮关停等待超时。之后使用独立终端发送 Ctrl+C，核对服务和子进程退出，并回答批处理提示。解压启动证据保存在 `output/launcher-v032.json`。

## 复测命令

```powershell
npm.cmd test
npm.cmd run check:source
npm.cmd run check:protocol
$env:HALOFLUX_SOAK_MS = '120000'
npm.cmd run test:soak
$env:HALOFLUX_PLAYWRIGHT = 'C:/path/to/playwright/index.mjs'
$env:HALOFLUX_EDGE_HEADED = '1'
$env:HALOFLUX_EDGE_REPEATS = '5'
npm.cmd run test:edge
node scripts/edge-background.mjs
powershell.exe -NoProfile -File scripts/release-windows.ps1
```

常规测试使用模拟或测试夹具。无模型 App Server 握手与真实沙箱命令分别验收。沙箱诊断的固定回显见兼容性报告，执行前核对当前 Windows 权限边界。 [兼容性实验方案](SANDBOX.md)

## v0.4.0 准入

当前仅交付 Windows 诊断版。v0.4.0 准入未通过。尚需取得候选二进制实机兼容和普通只读沙箱执行证据。固定档提升和自动档稳定高于 50 FPS 的目标也未达成。
