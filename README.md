# HaloFlux for Codex

[简体中文](README.zh-CN.md)

HaloFlux for Codex is an unofficial, non-commercial Windows desktop companion for Codex. It uses the original HaloFlux Canvas visualization to show task activity and gives you a local interface to review task details and approval requests.

## Features

- **Halo visualization.** The beat-driven light-field core, rotating data ring and layered beams come from Ryder191’s original HaloFlux. Codex and demo events drive changes in color, motion and particles. Canvas layout, scale and effects are adjustable.
- **Desktop main window, overlay and tray.** Open tasks and approvals in the main window. The optional transparent overlay shows read-only status and supports always-on-top and click-through settings. Use the tray to reopen the main window, reset the overlay or quit. Desktop settings include four rendering budgets.
- **Live Codex and demo modes.** Live mode uses the locally installed Codex CLI to create or resume threads, start or interrupt tasks, and review the decisions offered for pending approvals. Demo mode replays success, failure and approval scenarios without a Codex account.
- **Diagnostics.** The health panel reports local CLI, protocol and rendering status and exports a redacted report.

## Run from source

Install Git and Node.js 22 or newer. Node.js includes npm. The project declares zero npm dependencies, so the browser bridge is ready to run after cloning.

```powershell
git clone https://github.com/rrg1225/HaloFlux-for-Codex.git
cd HaloFlux-for-Codex
npm.cmd start
```

Open [http://127.0.0.1:4637](http://127.0.0.1:4637) and use **模拟演练** (Demo). Stop the server with Ctrl+C. On Windows, you can also run `Start-HaloFlux.cmd` to open the browser automatically. Type `Q` and press Enter in the launcher to stop it. [Browser setup and workspace options](docs/WINDOWS.md)

To try live mode, install the official Codex CLI separately and run `codex login`. In the HaloFlux main view select **实时 Codex** (Live Codex), then **连接 Codex** (Connect). Start or resume a thread before submitting a task. Review the command, permissions or file patch presented for each pending request before applying a decision. [Approval and session security](docs/SECURITY.md)

## Build the Windows desktop Beta

Get the official `electron-v45.2.3-win32-x64.zip` runtime. The build script checks it against the SHA-256 pinned in `scripts/desktop-runtime.json`. The command below assumes the runtime ZIP is in the current folder. [Electron runtime](https://github.com/electron/electron/releases/tag/v45.2.3)

```powershell
npm.cmd run check:source
npm.cmd run build:desktop -- -ElectronArchive '.\electron-v45.2.3-win32-x64.zip'
```

The script creates a portable Windows x64 ZIP and a SHA-256 sidecar in `dist/`. Verify the checksum, extract the entire ZIP, then run `HaloFlux.exe`. The local package includes Electron, Chromium and Node.js and opens in demo mode. [Desktop guide](docs/DESKTOP-WINDOWS.md)

## How it works

The browser edition runs a Node.js bridge on loopback HTTP and streams task status to the UI using server-sent events. When you connect in live mode, the bridge starts a local Codex App Server and talks to it over stdio JSON-RPC. The Electron edition runs the same bridge in a utility process, serves the main window over loopback and supplies a limited read-only status feed to the overlay through IPC. [Architecture](docs/ARCHITECTURE.md)

## Verification and known limits

The v0.4.1-beta.1 acceptance record covers Windows x64 at 150% display scaling, Electron 45.2.3 and Node.js 24.13.0 source checks. The earlier Windows 11 25H2 x64 desktop Beta record covers Node.js 22.13.1 and 24.13.0, and browser smoke tests in Edge 157.0.4341.46 with simulated events. The installed Codex CLI 0.162.0 passed schema and no-model handshake checks. [Verification records](docs/VERIFICATION.md)

- The fixed-quality dual-window performance target remains unmet. This Beta compared rendering priorities in short runs.
- Windows sandbox Error 32 remains unresolved. The on-machine isolation comparison with the candidate Codex CLI 0.163.0 remains untested. [CLI compatibility](docs/SANDBOX.md)
- Live Codex end-to-end tasks and real approvals remain untested on v0.4.1-beta.1.
- The Windows desktop app is Beta. Locally built distribution archives contain an unsigned app.

## Credits and license

Original HALOFLUX and its visual design are by **Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT)**. Codex integration and additional development are by **Li Xian（李显）**. The original standalone visualization remains available through `index.html`. [Upstream HALOFLUX](https://github.com/Ryder191/haloflux)

The project is distributed under the **PolyForm Noncommercial License 1.0.0**. The license restricts commercial use and requires preservation of the original notices when redistributing. The included track, “Synthwave 421k” by The Cynic Project (cynicmusic), is distributed under CC0. [License](LICENSE) · [Required Notice and third-party credits](NOTICE.md)

HaloFlux for Codex is maintained independently of OpenAI. Codex is a product of OpenAI.

[Changelog](CHANGELOG.md) · [Security policy](SECURITY.md)
