# HaloFlux for Codex v0.4.1-beta.1 · Windows x64 便携版

## 从源码构建

在 Windows x64 安装 Git 和 Node.js 22 或更新版本。按 README 克隆仓库，准备官方运行时 `electron-v45.2.3-win32-x64.zip`。构建命令假设运行时 ZIP 位于源码根目录，脚本读取 `scripts/desktop-runtime.json` 中固定的运行时摘要。 [Electron 运行时](https://github.com/electron/electron/releases/tag/v45.2.3)

```powershell
npm.cmd run check:source
npm.cmd run build:desktop -- -ElectronArchive '.\electron-v45.2.3-win32-x64.zip'
```

脚本验证运行时摘要，将 Windows x64 便携 ZIP 和同名 `.sha256` 文件写入 `dist/`，并逐条核对归档内容。可使用 `npm.cmd test` 运行离线测试。

## 运行桌面客户端

1. 用 `Get-FileHash -Algorithm SHA256` 核对本地生成的桌面 ZIP 与其 `.sha256` 文件。完整解压后双击 `HaloFlux.exe`。Electron、Chromium 和 Node 随本地构建包提供。
2. 启动后可直接使用模拟模式。实时模式使用单独安装并已登录的 Codex CLI。原生 CLI 从本机 PATH 查找，也可通过进程级 `CODEX_BIN` 指定。默认工作目录为 Windows 文档目录。如需为新线程指定已有工作区，可运行 `& '.\HaloFlux.exe' --workspace (Resolve-Path '..\work-project').Path`，将示例相对路径换成所选目录。
3. 默认关闭主窗口会退出。桌面设置可改为关闭到托盘。托盘中的「打开 HaloFlux」恢复主窗口，切换模拟和实时只改变状态来源。实时连接和执行仍需在主窗口显式操作。
4. 使用主窗口按钮或托盘菜单打开悬浮光环。拖动顶部状态栏移动，拖动右下角缩放柄调整尺寸，或聚焦缩放柄后使用方向键。置顶、透明度、FPS 和自动质量在桌面设置中调整。托盘的「悬浮窗点击穿透」可以恢复点击。「复位悬浮窗位置」会恢复点击并把悬浮窗移到主显示器中央。
5. 真实任务运行时，退出会提供继续后台、等待以及在可中断时先中断再退出的选择。等待期间仍可通过主窗口处理审批。托盘可取消等待。窗口隐藏期间真实任务继续运行。
6. 删除便携目录前从托盘退出。若需要同时清理偏好，可删除 `%APPDATA%\HaloFlux for Codex\desktop-preferences.json`。偏好文件只含窗口几何和界面设置，Codex 的认证及历史由已安装的 CLI 管理。

## 渲染预算

| 模式 | 桌面绘制策略 |
| --- | --- |
| 均衡 | 两窗可见时，主窗最高 30 FPS，悬浮窗从 12 FPS 起，按主窗实测帧率和长帧逐级调整至 16 或 20 FPS，受用户上限约束。 |
| 主窗优先 | 两窗可见时，主窗沿用用户上限，悬浮窗最高 8 FPS，并持续显示最新状态。 |
| 悬浮窗优先 | 两窗可见时，悬浮窗沿用用户上限，主窗聚焦最高 12 FPS，失焦时暂停 Canvas。重新聚焦后恢复绘制。 |
| 省电 | 两窗最高 20 FPS。 |

仅一个窗口可见时，三种优先模式沿用该窗口的用户上限。隐藏的画布暂停绘制。主窗 Canvas 停绘 15 秒后释放缓冲区，恢复时用当前布局和状态重建。窗口状态变化期间桥接继续处理任务和审批。窗口帧率上限是预算值，实测随硬件和负载变化。 [性能报告](DESKTOP-PERFORMANCE.md)

悬浮窗尺寸按请求值保存，位置按原生移动量更新，避免分数 DPI 的尺寸读回误差逐次累加。旧偏好仍可读取，托盘复位可恢复默认尺寸和位置。

启用置顶时，悬浮窗在显示后使用 Electron 的 `pop-up-menu` 层级，窗口位置按显示器工作区保存。关闭置顶后使用普通窗口层级。

## 已知问题

- 固定画质双窗口性能门槛仍未达标。本版验证了渲染优先策略，测量结果受硬件和画质量影响。 [性能报告](DESKTOP-PERFORMANCE.md)
- 已安装 CLI 0.162.0 通过 Schema 和无模型握手。普通 Windows 沙箱 Error 32 仍未解决，候选 CLI 0.163.0 的实机隔离对照尚未执行。 [CLI 兼容性](SANDBOX.md)
- 真实 Codex E2E、真实审批和真实任务退出未在本版实测。系统通知显示受 Windows 通知设置、专注模式和托盘策略影响。
- 桌面客户端仍为 Beta，本地构建包中的应用未签名。物理触屏、混合 DPI 多显示器、系统休眠及 Windows ARM64 尚未验证。 [验收记录](VERIFICATION.md)

便携包随附 `LICENSE-HALOFLUX.txt`、`NOTICE.md`、Electron `LICENSE` 和 `LICENSES.chromium.html`。HaloFlux for Codex 为非官方的非商业衍生作品。
