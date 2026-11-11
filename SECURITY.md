# Security

## Reporting a vulnerability

TODO: add a private contact for security reports.

Please don't open a public issue for a vulnerability.

## Security invariants

- The webview is untrusted. All security decisions (path checks, approvals, tripwire, audit) live in Rust, never in TypeScript.
- The app makes no network requests. Only the `claude` process talks to the network. The one exception is approving an Agentic run with "Open GitHub PR": then Rust runs the user's own `git push` and `gh pr create`, after a native confirmation (see Agentic runs).
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
- **Modes and models** change through `claude`'s control messages, never through CLI arguments. Rust accepts only the modes *default*, *acceptEdits* and *plan*, as a Rust enum. `bypassPermissions` and `auto` aren't offered in the Editor chat, because they let `claude` approve tools itself. Auto mode is only for Agentic runs, which work in their own worktree (see below). A model is passed on only if it's in the list `claude` sent for this session.
- In *accept edits* mode, `claude` approves file edits inside the folder without asking Claudine. Commands still ask. The composer shows the mode in amber while it's on.
- Ending a session, opening another folder or quitting kills the process.
- To list an account's models before any session runs, Rust starts `claude` once per account in an empty `model-list` folder in the app data folder, never a project, asks `initialize`, and stops it. No message is sent to a model. The user's own global Claude Code settings and hooks still apply, as they do for every session.
- Pasted images go to `claude` as API image blocks, never as files on disk. Rust accepts only PNG, JPEG, GIF and WebP, at most 10 per message and 5 MB of base64 each, checks the base64 is well-formed, and checks the first bytes match the declared type, before the message reaches `claude`. The webview draws thumbnails with `createImageBitmap` on a canvas, so the CSP's `img-src 'self'` is unchanged.
- The Git panel only reads: `git log`, `git show`, `git diff HEAD --name-status` and `git ls-files`, in the open folder. Paths from the webview go through the guard's `read_path`; commit ids must be 4 to 40 hex digits, so neither can be read as an option. Uncommitted file text is read through the guard, not by git.
- Inline blame runs `git blame --porcelain -L n,n -- <path>` in the open folder, read-only. The path goes through the guard's `read_path` first; an edited buffer is passed on stdin with `--contents -`.
- Cmd+Shift+O and project search skip gitignored paths, from a read-only `git ls-files --others --ignored --exclude-standard --directory`.
- Saving goes through the path guard's `write_path`, so it refuses `.git`, paths through a symlink and paths outside the project, and `.claude/` and `.mcp.json` for now. It writes a temp file beside the original, flushes it and renames it over, through the project's directory handle. It only replaces existing files, and refuses when the file changed on disk since it was read, unless the user chose Overwrite.
- Besides the native picker, folders open only when macOS sends them: a recent folder in the Dock menu, a folder dropped on the Dock icon, or Finder's Open With. Rust takes only local folders from that list, and they go through the same trust prompt before `claude` runs. Info.plist declares folders with the rank `Alternate`, so Claudine never becomes the default app for them.
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

## Agentic runs

A run is `claude` working on its own on a new branch, in a git worktree under the app data folder (`worktrees/<id>`), then waiting for the user's review. See `docs/agentic-mode.md`.

- **Where it works.** Rust makes the branch (`<prefix><slug>`, checked with `git check-ref-format`) and the worktree with `git worktree add`, which leaves the main checkout's files and branch alone. Every git command that changes anything runs in the run's worktree or on the run's branch. Discarding deletes only a worktree inside Claudine's own worktrees folder, and only the run's branch.
- **Permissions.** Runs use `--permission-mode auto` when the installed `claude` lists it, `acceptEdits` plus a short allowlist of build, test and read-only git commands when it doesn't, or `acceptEdits` or `default` when the user picks them. Whatever the mode, Rust passes `ask` rules with `--settings` for `git push`, package installs (npm, pnpm, yarn, bun, pip, uv, cargo, brew, gem, go get), `rm`, `curl`, `wget`, `WebFetch`, `WebSearch` and every command on the user's deny list. These come to Claudine as approval cards, answered the same way as in the Editor chat. Verified with Claude Code 2.1.309: an `ask` rule still asks in auto mode.
- **No account switching.** A run stays on the account it started on. A usage limit pauses it and says so; nothing moves it to another account. Signing an account out or removing it stops its runs.
- **Pushing and pull requests.** Nothing is committed, pushed or opened without the user's approval in the review. Approving shows a native dialog from Rust that names the branch and the target. Only then does Rust commit in the worktree, run `git push --set-upstream origin <branch>` and `gh pr create`, with the user's own git and `gh` credentials. Prompts are disabled, so neither can wait for input. A compromised webview can call the command, but can't answer the dialog.
- **Check commands.** Detected checks (`cargo test`, the project's test script, `pytest`) run as they are, like any command Claude runs in the worktree. Commands typed in Settings could be anything the webview set, so each list runs only after the user confirms it once in a native dialog; the confirmed lists are kept in `runs/approved-checks.json`. Checks run with `sh -c` in the worktree and are killed after 15 minutes.
- **What's stored.** `runs/runs.json` in the app data folder keeps each run's record, including real paths, which never go to the webview. `runs/<id>/events.jsonl` keeps the conversation as Claudine's own summarized events. Nothing from an account's config folder is read or stored.
- **What the webview sends.** Run ids, the task, a base branch name (checked against the repository's branches), comments and choices. Never a path, a command or a CLI argument.
- **Limits:**
  - A run's worktree is trusted for Editor sessions, since Claudine made it from a trusted project.
  - Auto mode's own judgment decides everything not covered by an `ask` rule. Deleting files outside the worktree is covered only through `rm`; other ways to delete aren't caught.
  - Claude's explanation and the PR description are Claude's text, shown and sent as they are.

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
