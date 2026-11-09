# 测试矩阵

`npm test` 执行 A、B、C、F 四组。Node 的 test runner 不依赖 npm 包，不读取真实 Codex 配置，不会发起模型轮次。Windows 命令可将 `npm` 写为 `npm.cmd`。

| 组 | 入口与验证层 | 网络 | CLI / 登录 / 模型 | 浏览器 | Windows 权限 |
| --- | --- | --- | --- | --- | --- |
| A Unit | `npm run test:unit`。状态映射、终态、已知错误、回显判断和 Canvas DPR 阈值。 | 无 | 无 | 无 | 普通用户 |
| B Protocol Contract | `npm run test:protocol`。Node 子进程写真实 JSONL，注入 Schema 数据，验证握手、UTF-8 分帧、超时、拒绝和退出。 | 无 | 夹具，无登录或模型 | 无 | 普通用户 |
| C Integration | `npm run test:integration` 和 `npm run test:soak`。真实回环 HTTP/SSE、桥接和审批状态机。Codex 响应为夹具。 | 仅回环 | 夹具，无登录或模型 | 无 | 普通用户 |
| D Browser E2E | `npm run test:edge`、`npm run test:edge:background`。真实 Edge 与模拟任务，检查四种布局、双标签、刷新、重连、终态、票据、浏览器诊断和原生可见性。 | 仅回环 | 无 | Edge，原生后台要求有头 | 普通用户及桌面会话 |
| E Performance | `npm run test:performance -- <baseline> .`。独立 Edge 上下文轮换版本，记录绘制帧、质量变化、重建和 JS 堆。 | 仅回环 | 无 | 有头 Edge，默认 1080p / DPR 1，支持自定义视口和移动仿真 | 普通用户及桌面会话 |
| F Security | `npm run test:security` 和 C 中的安全断言。检查路径解析、隔离、请求鉴权、审批作用域、导出和 SSE 脱敏。 | 无或回环 | 夹具，无登录或模型 | 无 | 普通用户 |
| G Windows Packaging | `npm run test:windows`。静态检查 CMD、两次独立打包、结构和内容哈希、中文空格路径解压、离线测试、SSE 和 `Q` 关停。实际 CLI 握手另记。 | 仅回环 | 离线步骤无 | 离线步骤无 | 普通用户，可写临时目录 |

真实 CLI 的 `npm run check:protocol` 和 `npm run check:cli` 检查安装版本的 Schema 与隔离握手。`diagnose:sandbox` 可能触发 Codex 沙箱初始化，需单独运行。`test:live` 与 `test:live:approvals` 需要显式启用、已登录的 Codex、网络和模型用量。 [兼容性与授权范围](SANDBOX.md)

浏览器测试使用已安装的 Playwright。将 `HALOFLUX_PLAYWRIGHT` 指向 `playwright/index.mjs`，设置 `HALOFLUX_EDGE_HEADED=1`，可用 `HALOFLUX_EDGE_OUTPUT` 指定报告目录。每轮严格双标签测试固定 12 次刷新、24 次模式切换和 120 秒驻留。`test:edge:background` 使用独立原生 Edge 窗口验证隐藏和恢复。性能复测与浏览器回归串行运行。 [性能复测](PERFORMANCE.md)

## 测试可信度

- HTTP、SSE、浏览器与打包证据分别检查协议字段、实际 DOM 和终态、ZIP 条目及哈希。进程退出码用于传递测试失败，沙箱命令还必须产生完整回显。
- Node 长测以前替换 `initialize`。本版只替换 CLI 的 Schema 数据源和子进程响应，生产握手、安全校验、JSONL 和状态机均执行。C 中的 `FixtureRpc` 单独用于可控的迟到消息、审批时序和断线注入。
- 双标签用服务端活动流数量和当前文档的 CDP 请求交叉验证回收，用实际审批终态和时间线验证重连未开始新轮次。部分浏览器自动化上下文可能模拟可见性，独立原生 Edge 测试提供实际隐藏证据。
- 性能以实际进入绘制的时间统计，浏览器内部采样，窗口外执行主动回收。截图在采样之后，主测不启用 trace。短窗堆变化与 120 秒驻留趋势分开评价。
- 浏览器测试等待独立 Edge 进程关闭，JSONL 测试等待 `child.close`，Windows 启停验收核对实际子进程和端口。
