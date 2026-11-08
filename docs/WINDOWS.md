# Windows 启动

1. 完整解压 ZIP 到可读目录，保留文件结构。
2. 安装 Node.js 22 或更新版本，并重新打开终端或启动器。浏览器默认使用 Windows 关联的应用。
3. 若要用实时模式，安装 Codex CLI，然后运行 `codex --version`、`codex login status`。需要登录时运行 `codex login`。
4. 双击 `Start-HaloFlux.cmd`。启动器检查 Node 和 Codex 登录，打印回环地址并打开默认浏览器。按 `Ctrl+C` 关闭桥接。缺少 Codex 或无法验证登录时，模拟模式仍可用。
5. 默认工作目录为解压目录。需要操作其他目录时，通过下面的开发者启动命令指定路径。

```powershell
npm.cmd start
npm.cmd start -- "E:\work\your-project"
```

默认地址为 `http://127.0.0.1:4637`。若端口被占用，在 PowerShell 会话中设置 `$env:HALOFLUX_PORT = '4638'`，再启动。若 Windows 找不到原生 CLI，将 `CODEX_BIN` 指向本机 `codex.exe` 的绝对路径。若默认浏览器未打开，复制启动器打印的地址。桥接进程重启后需要刷新页面。若需继续历史任务，连接后从线程列表选择该线程。

要测试已经安装的官方 CLI，可以在专用 PowerShell 会话中设置 `$env:CODEX_BIN`，然后运行 `npm.cmd run check:protocol` 和启动器。关闭该会话即可回到默认解析方式。协议检查不发起模型轮次。 [版本对照与安全边界](SANDBOX.md)

若任务时间线显示 `CODEX_SANDBOX_FAILURE`，可以继续使用模拟演练。运行 `npm.cmd run diagnose:sandbox` 复查固定只读命令，或从环境健康面板导出脱敏报告。 [沙箱诊断](SANDBOX.md)

自动化启动可在当前 PowerShell 会话设置 `$env:HALOFLUX_NO_BROWSER = '1'`，然后运行 `Start-HaloFlux.cmd`。设定 `HALOFLUX_PORT=0` 由系统选取空闲端口。

## 构建与校验

在 Windows PowerShell 运行 `powershell.exe -NoProfile -File scripts/release-windows.ps1`。清单列出所有发布条目，脚本固定条目顺序、时间戳和属性，并逐一核对压缩内容的 SHA-256。使用相同源文件及 PowerShell/.NET 压缩工具链可以重建相同字节。下载后用 `Get-FileHash -Algorithm SHA256` 核对 ZIP 和同名 `.sha256` 文件。 [发布文件清单](../scripts/release-files.txt) · [验收记录](VERIFICATION.md)
