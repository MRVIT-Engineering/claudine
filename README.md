# my-editor

A security-first desktop code editor that wraps the official `claude` CLI. `my-editor` is a placeholder name.

It will run `claude` in an embedded terminal, show full-file diffs of Claude's edits via Claude Code hooks, and have a file tree. It has no extension system, no marketplace, and no network access from the app itself.

**Status:** bare project setup. The app opens a window that shows its version, and nothing else yet.

## Prerequisites

- **Rust**, through [rustup](https://rustup.rs). `rust-toolchain.toml` selects the stable channel.
- **Node.js** 22.12 or newer.
- **pnpm**. Any recent version works: it switches to the version pinned in `package.json`.
- **Tauri system dependencies** for your OS: see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
- **Claude Code**, installed separately from Anthropic's [official channel](https://docs.anthropic.com/en/docs/claude-code). This app never bundles or installs it.
- **cargo-deny**, to run the dependency checks: `cargo install cargo-deny --locked`.

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
| `apps/desktop/src-tauri` | Rust backend for the app |
| `crates/core` | Security logic: path guard, tripwire, audit log |
| `crates/protocol` | Message types shared between the hook and the app |
| `crates/hook` | Hook binary, later bundled as a Tauri sidecar |
| `docs/rust-learning` | Rust learning progress |

See [SECURITY.md](SECURITY.md) for the security invariants and [DEPENDENCIES.md](DEPENDENCIES.md) for why each dependency is here.
