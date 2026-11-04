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

## Exercises
| Exercise | File | Status |
|---|---|---|

## Session log

- **2026-11-05, initial setup (explain mode):** wrote `protocol`, `core`, `hook` and the Tauri backend. Introduced 11 concepts across 6 changes. No compiler errors. No exercises.
