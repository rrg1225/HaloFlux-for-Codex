# Contributing to HaloFlux for Codex

Use Node.js 22 or 24. The project declares zero npm dependencies. Run `npm.cmd test` and `npm.cmd run check:source` on Windows before proposing changes. Run `npm.cmd run test:windows` for changes to the launcher or browser packaging, and use the documented Edge runner for browser changes. [Test requirements](docs/TESTING.md)

Keep the upstream files identified by `docs/ORIGINALS.sha256` intact. State which tests used fixtures and which used an installed CLI. Before staging, review your diff for credentials, session data and personal paths, and use a commit email address you intend to make public. Keep build archives, installed runtimes, raw traces and logs local.

Git starts with the imported `v0.3.2-beta.1` baseline. Earlier entries in the changelog use existing release records. For packaging changes, follow the Windows build documentation and verify the local output. [Changelog](CHANGELOG.md) · [Desktop build](docs/DESKTOP-WINDOWS.md) · [Browser build](docs/WINDOWS.md)

Contributions are distributed with the upstream license and attribution. [License](LICENSE) · [Required notices](NOTICE.md) · [Security reporting](SECURITY.md)
