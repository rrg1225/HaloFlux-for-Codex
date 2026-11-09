# Contributing to HaloFlux for Codex

Use Node.js 22 or 24. The bridge has no runtime dependencies to install. Run `npm test`, `npm run check:source` and, on Windows, `npm run test:windows` before proposing changes. Use the documented Edge runner for browser changes. [Test requirements](docs/TESTING.md)

Keep the upstream files identified by `docs/ORIGINALS.sha256` intact. Change the Codex integration in `src/`, `public/` or the launcher. State which tests used fixtures and which used an installed CLI. Keep raw traces, session transcripts, account data and local paths out of commits and issue reports.

Git starts with the imported `v0.3.2-beta.1` baseline. Create local tags in the `vMAJOR.MINOR.PATCH[-prerelease.N]` form at verified release commits. To inspect or test the baseline in isolation, use `git worktree add --detach ../haloflux-v032 v0.3.2-beta.1`. `CHANGELOG.md` documents earlier releases from their existing records. Package from the corresponding tag using `scripts/release-windows.ps1`.

Contributions are distributed with the upstream license and attribution. [License](LICENSE) · [Required notices](NOTICE.md) · [Security reporting](SECURITY.md)
