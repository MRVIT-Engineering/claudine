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
| `tauri::State<'_, T>` | introduced | apps/desktop/src-tauri/src/project.rs | Managed state; `'_` means it borrows from something the caller owns |
| `sort_by` with `Ordering` | introduced | apps/desktop/src-tauri/src/files.rs | Comparators return Less/Equal/Greater; `then_with` breaks ties |
| `Option::as_deref` | introduced | apps/desktop/src-tauri/src/project.rs | `Option<String>` to `Option<&str>` |
| `String::from_utf8` | introduced | apps/desktop/src-tauri/src/files.rs | Fails on invalid UTF-8 instead of replacing bytes |
| `as` casts | introduced | apps/desktop/src-tauri/src/files.rs | Number types never mix implicitly |
| `while let` | introduced | apps/desktop/src-tauri/src/files.rs | Loop while a pattern matches; a `Vec` as a stack |
| `Default` and `#[serde(default)]` | introduced | apps/desktop/src-tauri/src/settings.rs | Missing fields fall back to defaults, like `{ ...defaults, ...saved }` |
| Methods taking `self` by value | introduced | apps/desktop/src-tauri/src/settings.rs | `sanitized(mut self)`: the unchecked value can't be used afterwards |
| `Clone` and `.clone()` | introduced | apps/desktop/src-tauri/src/settings.rs | Explicit copies, needed to return data from behind a lock |
| Slices (`&[String]`) | introduced | apps/desktop/src-tauri/src/files.rs | Borrow any run of elements without copying |
| `std::process::Command` and pipes | introduced | apps/desktop/src-tauri/src/claude.rs | Like `child_process.spawn`; `take()` moves each pipe out of the `Child` |
| `serde_json::Value` and `json!` | introduced | apps/desktop/src-tauri/src/claude.rs | Untyped JSON; a missing key indexes to `Null` instead of panicking |
| `HashMap` | introduced | apps/desktop/src-tauri/src/claude.rs | One key type and one value type; `remove` returns the value, which makes "answer once" easy |
| The `'_` lifetime | introduced | apps/desktop/src-tauri/src/accounts.rs | `MutexGuard<'_, T>` borrows from `self`, so it can't outlive it |
| Extension traits (`DirBuilderExt`) | introduced | apps/desktop/src-tauri/src/accounts.rs | Unix-only methods such as `mode`, once the trait is in scope |
| `Box<dyn Error>` | introduced | apps/desktop/src-tauri/src/main.rs | Any error type behind a pointer, so `?` works in `setup` |
| Trait objects (`Arc<dyn Fn>`) | introduced | apps/desktop/src-tauri/src/claude.rs | A callback type chosen at runtime, like `(event) => void`; `Send + Sync` lets threads share it |
| `matches!` | introduced | apps/desktop/src-tauri/src/runs.rs | `match` that answers yes or no; used for the run state transition table |
| Tauri-injected command arguments (`WebviewWindow`) | introduced | apps/desktop/src-tauri/src/project.rs | Filled in by Tauri from the caller, never sent by JavaScript, so its label is a safe key |
| `static` items with atomics | introduced | apps/desktop/src-tauri/src/main.rs | One value for the whole program; changing one needs a thread-safe type such as `AtomicUsize` |
| `try_fold` | introduced | apps/desktop/src-tauri/src/proposal.rs | `reduce` that stops at the first `None` or `Err` |
| Platform-specific code (`#[cfg(target_os)]`, target dependencies) | introduced | apps/desktop/src-tauri/src/recent.rs | Code and crates for one OS are left out of the build elsewhere; a stub keeps the call sites the same |
| Proof tokens (`MainThreadMarker`) | introduced | apps/desktop/src-tauri/src/recent.rs | A value you can only get when a rule holds, so the compiler makes callers prove it |
| `Hash` and `Hasher` | introduced | apps/desktop/src-tauri/src/files.rs | A value feeds itself into a hasher; `finish` gives a `u64`. `DefaultHasher::new()` is the same every run, unlike `HashMap`'s random one |
| `OpenOptions::create_new` | introduced | apps/desktop/src-tauri/src/files.rs | Like `fs.open(path, "wx")`: fails instead of overwriting, so a temp file never clobbers another |
| `cfg!` vs `#[cfg]` | introduced | crates/core/src/path_guard.rs | `cfg!(windows)` is a `true`/`false` constant, so the code still compiles and is checked on every OS; `#[cfg]` removes it |
| Nested patterns in `matches!` with a guard | introduced | apps/desktop/src-tauri/src/platform.rs | `Some(Component::Prefix(p)) if ...` checks several layers in one step |
| Byte strings (`b"..."`) and `&[u8]` | introduced | apps/desktop/src-tauri/src/images.rs | `b"GIF8"` is bytes, not text; `starts_with` on slices compares bytes |
| Bit shifts and masks (`<<`, `\|`) | introduced | apps/desktop/src-tauri/src/images.rs | Same as JavaScript, but on a fixed-width type (`u32`), with no silent conversion to float |

## Exercises
| Exercise | File | Status |
|---|---|---|

## Session log

