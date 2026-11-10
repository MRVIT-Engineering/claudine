<p align="center">
  <img src="apps/desktop/src-tauri/icons/app-icon.png" alt="Claudine, a purple pixel creature with a bow" width="128" height="128">
</p>

<h1 align="center">Claudine</h1>

<p align="center">
  A security-first desktop code editor built around the official <code>claude</code> CLI.
</p>

---

Claudine is a small, fast editor for working with Claude Code. Claude runs in a chat panel next to your files, and every edit and command waits for your approval. The rules that keep you safe live in the Rust backend, not in the UI.

The packages still use the placeholder name `my-editor`.

## What it does today

- **Open a folder and browse it.** ⌘O opens any folder; the file tree, ⌘⇧O (go to file) and ⌘⇧F (search the project) all work on real files.
- **Read and edit code.** A CodeMirror 6 editor with VS Code-style shortcuts, find and replace, folding, syntax highlighting for 140+ languages, and file icons per language and tool. Edits stay in memory for now, because saving isn't built yet.
- **Talk to Claude Code.** The Claude panel starts your own `claude` install in the open folder. Each file write, edit or command shows up as a request with the content or diff, and runs only after you click Allow. Switch between asking, accepting edits and plan mode (Shift+Tab), and pick the model, from the composer.
- **Several Claude accounts.** Add accounts in Settings, each with its own Claude Code login, and pick one when you start a session. Sign-in is Claude Code's own; Claudine never sees a token.
- **Agentic mode.** Hand Claude a task and it works on its own, in auto mode, on a new branch in its own git worktree, so several runs can work while you keep editing. Watch the conversation and plan, steer it with messages, and see the changes as they happen. When it's done, review it like a pull request: Claude's explanation of every file, check results, line comments, then approve (commit, push and open a PR with `gh`) or request changes for another revision.
- **Preview Markdown.** Turn on Preview above a `.md` file (⇧⌘V) to see it rendered in the same tab.
- **Settings that stick.** Theme, accent, fonts, editor options, hidden files and panel widths are saved per user.

The session, Parallel and Accounts screens from the design are still a preview on mock data, hidden behind `PREVIEW_CLAUDE` in `apps/desktop/src/lib/flags.ts`. See [the development plan](docs/DEVELOPMENT_PLAN.md) for what comes next.

## Security, in short

- **The webview is untrusted.** Path checks, approvals and trust decisions are made in Rust. The UI can only ask.
- **Files stay inside the project.** Every file access goes through a path guard built on [`cap-std`](https://github.com/bytecodealliance/cap-std), which also closes symlink races.
- **Approvals can't be changed by the UI.** Rust keeps each permission request from Claude. The UI answers with an id and yes or no, and Rust sends Claude the input it kept.
- **Folders are trusted explicitly.** Before Claude first runs in a folder, Claudine asks natively, because a project's `.claude/` and `.mcp.json` can run commands.
- **No network from the app.** Only the `claude` process talks to the network, except `git push` and `gh pr create` when you approve an Agentic run, after a native confirmation. No telemetry, no plugins, no extension marketplace, no remote code.
- **Your own Claude Code.** Claudine never bundles, downloads or installs it.

[SECURITY.md](SECURITY.md) has the full list, including known limits.

## Prerequisites

- **Rust**, through [rustup](https://rustup.rs). `rust-toolchain.toml` selects the stable channel.
- **Node.js** 22.12 or newer.
- **pnpm**. Any recent version works: it switches to the version pinned in `package.json`.
- **Tauri system dependencies** for your OS: see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
- **Claude Code**, installed separately from Anthropic's [official channel](https://docs.anthropic.com/en/docs/claude-code), and signed in once in a terminal.
- **cargo-deny**, to run the dependency checks: `cargo install cargo-deny --locked`.

macOS and Linux are supported first. Windows needs its own security review.

## Development

```sh
pnpm install
pnpm dev          # run the app
pnpm build        # build the release binary
pnpm check        # typecheck and cargo check
pnpm lint         # Biome, cargo fmt --check, clippy
pnpm test         # Rust tests
cargo deny check  # licenses, advisories, sources
```

## Layout

| Path | What it is |
|---|---|
| `apps/desktop/src` | SolidJS + TypeScript UI, treated as untrusted |
| `apps/desktop/src-tauri` | Rust backend: project files, settings, Claude sessions |
| `crates/core` | Security logic: path guard, tripwire, audit log |
| `crates/protocol` | Message types shared between the hook and the app |
| `crates/hook` | Hook binary, later bundled as a Tauri sidecar |
| `docs/DEVELOPMENT_PLAN.md` | Milestones and open decisions |
| `docs/rust-learning` | Rust learning progress |

[CLAUDE.md](CLAUDE.md) has the rules for changing the code, and [DEPENDENCIES.md](DEPENDENCIES.md) explains why each dependency is here.
