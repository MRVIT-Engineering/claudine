# Dependencies

Every direct dependency, with the reason it's here.

## Rust

| Crate | Version | Used by | Reason |
|---|---|---|---|
| `cap-std` | 3.4.6 | `crates/core`, `apps/desktop/src-tauri` | Opens files relative to a directory handle, so paths can't escape the project, even in a symlink race. The app uses its `OpenOptions` to save through the guard's handle. |
| `serde` | 1.0.229 | `crates/protocol` | Derives serialization for messages between the hook and the app. |
| `serde_json` | 1.0.154 | `crates/protocol`, `apps/desktop/src-tauri` | JSON wire format for hook messages, and the settings file. |
| `tauri` | 2.12.5 | `apps/desktop/src-tauri` | Desktop app framework: window, webview, IPC. |
| `tauri-plugin-dialog` | 2.8.4 | `apps/desktop/src-tauri` | Native folder picker, called only from Rust. The webview has no `dialog:*` permission. |
| `objc2` | 0.6.5 | `apps/desktop/src-tauri` (macOS) | `MainThreadMarker`, the proof that AppKit is called from the main thread. Already built by Tauri. |
| `objc2-foundation` | 0.3.2 | `apps/desktop/src-tauri` (macOS) | `NSURL` for a folder, to hand to AppKit. Only the `NSURL` and `NSString` features. Already built by Tauri. |
| `objc2-app-kit` | 0.3.2 | `apps/desktop/src-tauri` (macOS) | `NSDocumentController`, which adds opened folders to the Dock menu's recent list. Tauri has no API for it. Only the `NSDocumentController` feature. Already built by Tauri. |
| `tauri-build` | 2.7.4 | `apps/desktop/src-tauri` (build) | Compiles the config, capabilities and command permissions at build time. |

## npm

| Package | Version | Used by | Reason |
|---|---|---|---|
| `solid-js` | 1.9.17 | `apps/desktop` | UI framework. |
| `@codemirror/view` | 6.43.15 | `apps/desktop` | The code editor's DOM view. |
| `@codemirror/state` | 6.7.6 | `apps/desktop` | Editor documents, selections and transactions. |
| `@codemirror/autocomplete` | 6.20.4 | `apps/desktop` | Completion popup, snippets and auto-closing brackets. |
| `@codemirror/commands` | 6.11.1 | `apps/desktop` | Editing keybindings and undo history. |
| `@codemirror/language` | 6.13.1 | `apps/desktop` | Syntax highlighting, indentation and bracket matching. |
| `@codemirror/search` | 6.7.2 | `apps/desktop` | Find and replace. |
| `@codemirror/merge` | 6.12.3 | `apps/desktop` | Aligned side-by-side and inline diff review. |
| `@codemirror/lang-rust` | 6.0.2 | `apps/desktop` | Rust syntax support, loaded up front for the code previews outside the editor. |
| `@codemirror/language-data` | 6.5.2 | `apps/desktop` | Recognizes about 140 languages by file name and loads each one only when a file needs it. Brings in the official `@codemirror/lang-*` packages and `legacy-modes`, all MIT. |
| `@lezer/highlight` | 1.2.5 | `apps/desktop` | Maps syntax tokens to our theme's classes, and colors code outside the editor. |
| `@tauri-apps/api` | 2.12.4 | `apps/desktop` | `invoke`, the call from the UI to Rust commands. |
| `@tauri-apps/cli` | 2.12.4 | `apps/desktop` (dev) | `tauri dev` and `tauri build`. |
| `typescript` | 7.0.2 | `apps/desktop` (dev) | Type checking with `tsc --noEmit`. |
| `vite` | 8.3.5 | `apps/desktop` (dev) | Dev server and bundler. |
| `vite-plugin-solid` | 2.11.14 | `apps/desktop` (dev) | Compiles Solid JSX for Vite. |
| `next` | 16.4.5 | `apps/website` | The project website, built as a static export: plain HTML, CSS and JS, no server. Not part of the app. Its optional `sharp` has no install script. |
| `react` | 19.2.9 | `apps/website` | Next.js's UI library. |
| `react-dom` | 19.2.9 | `apps/website` | Renders React for Next.js. |
| `@types/react` | 19.2.18 | `apps/website` (dev) | React types. |
| `@types/react-dom` | 19.2.7 | `apps/website` (dev) | React DOM types. |
| `typescript` | 7.0.2 | `apps/website` (dev) | Type checking with `tsc --noEmit`, same version as the app. |
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
