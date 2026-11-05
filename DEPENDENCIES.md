# Dependencies

Every direct dependency, with the reason it's here.

## Rust

| Crate | Version | Used by | Reason |
|---|---|---|---|
| `cap-std` | 3.4.6 | `crates/core` | Opens files relative to a directory handle, so paths can't escape the project, even in a symlink race. |
| `serde` | 1.0.229 | `crates/protocol` | Derives serialization for messages between the hook and the app. |
| `serde_json` | 1.0.154 | `crates/protocol` | JSON wire format for those messages. |
| `tauri` | 2.12.5 | `apps/desktop/src-tauri` | Desktop app framework: window, webview, IPC. |
| `tauri-build` | 2.7.4 | `apps/desktop/src-tauri` (build) | Compiles the config, capabilities and command permissions at build time. |

## npm

| Package | Version | Used by | Reason |
|---|---|---|---|
| `solid-js` | 1.9.17 | `apps/desktop` | UI framework. |
| `@codemirror/view` | 6.43.15 | `apps/desktop` | The code editor's DOM view. |
| `@codemirror/state` | 6.7.6 | `apps/desktop` | Editor documents, selections and transactions. |
| `@codemirror/commands` | 6.11.1 | `apps/desktop` | Editing keybindings and undo history. |
| `@codemirror/language` | 6.13.1 | `apps/desktop` | Syntax highlighting, indentation and bracket matching. |
| `@codemirror/search` | 6.7.2 | `apps/desktop` | Find and replace. |
| `@codemirror/merge` | 6.12.3 | `apps/desktop` | Aligned side-by-side and inline diff review. |
| `@codemirror/lang-rust` | 6.0.2 | `apps/desktop` | Rust syntax support. |
| `@lezer/highlight` | 1.2.5 | `apps/desktop` | Maps syntax tokens to our theme's classes, and colors code outside the editor. |
| `@tauri-apps/api` | 2.12.4 | `apps/desktop` | `invoke`, the call from the UI to Rust commands. |
| `@tauri-apps/cli` | 2.12.4 | `apps/desktop` (dev) | `tauri dev` and `tauri build`. |
| `typescript` | 7.0.2 | `apps/desktop` (dev) | Type checking with `tsc --noEmit`. |
| `vite` | 8.3.5 | `apps/desktop` (dev) | Dev server and bundler. |
| `vite-plugin-solid` | 2.11.14 | `apps/desktop` (dev) | Compiles Solid JSX for Vite. |
| `@biomejs/biome` | 2.6.3 | root (dev) | Formatting and linting; replaces ESLint + Prettier. |

## Tools (not linked into the app)

| Tool | Version | Reason |
|---|---|---|
| `cargo-deny` | 0.20.2 | Checks licenses, advisories and sources, locally and in CI. |
| `pnpm` | 12.16.1 | Package manager, pinned through `packageManager`. |

## CI actions

| Action | Version | Reason |
|---|---|---|
| `actions/checkout` | v7.0.1 | Checks out the repo. |
| `pnpm/action-setup` | v6.1.0 | Installs the pinned pnpm. v6.1.1 was under 7 days old when pinned. |
| `actions/setup-node` | v7.1.0 | Installs Node. |
