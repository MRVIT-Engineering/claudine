# Security

## Reporting a vulnerability

TODO: add a private contact for security reports.

Please don't open a public issue for a vulnerability.

## Security invariants

- The webview is untrusted. All security decisions (path checks, approvals, tripwire, audit) live in Rust, never in TypeScript.
- The app makes no network requests. Only the `claude` process talks to the network.
- Never bundle, download, or install Claude Code. Use the user's own install.
- No plugin, extension, theme-download or remote-code mechanism, ever.
- Every new dependency is recorded in `DEPENDENCIES.md` with a reason.
- Use the `rust-mentor` skill whenever writing or changing Rust.

## Known limits of the path guard

The path guard (`crates/core/src/path_guard.rs`) keeps file access inside the open project. It doesn't cover the following:

- **Source files can still run code.** Compromised JavaScript could write a malicious `build.rs` inside the project, because editing source is the app's job. The webview's hardening is the defense there.
- **A symlink swapped in after `write_path` runs** can redirect a write to `.git`. It can't leave the project.
- **Hard links** look like normal files. Creating one to an outside file needs a process that can already reach that file.
- **Windows isn't reviewed.** The attack tests only run on macOS and Linux.

## Accepted risks

Both come from Tauri's Linux GTK3 stack and can't be fixed from this repo. They are ignored by ID in `deny.toml`. Recheck them on every Tauri upgrade.

| Advisory | Crate | Why it's accepted |
|---|---|---|
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429) | `glib` 0.18 | Unsound `VariantStrIter`, Linux only. The fix needs `glib` >=0.20, which `gtk` 0.18 can't use. |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370) | `proc-macro-error` | Unmaintained, build-time only. No upgrade exists. |
