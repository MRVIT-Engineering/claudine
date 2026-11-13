# my-editor

A security-first desktop code editor that wraps the official `claude` CLI. `my-editor` is a placeholder name.

## Security invariants

- The webview is untrusted. All security decisions (path checks, approvals, tripwire, audit) live in Rust, never in TypeScript.
- The app makes no network requests. Only the `claude` process talks to the network.
- Never bundle, download, or install Claude Code. Use the user's own install.
- No plugin, extension, theme-download or remote-code mechanism, ever.
- Every new dependency is recorded in `DEPENDENCIES.md` with a reason.
- Use the `rust-mentor` skill whenever writing or changing Rust.

## Layout

- `apps/desktop/src`: SolidJS + TypeScript UI (untrusted).
- `apps/desktop/src-tauri`: Rust backend for the app.
- `crates/core`: security logic: path guard, tripwire, audit log.
- `crates/protocol`: message types shared between the hook and the app.
- `crates/hook`: hook binary, later bundled as a Tauri sidecar.
- `docs/rust-learning/PROGRESS.md`: Rust learning state, kept by the `rust-mentor` skill.

## Commands

Run from the repo root:

- `pnpm dev`: run the app.
- `pnpm check`: typecheck and `cargo check`.
- `pnpm lint`: Biome, `cargo fmt --check`, clippy.
- `pnpm test`: Rust tests.
- `cargo deny check`: licenses, advisories, sources.

## Rules for changes

- **New Tauri command:** add it to `AppManifest::commands` in `apps/desktop/src-tauri/build.rs` and grant only what's needed in `capabilities/`. Commands are deny-by-default.
- **Webview to Rust:** the UI reaches files only through `apps/desktop/src/backend.ts`, which calls the commands in `apps/desktop/src-tauri/src/project.rs`. Paths sent are relative to the project; Rust never sends absolute paths back.
- **Claude sessions:** Rust runs `claude` in `apps/desktop/src-tauri/src/claude.rs` and keeps every permission request. The webview only sends an id with allow or deny; never let it send tool input, a path to `claude`, or extra CLI arguments. The webview's session state is `apps/desktop/src/state/claude.ts`.
- **Claude accounts:** Rust keeps the list and runs `claude auth` in `apps/desktop/src-tauri/src/accounts.rs`. The webview sends only account ids, never a folder or a token, and Claudine never reads a token. Run every `claude` through `use_account`, so the account's folder and environment are set. The webview's account state is `apps/desktop/src/state/accounts.ts`.
- **Modes and models:** switch them with control messages (`set_mode`, `set_model` in `claude.rs`), never with CLI arguments. Don't offer `bypassPermissions` or `auto` in the Editor chat. Effort is the one exception: `claude` has no control message for it, so it's `--effort`, from the Rust `Effort` enum only. Changing it restarts the Editor session with `--resume`.
- **Agentic runs:** Rust owns runs in `apps/desktop/src-tauri/src/runs.rs` and runs git in `git.rs`. Auto mode is allowed only there, with the `ALWAYS_ASK` rules. Git commands that change anything run only in a run's worktree or on its branch. Pushing, opening a PR, discarding and custom check commands each need a native confirmation from Rust. Never switch a run's account. The webview's run state is `apps/desktop/src/state/runs.ts`; the plan is `docs/agentic-mode.md`.
- **Settings:** Rust owns them (`apps/desktop/src-tauri/src/settings.rs`), in `settings.json` in the user's app config folder. A new setting goes in the Rust `Settings` struct with a default and a range check in `sanitized`, and in the TypeScript `Settings` type. Don't keep real settings in `localStorage`.
- **Markdown preview:** `apps/desktop/src/lib/markdown.ts` parses, `components/MarkdownPreview.tsx` renders. Build DOM nodes only; never use `innerHTML`, render raw HTML, load images or navigate to links.
- **Design preview:** the session, chat, Parallel and Accounts screens run on mock data in `apps/desktop/src/mock/` and stay hidden unless `PREVIEW_CLAUDE` is on. Don't mix mock data into real file views.
- **Processes and platforms:** start every process with `platform::command` and find programs with `platform::find_program` (`apps/desktop/src-tauri/src/platform.rs`), never `Command::new` outside tests: on Windows it hides the console and only runs `.exe`, never `.cmd` or `.bat`. Canonicalize with `platform::canonicalize`. Send project paths to the webview `/`-separated (`RelPath::to_slash_string`), on Windows too.
- **File access:** every project file operation goes through `ProjectRoot` in `crates/core/src/path_guard.rs`: get the path from `read_path` or `write_path`, then use `dir()`. Never use `std::fs` on project files.
- **Capabilities and CSP:** keep them minimal. Don't add `core:default`, fs, shell, http or opener permissions, remote sources or `unsafe-eval` without asking.
- **CodeMirror:** mount every editor in a shadow root through `createEditorRoot` in `apps/desktop/src/lib/codemirror.tsx`, and pass it as `root`. In a normal document CodeMirror adds a `<style>` tag, which the CSP blocks. Don't relax `style-src` to work around this.
- **Devtools:** never enable tauri's `devtools` Cargo feature; it would ship the inspector in release builds.
- **Dependencies:** check the current version before pinning. Ask before adding one, and prefer ~20 lines of code over a dependency.
- **npm release age:** `minimumReleaseAge` is 7 days, so pin versions at least that old. Don't add entries to `allowBuilds` without review.
- **cargo-deny:** don't allow a new license globally or ignore a new advisory without asking. Record accepted advisories in `SECURITY.md`.
- **CI:** pin actions to a full commit SHA with the version in a comment.
