# v0.4.0-alpha.1 桌面进程验收

主进程只持有自己的 Electron utility process 句柄。worker 使用 v0.3.3 的桥接关停入口，拒绝新操作，关闭 SSE 与定时器，对 App Server 送 stdin EOF 并等待退出。失联时主进程撤销旧来源，退出路径按持有的句柄处理。主进程不会按进程名或端口终止用户的程序。

测试入口为 `scripts/test-desktop.cjs`。传入 `--handshake` 使用空的临时 `CODEX_HOME` 做已安装 CLI 的无模型握手。默认测试使用 Mock RPC，不发起真实任务。

生产应用不包含测试入口、Mock 夹具或 CLI 二进制。

| 操作 | 状态 | 结果 |
| --- | --- | --- |
| 启动失败和端口冲突 | VERIFIED | 无效目录与已占用端口分别返回诊断。已有占用者不受影响。 |
| 关闭到托盘、托盘退出、反复开关悬浮窗 | VERIFIED | 真实窗口和托盘菜单回调运行，隐藏主窗停止绘制，12 次循环每次销毁悬浮 BrowserWindow。 |
| renderer 崩溃 | VERIFIED | 主 renderer 强制崩溃后 worker 继续运行，从托盘重新加载成功。 |
| worker 崩溃 | VERIFIED | 测试终止所属 worker 后，主进程报告异常并撤销旧来源，原端口连接失败。该场景使用 Mock 环境。 |
| 模拟休眠恢复 | MOCK VERIFIED | 注入 Electron 的 suspend/resume 事件，画布暂停和恢复分支通过。物理休眠为 NOT TESTED。 |
| 任务期间主动退出 | MOCK VERIFIED | 继续后台保留轮次。等待阻止新任务且可取消。明确中断后等待终态再清理。真实任务为 NOT TESTED。 |
| 已安装 CLI 无模型握手后关停 | VERIFIED | 独立临时 CODEX_HOME。握手时确认一个属于 worker 的 Codex App Server。关闭后 worker、App Server 与 HTTP 监听均释放。 |
| 便携包正常退出和重复启动 | VERIFIED | 三轮从中文空格路径运行 EXE，应用 PATH 仅含 Windows 系统目录。首次重复启动复用原实例。通过 Windows 原生关闭退出，按 PID、创建时间及映像路径核对本次进程归零、端口释放和外部 Node 存活。 |

外部强制终止整个进程树与 Windows 会话强制结束为 **NOT TESTED**。
