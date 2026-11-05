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
- **File access:** every project file operation goes through `ProjectRoot` in `crates/core/src/path_guard.rs`: get the path from `read_path` or `write_path`, then use `dir()`. Never use `std::fs` on project files.
- **Capabilities and CSP:** keep them minimal. Don't add `core:default`, fs, shell, http or opener permissions, remote sources or `unsafe-eval` without asking.
- **CodeMirror:** mount every editor in a shadow root through `createEditorRoot` in `apps/desktop/src/lib/codemirror.tsx`, and pass it as `root`. In a normal document CodeMirror adds a `<style>` tag, which the CSP blocks. Don't relax `style-src` to work around this.
- **Devtools:** never enable tauri's `devtools` Cargo feature; it would ship the inspector in release builds.
- **Dependencies:** check the current version before pinning. Ask before adding one, and prefer ~20 lines of code over a dependency.
- **npm release age:** `minimumReleaseAge` is 7 days, so pin versions at least that old. Don't add entries to `allowBuilds` without review.
- **cargo-deny:** don't allow a new license globally or ignore a new advisory without asking. Record accepted advisories in `SECURITY.md`.
- **CI:** pin actions to a full commit SHA with the version in a comment.
