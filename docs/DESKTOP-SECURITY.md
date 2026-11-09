# v0.4.0-alpha.1 桌面安全审查

审查范围包括 Electron 启动、renderer 与 IPC、回环 HTTP、审批沿用、桌面通知、首选项和发布包。桌面 bridge 只接受受窗口身份约束的本地请求，已有浏览器安全契约独立保留。

| 编号 / 等级 | 风险与处理 | 核验位置 |
| --- | --- | --- |
| HD-01 / 高，已处理 | 端口占用、崩溃后端口复用或其他网页可导致信任错误。worker 绑定系统分配的回环端口，主进程校验就绪来源，按 webContents ID 和路由过滤，并在断开时清空来源。HTTP 还检查桌面请求能力与既有 Host、Origin、媒体类型和操作令牌。桌面 HTML 的令牌为空。 | [窗口请求边界](../desktop/window-security.mjs#L18) · [独立 worker](../desktop/backend.mjs#L11) · [桥接校验](../src/server.mjs#L153) |
| HD-02 / 高，已处理 | renderer 若拥有通用原生命令能力，可越过 Codex 人工审批。两个窗口使用 sandbox 和 context isolation，关闭 Node integration、webview、DevTools 和默认权限。仅在可信顶层 frame 接受固定 IPC，分别限制控制窗和悬浮窗。页面导航、新窗口与外部链接均受允许列表约束。 | [窗口安全](../desktop/window-security.mjs#L51) · [Preload](../desktop/preload.cjs#L3) · [主进程](../desktop/main.mjs#L177) |
| HD-03 / 中，已处理 | 悬浮窗本身只需状态，若与控制窗共享操作能力会扩大范围。悬浮角色只允许 GET 状态和可视化资源，在 renderer 过滤和服务端双重执行。原浏览器界面继续使用既有的审批票据、范围检查和拒绝规则。 | [路由与能力](../src/server.mjs#L155) · [审批生命周期](SECURITY.md) |
| HD-04 / 中，已处理 | 用户任务内容可能进入通知、桌面设置或调试端口。通知使用固定文案及内存去重，偏好仅保存枚举、布尔值和窗口矩形。打包时关闭 RunAsNode、NODE_OPTIONS、Node inspect 和 file URL 额外权限 fuse。 | [通知](../desktop/notifications.mjs#L12) · [偏好](../desktop/preferences.mjs#L29) · [运行时 fuse](../scripts/harden-electron.mjs#L16) |
| HD-05 / 中，仍适用 | Alpha 为未签名的解压运行包，应用目录需要与当前 Windows 用户一起受信任。SHA-256 校验原始运行时和发布 ZIP 的内容完整性。软件来源与解压后文件完整性依赖用户的交付渠道和本机文件权限。 | [发布脚本](../scripts/release-desktop.ps1) · [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) |

Electron 45.2.3 来自官方发布。MIT 许可和随包 Chromium、Node 及第三方许可证一并分发。应用自身保留 PolyForm Noncommercial License 1.0.0 和 Required Notice。应用源码无 npm 运行时依赖。发行允许列表排除个人数据、Codex 认证、开发输出和 CLI 二进制。 [Electron 发布](https://github.com/electron/electron/releases/tag/v45.2.3) · [署名](../NOTICE.md)
