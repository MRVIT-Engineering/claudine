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
| The `From` trait and `?` | introduced | apps/desktop/src-tauri/src/error.rs | `?` converts error types through `From` impls |
| `#[serde(rename_all)]` | introduced | apps/desktop/src-tauri/src/error.rs | Rust names to camelCase for TypeScript |
| `Mutex` and lock guards | introduced | apps/desktop/src-tauri/src/project.rs | `lock()` can fail if a thread panicked; `*guard =` writes through |
| `Option` and `let ... else` | introduced | apps/desktop/src-tauri/src/project.rs | Unwrap or exit early; no forgotten `undefined` |
| `tauri::State<'_, T>` | introduced | apps/desktop/src-tauri/src/project.rs | Managed state; the `'_` lifetime isn't explained yet |
| `sort_by` with `Ordering` | introduced | apps/desktop/src-tauri/src/files.rs | Comparators return Less/Equal/Greater; `then_with` breaks ties |
| `Option::as_deref` | introduced | apps/desktop/src-tauri/src/project.rs | `Option<String>` to `Option<&str>` |
| `String::from_utf8` | introduced | apps/desktop/src-tauri/src/files.rs | Fails on invalid UTF-8 instead of replacing bytes |
| `as` casts | introduced | apps/desktop/src-tauri/src/files.rs | Number types never mix implicitly |
| `while let` | introduced | apps/desktop/src-tauri/src/files.rs | Loop while a pattern matches; a `Vec` as a stack |
| `Default` and `#[serde(default)]` | introduced | apps/desktop/src-tauri/src/settings.rs | Missing fields fall back to defaults, like `{ ...defaults, ...saved }` |
| Methods taking `self` by value | introduced | apps/desktop/src-tauri/src/settings.rs | `sanitized(mut self)`: the unchecked value can't be used afterwards |
| `Clone` and `.clone()` | introduced | apps/desktop/src-tauri/src/settings.rs | Explicit copies, needed to return data from behind a lock |
| Slices (`&[String]`) | introduced | apps/desktop/src-tauri/src/files.rs | Borrow any run of elements without copying |
| `Box<dyn Error>` | introduced | apps/desktop/src-tauri/src/main.rs | Any error type behind a pointer, so `?` works in `setup` |

## Exercises
| Exercise | File | Status |
|---|---|---|

## Session log

- **2026-11-05, initial setup (explain mode):** wrote `protocol`, `core`, `hook` and the Tauri backend. Introduced 11 concepts across 6 changes. No compiler errors. No exercises.
- **2026-11-05, project walkthrough:** explained every Rust file and how the crates connect. Introduced packages/crates and macros. No code changed.
- **2026-11-05, path guard (explain mode):** Claude wrote `crates/core/src/path_guard.rs` with `cap-std`. Introduced 10 concepts across 5 changes. The user's line-by-line review is still open. No exercises: security-critical code.
- **2026-11-05, open and browse a folder (explain mode):** Claude wrote the project commands in `apps/desktop/src-tauri` at the user's request. Introduced 10 concepts. One test expectation was wrong, not the code. Still owed: explaining the `'_` lifetime in `State<'_, T>`.
- **2026-11-06, settings stored by Rust (explain mode):** Claude wrote `settings.rs` and wired the hidden names into `files.rs`. Introduced 5 concepts across 3 changes. No compiler errors. Still owed: the `'_` lifetime.
