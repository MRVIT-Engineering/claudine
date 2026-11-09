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

- Rust runs the user's own `claude`, found in absolute `PATH` entries first, so it's the same one as in the terminal, then in the usual install folders. Relative `PATH` entries such as `.` are skipped, so a project can't supply its own `claude`. Nothing is downloaded or installed.
- `claude -p` skips Claude Code's own folder-trust prompt, and a project's `.claude/` and `.mcp.json` can run commands as soon as `claude` starts. Rust asks with a native dialog before the first session in each folder, and keeps the answer in `trusted-projects.json` in the app config folder, by canonical path. A missing or broken file trusts nothing.
- `claude` runs with `--permission-prompt-tool stdio` and `--permission-mode default`, which overrides a "bypass permissions" default in the user's settings. Each permission request is kept in Rust. The webview answers only with a request id and allow or deny, and Rust replies with the tool input it kept, so the webview can't change what runs. Each request can be answered once.
- Rust refuses any other request from `claude` (hook callbacks, MCP messages), so nothing waits on the webview.
- **Modes and models** change through `claude`'s control messages, never through CLI arguments. Rust accepts only the modes *default*, *acceptEdits* and *plan*, as a Rust enum. `bypassPermissions` and `auto` aren't offered, because they let `claude` approve tools itself. A model is passed on only if it's in the list `claude` sent for this session.
- In *accept edits* mode, `claude` approves file edits inside the folder without asking Claudine. Commands still ask. The composer shows the mode in amber while it's on.
- Ending a session, opening another folder or quitting kills the process.
- **Limits, for now:**
  - Allow rules in the user's own Claude Code settings still approve tools without asking Claudine.
  - The webview is told when a path is outside the project only by comparing text, so a symlink inside the project that points outside isn't flagged. It's a hint for the user, not a check; the hook and tripwire are meant to add the real check later.
  - Text from Claude, tool results and `claude`'s error output can contain absolute paths, and are shown as they are.

## Claude accounts

- Each added account is its own Claude Code config folder, `accounts/<id>` in the app data folder, created with `0700` permissions. `claude` runs with `CLAUDE_CONFIG_DIR` set to it. On macOS the login is a Keychain entry that `claude` names after that folder.
- Claudine never reads, stores or sends a token or password. Sign-in, status and sign-out are `claude auth login`, `claude auth status` and `claude auth logout`, run by Rust. `accounts.json` keeps only ids, labels and colors. The email and plan shown are read fresh from `claude auth status`.
- The webview only sends account ids. Rust looks each id up in its own list, and ids are lowercase letters, digits and `-`, so the webview can't name a folder. Labels and colors are checked; a broken or hand-edited file is cleaned when loaded.
- For an added account, Rust removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` from `claude`'s environment, so a shared key can't stand in for the account's own login. The default account uses `~/.claude` and keeps the environment as is.
- `claude auth` runs with the accounts folder as its working folder, never a project, so a project's `.claude/` settings can't change how it signs in.
- Versions of `claude` without an `auth` command read `auth status` as a prompt and start a session. Before every `claude auth` command, Rust checks `claude auth --help`, which never starts one, and refuses older versions.
- The sign-in code from the browser fallback is passed to `claude` only if it's printable ASCII without spaces, so it can't answer a second prompt.
- Removing an account runs `claude auth logout` first, so its Keychain entry is deleted, then deletes the folder. If sign-out fails, the account is kept. A folder left behind is never reused for a new account.
- The default account can't be signed out from Claudine, because that would also sign out the terminal.

## Markdown preview

- The preview parses Markdown in TypeScript and builds DOM nodes. Nothing is inserted as HTML: raw HTML in a file is shown as its text. Images aren't loaded, and web links don't navigate; they show their address. Links to other project files open them in the editor, through the normal path checks.

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
