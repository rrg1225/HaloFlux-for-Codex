# v0.4.0-beta.1 Electron 安全审查

审查覆盖 renderer 配置、IPC、网络能力、审批、通知和打包。Beta 收窄了两处权限。悬浮窗改收固定字段 IPC，控制窗的操作凭据只注入来自可信顶层文档的 POST。 [Electron 安全检查表](https://www.electronjs.org/docs/latest/tutorial/security) · [浏览器安全模型](SECURITY.md)

| 编号 / 等级 | 风险与处理 | 核验位置 |
| --- | --- | --- |
| HD-01 / 高，已收窄 | Alpha 按 webContents 绑定操作请求，嵌入 Canvas frame 与控制文档共享该身份。Beta 增加 `details.frame`、顶层文档 URL 和 POST 检查。worker 监听由系统分配的回环端口，断开时撤销来源。服务端独立校验 Host、Origin、请求媒体类型、窗口能力与操作令牌。桌面 HTML 的令牌为空。 | [请求校验](../desktop/window-security.mjs#L18) · [来源撤销](../desktop/backend.mjs#L36) · [桥接校验](../src/server.mjs#L153) |
| HD-02 / 高，隔离复核 | 两窗使用 renderer sandbox 与 context isolation。关闭 Node integration、webview 和 DevTools，拒绝权限、重定向和未授权导航。应用的新窗处理只允许把固定原项目地址交给系统浏览器。IPC 根据 webContents、顶层 frame URL 和窗口角色授权，窗口操作使用枚举、布尔值和有界整数。 | [窗口安全](../desktop/window-security.mjs#L52) · [IPC 注册](../desktop/main.mjs#L256) |
| HD-03 / 中，已收窄 | Alpha 悬浮窗可以读取聚合 SSE，preload 还暴露由主进程拒绝的控制方法。Beta 的悬浮角色只能 GET 可视化资源。preload 只提供读状态、订阅、隐藏和调整尺寸。状态投影只含枚举、布尔值、计数脉冲和视觉预算。该边界排除会话、路径、命令、对话、审批标识和票据。 | [资源允许列表](../desktop/backend.mjs#L6) · [preload](../desktop/preload.cjs#L3) · [状态投影](../desktop/main.mjs#L90) |
| HD-04 / 中，复核 | 主窗通过原有受保护的 POST 查看私有任务和审批内容。单次票据继续绑定连接、线程、轮次和当前请求。Mock 验收覆盖批准、拒绝和拒绝过期或重复提交。渲染使用文本节点，Canvas 消息校验来源窗口和精确 origin。 | [审批规则](SECURITY.md) · [主窗消息](../public/app.js#L100) |
| HD-05 / 中，复核 | 通知使用固定文案、内存去重和分类型节流。偏好文件只保存非敏感设置。打包关闭 RunAsNode、NODE_OPTIONS、Node inspect 与 file URL 额外权限。应用发行清单排除开发输出、夹具、CLI 和认证数据。 | [通知](../desktop/notifications.mjs#L9) · [偏好](../desktop/preferences.mjs#L5) · [运行时 fuse](../scripts/harden-electron.mjs#L16) |
| HD-06 / 中，信任前提 | 便携包未签名，解压目录和同源 Canvas 属于受信任应用代码。顶层请求检查可以阻止 Canvas frame 自己发起控制 POST。同源脚本若被篡改，仍可访问父文档。完整性由已校验运行时、原始文件摘要、CSP、ZIP 侧车和本地文件权限共同保障。 | [发行校验](../scripts/release-desktop.ps1) · [CSP](../src/server.mjs#L161) · [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) |

沿用已固定 SHA-256 的官方 Electron 45.2.3。应用无 npm 运行时依赖，本轮新增依赖为零。MIT 许可和随包 Chromium、Node 及第三方许可证一并分发。项目保留 PolyForm Noncommercial License 1.0.0、Required Notice、原作者和新增开发者署名。 [官方运行时](https://github.com/electron/electron/releases/tag/v45.2.3) · [Electron 公告](https://github.com/electron/electron/security/advisories) · [署名](../NOTICE.md)

## 交付复核

- **VERIFIED**。源清单校验通过。应用使用独立的内存 session 和回环请求能力，应用脚本来自打包资源。动态状态使用 `textContent`，可视化消息检查发送窗口和 origin，设置存储仅含偏好。 [主窗渲染](../public/app.js#L100) · [悬浮窗](../public/overlay.js#L28) · [资源校验](../scripts/check-source.mjs)
- **VERIFIED**。构建输入 SHA-256 为 `489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0`。重新应用发行 fuse 后的 EXE 与已校验的 Alpha 发行 EXE 摘要一致。预加载脚本与渲染安全配置随 Beta 应用资源交付。 [运行时固定值](../scripts/desktop-runtime.json) · [fuse 校验](../scripts/harden-electron.mjs)
- **MOCK VERIFIED**。审批通过业务允许列表与单次票据，模拟审批覆盖批准、拒绝和重复请求；通知使用固定文案。真实审批、真实模型执行和未知终态恢复为 **NOT TESTED**。 [验收](VERIFICATION.md) · [桥接审批边界](SECURITY.md)
- **NOT TESTED**。Electron 45.3.0 在本次复验期间已发布，更新 Chromium 并修正 Windows 隐藏窗口行为。Beta 继续使用固定的 45.2.3，45.3.0 的桌面兼容性及性能需独立复验。 [Electron 45.3.0 发布记录](https://releases.electronjs.org/release/v45.3.0)