- **2026-11-05, initial setup (explain mode):** wrote `protocol`, `core`, `hook` and the Tauri backend. Introduced 11 concepts across 6 changes. No compiler errors. No exercises.
- **2026-11-05, project walkthrough:** explained every Rust file and how the crates connect. Introduced packages/crates and macros. No code changed.
- **2026-11-05, path guard (explain mode):** Claude wrote `crates/core/src/path_guard.rs` with `cap-std`. Introduced 10 concepts across 5 changes. The user's line-by-line review is still open. No exercises: security-critical code.
- **2026-11-05, open and browse a folder (explain mode):** Claude wrote the project commands in `apps/desktop/src-tauri` at the user's request. Introduced 10 concepts. One test expectation was wrong, not the code. Still owed: explaining the `'_` lifetime in `State<'_, T>`.
- **2026-11-06, settings stored by Rust (explain mode):** Claude wrote `settings.rs` and wired the hidden names into `files.rs`. Introduced 5 concepts across 3 changes. No compiler errors. Still owed: the `'_` lifetime.
- **2026-11-08, Claude sessions (explain mode):** Claude wrote `claude.rs` and `trust.rs`: running the user's `claude` with stream-json, Rust-side permission answers, and a per-folder trust prompt. Introduced 3 concepts; reused threads, `Arc`, `Mutex` and `Drop`. Clippy and the compiler passed first time. Tests include a fake `claude` shell script. Still owed: the `'_` lifetime.
- **2026-11-09, Claude accounts, modes and models (explain mode):** Claude wrote `accounts.rs` (config folder per account, `claude auth` login, status and logout) and mode and model switching in `claude.rs`. Introduced 2 concepts and paid the owed `'_` lifetime. Clippy caught a test helper that never reaped its child process (`zombie_processes`). A real run showed that old `claude` versions read `auth status` as a prompt, so Rust now checks `claude auth --help` first.
- **2026-11-09, Agentic mode (explain mode):** Claude wrote `git.rs` (worktrees, snapshots through a temporary index, diff parsing) and `runs.rs` (run states, finishing, review actions), and made `claude.rs`'s relay send to any sink. Introduced trait objects and `matches!`. One bug caught while testing: a stopped process's late "exited" event could remove its replacement, fixed with a generation number per launch. 21 new tests, including an end-to-end run against a fake `claude`, and one opt-in test against the real one.
- **2026-11-10, several windows (explain mode):** Claude made the open project and the Claude session per window (`HashMap` by window label instead of `Option`), added File › New Window, cleaned up a window's project and `claude` process when it closes, and renamed the app to Claudine. Introduced Tauri-injected arguments and `static` atomics. Clippy and the existing tests passed first time; no new tests.
- **2026-11-10, proposed edits as diffs (explain mode):** Claude wrote `proposal.rs`: for a Write, Edit or MultiEdit inside the project, Rust reads the file through the path guard and applies the edit, so the webview can show before and after as a CodeMirror diff, in the chat card and in the editor. Introduced `try_fold`. One compiler error: a test built `Relay` without the new field. 4 new tests.
- **2026-11-10, recent folders in the Dock (explain mode):** Claude wrote `recent.rs`, which reports each folder opened from the picker to macOS's `NSDocumentController`, and handled `RunEvent::Opened` in `main.rs` to open a folder macOS sends in the window that has it, an empty window, or a new one. Introduced platform-specific code and proof tokens. Clippy passed first time; no new tests, since both paths need AppKit.
- **2026-11-10, mode and model per run (explain mode):** Claude added `mode` and `model` to `RunRecord` with `#[serde(default)]`, so older `runs.json` files still load, plus `RunOptions`, `set_run_options`, `mode_flag` and `valid_model`. No new concepts; reused `Option`, `matches!` and serde defaults. Clippy passed first time; one new test.
- **2026-11-10, saving (explain mode):** Claude wrote `save_file` in `files.rs` (atomic temp-file-and-rename through the guard's `Dir`, version check, kept permissions) and made `read_file` return a version. Introduced `Hash`/`Hasher` and `create_new`. The compiler caught three callers that still expected `read_file` to return a `String`. 4 new tests, including conflicts, permissions and refusals.
- **2026-11-10, models, effort, blame and gitignore (explain mode):** Claude added `Effort` and per-model effort levels, a model-list probe (`list_models`, an `mpsc` channel with `recv_timeout`), Editor sessions that restart with `--resume` when effort changes (events from the replaced process are muted with an `AtomicBool`), a one-line `git blame` with stdin, and gitignored paths left out of the file list. No new concepts on the list; reused `Arc`, atomics, `Mutex`, closures and threads. One test failed because the helper repo already had `a.txt` committed by someone else. 4 new tests.
- **2026-11-10, Git panel (explain mode):** Claude wrote `history.rs`: read-only `git log` (with `%x1f`/`%x1e` separators), a commit's files from `--name-status -z`, uncommitted changes, and a file's before and after. Commit ids are checked to be hex so they can't be options. No new concepts; reused `Option::transpose`, iterators and `match`. 2 new tests.
- **2026-11-10, pasted images (explain mode):** Claude wrote `images.rs`: image types as a serde enum with per-variant `rename`, a base64 well-formedness check, decoding the first bytes to check the file signature, and API content blocks. `send_message` now takes images. Introduced 2 concepts. One clippy note (`is_multiple_of`). No exercises.
- **2026-11-13, Windows build support (explain mode):** Claude added `platform.rs` (process creation without a console, `.exe`-only program lookup, `cmd.exe` checks, canonical paths without the `\\?\` prefix), Windows-only name rules and short-name protection in the path guard, junction attack tests, and a Windows CI job. Introduced `cfg!` vs `#[cfg]` and nested patterns in `matches!`. Clippy flagged a needless `&` and two imports left unused once spawning moved to `platform::command`; three tests failed on Windows at first: opening a folder as a file gives `PermissionDenied`, a folder can't be deleted while a handle holds it, and `cmd` keeps the space in `echo hello && ...`.
