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

## Settings file

- Settings live in `settings.json` in the user's app config folder. Rust picks that path; the webview can't choose it.
- Rust checks every value before saving: numbers are clamped, and unknown values make the whole file invalid. Hidden names must be plain names, never paths.
- A file that can't be read is moved to `settings.json.invalid` and defaults are used, so a bad file can't stop the app from starting.

## Claude sessions

- Rust runs the user's own `claude`, found in the usual install folders and then in absolute `PATH` entries. Relative `PATH` entries such as `.` are skipped, so a project can't supply its own `claude`. Nothing is downloaded or installed.
- `claude -p` skips Claude Code's own folder-trust prompt, and a project's `.claude/` and `.mcp.json` can run commands as soon as `claude` starts. Rust asks with a native dialog before the first session in each folder, and keeps the answer in `trusted-projects.json` in the app config folder, by canonical path. A missing or broken file trusts nothing.
- `claude` runs with `--permission-prompt-tool stdio` and `--permission-mode default`, which overrides a "bypass permissions" default in the user's settings. Each permission request is kept in Rust. The webview answers only with a request id and allow or deny, and Rust replies with the tool input it kept, so the webview can't change what runs. Each request can be answered once.
- Rust refuses any other request from `claude` (hook callbacks, MCP messages), so nothing waits on the webview.
- Ending a session, opening another folder or quitting kills the process.
- **Limits, for now:**
  - Allow rules in the user's own Claude Code settings still approve tools without asking Claudine.
  - The webview is told when a path is outside the project only by comparing text, so a symlink inside the project that points outside isn't flagged. It's a hint for the user, not a check; the hook and tripwire are meant to add the real check later.
  - Text from Claude, tool results and `claude`'s error output can contain absolute paths, and are shown as they are.

## Plugins

- `tauri-plugin-dialog` is used only from Rust, for the folder picker and the trust dialog. The webview has no `dialog:*` permission; a direct call from JavaScript fails with "not allowed by ACL". The plugin also replaces `window.alert` and `window.confirm` with its own commands, so those fail too. The app doesn't use them.
- The plugin depends on `tauri-plugin-fs` but doesn't register it, so no `fs` commands exist in the app.

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
