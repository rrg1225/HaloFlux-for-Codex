# Windows 沙箱兼容性

## v0.3.3-rc.1 当前结果

本机默认 CLI 仍是 0.162.0。`npm.cmd run check:protocol` 通过本机生成的 Schema。`npm.cmd run check:cli` 在空的临时 `CODEX_HOME` 验证相同版本的 `initialize` / `initialized` 握手，返回核心兼容、完整审批响应能力和零模型用量。协议检查采用已安装的二进制。 [OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)

实时连接会显示 CLI 缺失、路径无效和协议失败。健康面板区分 CLI 登录状态、握手、已有沙箱失败标记、浏览器事件流和本地桥接。沙箱运行结果仍依据上一次实机的 Error 32 证据列为 **UPSTREAM_BLOCKED**，本轮没有重复触发 sandbox runtime 的 ACL 初始化。候选 0.163.0 下载、验签及执行为 **BLOCKED_BY_APPROVAL**。0.162.0 本轮模型与真实审批为 **NOT TESTED**。 [上游修复](https://github.com/openai/codex/pull/51822) · [相关问题](https://github.com/openai/codex/issues/52488)

## v0.3.2-beta.1 实机与静态对照

2026-11-08（UTC+8），本机默认解析仍为 npm Codex CLI 0.162.0。由 `<npm-global-bin>/codex.cmd` 对应的 npm 安装定位到 `<npm-global-bin>/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`。同发行包的 helper 位于其上一级的 `codex-resources`。

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 现有二进制来源 | VERIFIED | CLI `dce685d569526ef4712fa82d20ff20e1309baad5fcd34215e1126698f611242f`，helper `ba268a3a105b9e9217b2f21c5e2d06cc0a27d5728872fb35c18b0122ca24ef51`。两份本机摘要均匹配官方资产。Authenticode 均为 `Valid`，签发给 OpenAI OpCo, LLC，证书指纹 `0C6C3CA94B5A2DDA98357A1176470AB7B85ADF8F`。 |
| 0.162.0 实际 Schema | VERIFIED | `check:protocol` 由当前二进制生成实验版 Schema，校验只读禁网、人工审查、线程、轮次与审批线格式。 |
| 0.162.0 普通沙箱命令 | UPSTREAM_BLOCKED（冻结基线） | 原生 CLI 与 App Server 各在两个目录失败。Error 32 出现在 `node_repl.exe` ACL 访问。当前轮未执行可能再次触发 ACL 刷新的探针。 |
| 0.163.0 上游资产与提交 | VERIFIED（静态） | GitHub Releases 中的 Windows x64 完整包见下表。#51822 的合并提交是 0.163.0 的祖先，0.162.0 与该提交分叉。 |
| 0.163.0 App Server 标签 Schema | VERIFIED（静态） | `ClientRequest` 已有方法集合相同，`ThreadListParams` 新增可选 `excludedThreadIds`。新增 `thread/readState/changed` 通知。 `ClientNotification` 与 `ServerRequest` 相同。用于握手、只读禁网、人工审查和五种审批的直接相关定义保持一致。 |
| 候选 Authenticode、安装版 Schema、握手及普通沙箱命令 | BLOCKED_BY_APPROVAL | 候选归档与 PE 文件尚未下载，Authenticode 和实际文件摘要待验。静态检查提供版本选择依据。 |
| 真实模型轮次、真实审批 | NOT TESTED | 需要单独授权。 |

[0.162.0 官方发布元数据](https://api.github.com/repos/openai/codex/releases/tags/rust-v0.162.0) · [0.163.0 官方发布元数据](https://api.github.com/repos/openai/codex/releases/tags/rust-v0.163.0) · [#51822](https://github.com/openai/codex/pull/51822) · [0.163.0 标签 Schema](https://github.com/openai/codex/tree/rust-v0.163.0/codex-rs/app-server-protocol/schema/json)

### 待批准的候选实验

| 官方 0.163.0 Windows x64 资产 | SHA-256（发布元数据） |
| --- | --- |
| `codex-package-x86_64-pc-windows-msvc.tar.gz`，162,230,206 字节 | `901028b285614a9974f431f9d9f6534b3e5ed8d62eba4ba64f4762c00f040522` |
| `codex-x86_64-pc-windows-msvc.exe` | `2692c8c7bb2cf8b0aefe638741fc90236f4b824c59578ce84994f9de58200993` |
| `codex-windows-sandbox-setup-x86_64-pc-windows-msvc.exe` | `2efc67f77de2658667c1481e00a1c4c964d3e8f6d4f39b638620d80b9d0f6d8a` |

[OpenAI Codex 官方完整包](https://github.com/openai/codex/releases/download/rust-v0.163.0/codex-package-x86_64-pc-windows-msvc.tar.gz)

1. 获得下载和只读验签授权后，将完整包保存到独立临时目录。先比对归档 SHA-256，核对归档路径，再解压并对 CLI 和实际随包 helper 做 `Get-AuthenticodeSignature`。记录签名状态、签发主体和证书指纹。此阶段写入临时归档、解压文件及脱敏报告。
2. 签名和摘要通过且获准运行后，分别在各自空的临时 `CODEX_HOME` 下运行 0.162.0 和 0.163.0 的版本、Schema 与 stdio `initialize`、`initialized`、关闭。仅给测试进程设置 `CODEX_BIN` 和临时配置目录。现有登录凭据、持久配置、全局 PATH、npm 和 Desktop 安装保持原状。模型用量为零。
3. 在允许的权限边界内，用相同账户和相同沙箱策略执行两种版本的原生只读回显及 App Server `command/exec` 只读禁网回显。只读命令本身仅输出固定标记。Windows sandbox runtime 初始化可能写本机状态和 ACL，若需要提权、ACL 或系统配置改动，先停在该阶段并取得专项授权。保持现有 Codex 进程和系统安全保护。记录确切退出码、回显、脱敏错误特征和子进程关闭。独立配置无法复现现有 runtime 条件时，将隔离结果和真实共享冲突复测分开记录。模型用量为零。
4. 回退时关闭专用测试进程及 PowerShell 会话，保留脱敏证据并清理该临时目录。复核默认 CLI 解析及已验证版本。真实模型和审批需额外授权。

候选可执行文件验签并获授权后，在专用 PowerShell 会话中设置 `CODEX_BIN`，用 `npm.cmd run check:cli` 执行隔离握手。关闭该会话即可恢复默认解析。0.163.0 实机结果仍待验证。 [启动说明](WINDOWS.md) · [官方 App Server 协议](https://learn.chatgpt.com/docs/app-server)

## v0.3.1-beta.1 本机结果（冻结历史）

**UPSTREAM_BLOCKED**。2026-11-08（UTC+8），Windows 11 25H2，10.0.26200.7462，Node.js 24.13.0。原生 npm Codex CLI 0.162.0 在项目目录和空临时目录均复现 `helper_unknown_error: setup refresh had errors`。使用同一二进制启动的 stdio App Server 返回同类错误。四次执行均未获得回显。

| 层面 | 结果 |
| --- | --- |
| npm CLI 解析 | `where.exe codex` 优先返回 npm shim。HaloFlux 解析到 `<npm-global-bin>/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`。CLI 与 App Server 探针使用此文件。 |
| CLI 与 helper 来源 | 本机 CLI SHA-256 为 `dce685d569526ef4712fa82d20ff20e1309baad5fcd34215e1126698f611242f`。同发行包 `codex-resources/codex-windows-sandbox-setup.exe` 的 SHA-256 为 `ba268a3a105b9e9217b2f21c5e2d06cc0a27d5728872fb35c18b0122ca24ef51`。两者都匹配官方 Windows x64 发布资产。 [官方 0.162.0 资产与摘要](https://api.github.com/repos/openai/codex/releases/tags/rust-v0.162.0) |
| Desktop | 正在运行的 Desktop 托管 CLI 位于 `%LOCALAPPDATA%/OpenAI/Codex/bin/<bundle>/codex.exe`，报告 0.167.0-alpha.3.2。随附 helper 可见 #51822 引入的 `inspect ACL target` 字符串，以及后来改用窄权限的代码分支相关字符串。它与 npm helper 的哈希不同。本轮只核对版本与文件，兼容性执行对照为 NOT TESTED。 |
| App Server 协议 | 本机生成的 Schema、安全参数、stdio 握手与 `config/read` 通过。Windows 沙箱配置为 `elevated`，readiness 为 `ready`。 |
| Windows Sandbox Runtime | 四次探针均为 `ENVIRONMENT_BLOCKED`。新追加日志记录 `runtime read/execute validation failed`，对 `node_repl.exe` 执行 `open ACL target for root-only update` 时返回 OS 错误 32。新 setup 错误标记也记录刷新失败。 |
| 进程与共享冲突 | 五个 `node_repl.exe` 进程加载同一 Desktop `cua_node` 路径，部分进程的父 PID 是运行中的 Desktop 托管 Codex。进程映像与路径证据不能确认实际冲突句柄、共享掩码或安全软件的影响。 |

本机故障发生在 CLI 沙箱启动命令之前。报告中的 `PROTOCOL_PASS` 仅覆盖协议，`ready` 仅表示就绪接口的返回值。健康面板按证据显示本机失败标记或本次桥接实际观测到的错误。模拟模式可独立使用。 [官方 Windows 沙箱说明](https://learn.chatgpt.com/docs/windows/windows-sandbox)

## 上游提交与候选版本

PR #51822 在合并提交 `dd12f892f1b857e5161abd33a2967125b265d550` 中把 root-only ACL 修复里的 `MAXIMUM_ALLOWED` 打开限制在目录。活动 EXE/DLL 先以 `READ_CONTROL` 检查，只在需要更新时请求 `WRITE_DAC`。PR 同时增加保持 EXE 只读共享打开时的回归测试。#52488 记录同类错误。 [PR 与测试](https://github.com/openai/codex/pull/51822/files) · [上游故障报告](https://github.com/openai/codex/issues/52488)

官方提交比较显示 `rust-v0.162.0` 和 `rust-v0.162.1` 均与合并提交分叉。两份标签的 `acl.rs` 仍会对 `inheritance == 0` 的文件执行旧打开路径。0.162.0-alpha.20 与 0.163.0 的标签包含合并提交，且源代码包含文件与目录的区分。这个比较支持选择稳定版 0.163.0 做隔离验证，实际协议与沙箱结果仍需实测。 [0.162.0 标签源码](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/windows-sandbox-rs/src/acl.rs) · [0.162.1 标签源码](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/acl.rs) · [0.163.0 提交比较](https://api.github.com/repos/openai/codex/compare/dd12f892f1b857e5161abd33a2967125b265d550...rust-v0.163.0?per_page=1) · [0.163.0 标签源码](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/windows-sandbox-rs/src/acl.rs)

若获明确授权，候选对照使用官方 0.163.0 Windows x64 完整发行包 `codex-package-x86_64-pc-windows-msvc.tar.gz`，核验 SHA-256 `901028b285614a9974f431f9d9f6534b3e5ed8d62eba4ba64f4762c00f040522`，解压至独立临时目录。仅在测试进程设置 `CODEX_BIN` 指向候选 exe，先验证版本、Schema 和 stdio 握手，再复测同一只读回显与新日志。保持相同权限策略。若触发提权、登录或配置迁移则停止该对照。回退时退出测试进程并清理该候选目录，随后用原有 CLI 复核解析结果。此流程当前为 NOT TESTED。 [官方 0.163.0 发行包](https://github.com/openai/codex/releases/tag/rust-v0.163.0) · [官方资产摘要](https://api.github.com/repos/openai/codex/releases/tags/rust-v0.163.0)

## 无模型复测

```powershell
npm.cmd run check:protocol
node scripts/diagnose-windows-sandbox.mjs
$LASTEXITCODE
```

探针在两个目录运行固定的 `cmd.exe /d /c echo HALOFLUX_SANDBOX_PROBE`。原生 CLI 以单次进程只读配置运行。App Server 通过 Schema 检查后的 `command/exec` 请求只读且关闭沙箱网络。诊断分别检查退出码与预期回显，报告 `EXECUTION_PASS`、`ENVIRONMENT_BLOCKED`、`TEST_FAILURE` 或 `NOT_TESTED`。已知失败的命令路径返回非零。日志检查只在运行期间新增的内容中识别固定特征，其他并发进程也可能写入同一日志。诊断没有模型轮次、认证文件修改或沙箱配置改写。

以下 PowerShell 命令可在当前用户权限下重复进程映像清单检查。它们提供路径与父子关系证据。

```powershell
Get-Process codex,node_repl -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path
Get-CimInstance Win32_Process -Filter "Name='node_repl.exe'" | Select-Object ProcessId, ParentProcessId, ExecutablePath
```

应用保留固定失败类别 `APPLICATION_BUG`、`CODEX_SANDBOX_FAILURE`、`CODEX_PROTOCOL_ERROR`、`AUTHENTICATION_ERROR` 与 `UNKNOWN_ENVIRONMENT_ERROR`。健康导出仅包含固定类别、版本和渲染元数据，详细日志保留在本机。
