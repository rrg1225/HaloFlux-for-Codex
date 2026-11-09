# HaloFlux for Codex v0.4.0-alpha.1 · Windows x64 便携版

1. 用 `Get-FileHash -Algorithm SHA256` 核对桌面 ZIP 与同名 `.sha256` 文件。完整解压后双击 `HaloFlux.exe`。Electron、Chromium 和 Node 随包提供。
2. 启动后可直接使用模拟模式。实时模式使用单独安装并已登录的 Codex CLI。原生 CLI 从本机 PATH 查找，也可通过进程级 `CODEX_BIN` 指定。默认工作目录为 Windows 文档目录。如需为新线程指定工作区，可运行 `& '.\HaloFlux.exe' --workspace 'E:\work\your project'`。
3. 默认关闭主窗口会退出。桌面设置可改为关闭到托盘。托盘中的「打开 HaloFlux」恢复主窗口，切换模拟和实时只改变状态来源。实时连接和执行仍需在主窗口显式操作。
4. 使用主窗口按钮或托盘菜单打开悬浮光环。拖动顶部状态栏移动，拖动右下角缩放柄调整尺寸，或聚焦缩放柄后使用方向键。置顶、透明度、FPS 和自动质量在桌面设置中调整。托盘的「悬浮窗点击穿透」开关也负责恢复点击。关闭或重开悬浮窗时自动恢复可交互状态。
5. 真实任务运行时，退出会提供继续后台、等待以及在可中断时先中断再退出的选择。等待期间仍可通过主窗口处理审批。托盘可取消等待。窗口隐藏期间真实任务继续运行。
6. 删除便携目录前从托盘退出。若需要同时清理偏好，可删除 `%APPDATA%\HaloFlux for Codex\desktop-preferences.json`。偏好文件只含窗口几何和界面设置，Codex 的认证及历史由已安装的 CLI 管理。

## 已知问题

- **UPSTREAM_BLOCKED**。已安装 CLI 0.162.0 通过 Schema 和无模型握手。普通 Windows 沙箱的历史 Error 32 仍存在于当前兼容记录。
- **BLOCKED_BY_APPROVAL**。候选 CLI 0.163.0 的下载及执行未授权。
- **NOT TESTED**。真实模型、真实审批和真实任务退出未在本版实测。系统通知的实际显示受 Windows 通知设置、专注模式与托盘策略影响。
- **NOT TESTED**。物理触屏、手势拖动与混合 DPI 多显示器交互、系统真实休眠、Windows ARM64 和其他 Windows 版本。Alpha 为未签名的 x64 ZIP。
- 双窗自动档将主窗限制为 30 FPS、悬浮窗限制为 20 FPS。Electron 的内存开销和帧率随设备及窗口组合变化。 [实测性能](DESKTOP-PERFORMANCE.md)

便携包随附 `LICENSE-HALOFLUX.txt`、`NOTICE.md`、Electron `LICENSE` 和 `LICENSES.chromium.html`。HaloFlux for Codex 为非官方的非商业衍生作品。

## 开发构建

获取与 `scripts/desktop-runtime.json` 中摘要一致的 Electron 45.2.3 Windows x64 官方 ZIP，再从源码目录运行以下命令。

```powershell
npm.cmd test
npm.cmd run check:source
npm.cmd run build:desktop -- -ElectronArchive 'D:\downloads\electron-v45.2.3-win32-x64.zip'
npm.cmd run test:windows
```

桌面打包器校验运行时摘要、固定归档顺序和时间戳，并逐条核对归档 SHA-256。浏览器 ZIP 使用原有独立构建脚本。 [Electron v45.2.3](https://github.com/electron/electron/releases/tag/v45.2.3)
