# Rust learning progress

Mode: explain

## Concepts
| Concept | Status | First seen in | Notes |
|---|---|---|---|
| Workspace inheritance (`.workspace = true`) | introduced | Cargo.toml | Features are additive across the build |
| `enum` (tagged, with serde) | introduced | crates/protocol/src/lib.rs | Discriminated union; `match` is exhaustive |
| `#[derive]` | introduced | crates/protocol/src/lib.rs | Generated trait impls, no runtime reflection |
| `Result` and `?` | introduced | crates/protocol/src/lib.rs | Errors are values in the signature |
| Borrowing with `&` | introduced | crates/protocol/src/lib.rs | Lends without giving up ownership |
| Modules (`pub mod`) | introduced | crates/core/src/lib.rs | Undeclared files aren't compiled |
| `#[cfg(test)]` | introduced | crates/core/src/lib.rs | Conditional compilation; absent from normal builds |
| `mut` and `&mut` | introduced | crates/hook/src/main.rs | Immutable by default; a `&mut` loan is exclusive |
| Traits must be in scope | introduced | crates/hook/src/main.rs | `use std::io::Read` enables `.read_to_string()` |
| `&'static str` vs `String` | introduced | apps/desktop/src-tauri/src/main.rs | Borrowed for the whole program vs owned on the heap |
| `expect` and panics | introduced | apps/desktop/src-tauri/src/main.rs | Panic for unrecoverable states, `Result` otherwise |
| Package, crate, lib vs bin targets | introduced | Cargo.toml | One package, one `lib.rs` and/or `main.rs` |
| Macros (`name!`) | introduced | apps/desktop/src-tauri/src/main.rs | Generate code at compile time; `!` marks them |
| `match` on enums with data | introduced | crates/core/src/path_guard.rs | Must cover every variant; `Io(kind)` unpacks the payload |
| `impl Trait for Type` | introduced | crates/core/src/path_guard.rs | Implementation lives apart from the type |
| `Path` vs `PathBuf` | introduced | crates/core/src/path_guard.rs | Borrowed vs owned, like `&str` and `String`; not always valid text |
| Newtype with a private field | introduced | crates/core/src/path_guard.rs | Only the guard can create a `RelPath`, so the compiler proves it was checked |
| Closures with `map_err` | introduced | crates/core/src/path_guard.rs | Converts the error type before `?` |
| `Drop` | introduced | crates/core/src/path_guard.rs | Runs at end of scope, even on panic |
| Iterator chains and `collect` | introduced | crates/core/src/path_guard.rs | Lazy; nothing runs until consumed |
| Match guards | introduced | crates/core/src/path_guard.rs | `if` on an arm; a false guard moves on to the next arm |
| `thread::spawn` and `move` | introduced | crates/core/src/path_guard.rs | Real parallel threads; the closure takes ownership |
| `Arc` and atomics | introduced | crates/core/src/path_guard.rs | Thread sharing is explicit and compiler-checked |

## Exercises
| Exercise | File | Status |
|---|---|---|

## Session log

- **2026-11-05, initial setup (explain mode):** wrote `protocol`, `core`, `hook` and the Tauri backend. Introduced 11 concepts across 6 changes. No compiler errors. No exercises.
- **2026-11-05, project walkthrough:** explained every Rust file and how the crates connect. Introduced packages/crates and macros. No code changed.
- **2026-11-05, path guard (explain mode):** Claude wrote `crates/core/src/path_guard.rs` with `cap-std`. Introduced 10 concepts across 5 changes. The user's line-by-line review is still open. No exercises: security-critical code.
