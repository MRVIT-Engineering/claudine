# Development plan

How Claudine goes from a mock UI to a real, usable editor.

**Status:** Milestones 0 to 4 are done: Claudine opens a real folder, browses it and shows its files. A first Claude session runs in a real chat panel (Later, step 2). Next: Milestone 5, saving.

## The first goal: a usable editor

Claudine counts as usable when you can do all of this on real files, in the real app:

- Open any folder as a project, and reopen a recent one.
- Browse the file tree, including large projects.
- Open, edit and save text files.
- Create, rename and delete files and folders.
- Not lose work: unsaved edits are protected, and a save never silently overwrites a change made outside the app.

**Not in this goal:** running `claude`, hooks, real sessions, account linking and real diff review. They come after, in [Later](#later-connecting-claude). Those screens stay in the app as mock data, clearly labelled.

## Who writes what

| Part | Written by | Notes |
|---|---|---|
| Rust commands and app state | You | With the `rust-mentor` skill. Use practice mode to get exercises. |
| `crates/core` path guard | Claude, then explained line by line | The skill rules out exercises in security-critical code. Decided in D1. |
| TypeScript and UI | Claude | Each milestone's UI is wired up once its command exists. |
| Tests | Both | Every command has tests. The guard's attack tests come first. |

## How the pieces fit

```
Webview (untrusted)                 Rust (trusted)
-------------------                 --------------
"open folder" click  ---invoke--->  open_project: shows the native picker itself
                     <--- name ---  keeps the root in ProjectState

read_file("src/a.rs") --invoke--->  path_guard: is this inside the root?
                     <- content --  reads the file, or returns a typed error
```

### Four rules that shape every command

1. **The webview never supplies a project root.** Rust shows the folder picker and stores the result. If `open_project(path)` took a path argument, compromised JavaScript could open `~/.ssh` as a "project".
2. **The webview only sends relative paths**, like `src/main.rs`. Rust resolves them against the stored root through the path guard, with no exceptions.
3. **File commands are `async`.** Tauri runs non-`async` commands on the main thread, so a slow disk would freeze the window.
4. **Each command is granted explicitly.** Add it to `AppManifest::commands` in `build.rs` and to `capabilities/main.json`. The webview gets no `fs`, `shell` or `dialog` permissions.

### Commands for the first goal

| Command | Milestone | Returns | Notes |
|---|---|---|---|
| `open_project()` | 2 | Project name, or nothing if cancelled | Shows the native picker from Rust. No path argument. |
| `current_project()` | 2 | Project name or nothing | Used when the UI loads. |
| `list_dir(path)` | 3 | Sorted entries: name, kind, symlink flag | One level at a time. |
| `read_file(path)` | 4 | Content and a version | Typed errors for too large, binary and so on. |
| `write_file(path, content, expected_version)` | 5 | New version, or a conflict error | Atomic write. |
| `create_file(path)`, `create_dir(path)` | 6 | Nothing | Fails if the path already exists. |
| `rename_path(from, to)` | 6 | Nothing | Both paths go through the guard. |
| `delete_path(path)` | 6 | Nothing | Rust shows the confirmation. See [D3](#decisions-needed). |
| `recent_projects()`, `open_recent(id)` | 7 | List of recents, then the project name | Takes an ID from Rust's own list, never a path. |

### Errors

One Rust enum, serialized with `#[serde(tag = "kind")]`, so the UI can `switch` on it like a discriminated union:

`OutsideProject`, `Protected`, `NotFound`, `AlreadyExists`, `TooLarge`, `NotText`, `Conflict`, `NoProject`, `Io`.

Error messages shouldn't include absolute paths, since the webview has no need to learn them.

## Threats to design for

Every test in Milestone 1 maps to one of these:

| Threat | Example | What stops it |
|---|---|---|
| Path traversal | `read_file("../../.ssh/id_rsa")` | Reject `..` and absolute paths |
| Symlink escape | `notes -> ~/.ssh` inside the project | Resolve symlinks, then check the result |
| Symlink in a parent folder | Creating `link/new.txt` where `link` points outside | `cap-std` refuses to leave the folder, and writes through any symlink are refused |
| Check-then-use race | A path is checked, then swapped for a symlink before the read | `cap-std` resolves each path at the moment of use. Decided in D2. |
| Writing to files that run code | `.git/hooks/*` runs on git commands; `.claude/` can add hooks; `.mcp.json` can add servers | Deny writes to `.git/`; Rust asks for native confirmation on the others |
| Name tricks | `.GIT/hooks/x` on a case-insensitive disk; `.g\u{200c}it` on HFS+; `gitlink/hooks/x` with `gitlink -> .git` | Fold names before comparing, and refuse writes through symlinks |
| Reading huge or binary files | A 2 GB log crashes the webview | Size limit and text check in Rust |

**A limit to state honestly:** the guard keeps file access inside the project. It can't stop compromised JavaScript from writing a malicious `build.rs` inside that project, because editing source is the app's job. The real defense there is keeping the webview hard to compromise: strict CSP, no remote code, and no plugins.

## Milestones

Each milestone ends with something you can run. Sizes are relative: S, M or L.

### Milestone 0: Prepare the UI (done)

- Add `src/backend/`, a typed interface with one function per command and a mock implementation, so `store.ts` stops reading `mock/data.ts` directly. Browser preview keeps working on the mock.
- Label the mock screens. Chat, Parallel and Accounts get a visible "Preview: not connected yet" marker, so demo data can't be mistaken for real activity once real files appear.
- Add the "no project open" screen with an **Open folder** button.

**Done when:** the app looks the same on mock data, and `backend/` is the only route to file data.

### Milestone 1: Path guard (done)

Built in `crates/core/src/path_guard.rs`, using `cap-std`. There are 28 tests, including attacks on a real disk and a symlink race. Each check was also removed in turn to confirm a test fails without it.

**How your commands use it:**

```rust
let project = ProjectRoot::open(&folder_the_user_picked)?; // keep this in ProjectState

let path = project.read_path(raw_from_webview)?;           // or write_path, for any change
let text = project.dir().read_to_string(path.as_path())?;  // always through dir()
```

- Never use `std::fs` on project files. Only `project.dir()` keeps them inside the project.
- `write_path` returns `NeedsConfirmation` for `.claude/` and `.mcp.json`. The native confirmation, and a way to continue after it, comes in Milestone 5.
- `GuardError` isn't `Serialize` yet. Milestone 2's command error type wraps it.

### Milestone 2: Open a folder (done, written by Claude in explain mode)

- Add `tauri-plugin-dialog` and call its folder picker from Rust, without granting the webview any `dialog:*` permission. Prove that with a negative test: calling the dialog from JS must fail. The plugin's docs show `pick_file`, so confirm the folder API when you add it.
- Add `ProjectState`, held with `.manage()` and read through `tauri::State`.
- Write `open_project` and `current_project`, using the shared error enum.

**Done when:** clicking **Open folder** shows the native picker, and the app header shows the real folder name.

**Rust you'll meet:** `Mutex`, `tauri::State`, `async` commands, `map_err`, the `From` trait.

**Exercise idea:** a small pure function such as `project_name(path) -> String`.

### Milestone 3: Show the file tree (done, written by Claude in explain mode)

- Write `list_dir`: folders first, then alphabetical, case-insensitive.
- Hide `.git`, `node_modules`, `target` and `.DS_Store`. A fixed list is enough for now.
- Show symlinks as symlinks, and don't follow them when listing.
- Load folders only when expanded, so big projects stay fast.

**Done when:** the tree shows a real project, including this repo, and stays fast on one with a large `node_modules`.

**Rust you'll meet:** iterators, `sort_by`, `read_dir`, `Vec`, `#[derive(Serialize)]` on your own types.

**Exercise idea:** the sort comparison function.

### Milestone 4: Open and show files (done, written by Claude in explain mode)

- Write `read_file` with a size limit. Start at 5 MB and tune it later.
- Return `NotText` for invalid UTF-8 or NUL bytes, so the UI can show "can't display this file" instead of garbage.
- Return a version alongside the content (see Milestone 5).
- In the UI, load real content into CodeMirror, with loading and error states. Add TOML and Markdown highlighting if you want them; each is a new dependency to approve.

**Done when:** clicking a real file shows its content, and binary and oversized files show a clear message.

**Rust you'll meet:** `std::fs`, `Result` chains, `String::from_utf8`, enums with data.

**Exercise idea:** `looks_like_text(bytes: &[u8]) -> bool`.

**What changed from the plan in Milestones 0 to 4:**

- **Who wrote it:** Claude wrote this Rust in explain mode, at your request, instead of you.
- **Preview screens:** hidden behind `PREVIEW_CLAUDE` instead of labelled.
- **No version yet:** `read_file` returns text only. The version for conflict checks arrives with saving in Milestone 5.
- **Extra command:** `list_files`, which lists every file for Go to file and project search. It's capped at 20,000 files and doesn't follow symlinked folders.
- **Not remembered on restart:** the open folder isn't remembered when the app restarts. That's recent projects, in Milestone 7.

### Milestone 5: Edit and save (L, you) - the riskiest milestone

- **Atomic write:** write to a temp file in the same folder, flush it, then rename over the original. A crash mid-save must never leave a half-written file.
- **Conflict check:** hash the file on read and return that as its version. On save, hash the file on disk again, and return `Conflict` if it differs from `expected_version`. `DefaultHasher` from std is fine because this detects changes, not attacks.
- **Keep file permissions** across the rename, or a script loses its executable bit.
- **Saving through a symlink:** refuse for now, and revisit later.
- In the UI, make Cmd+S real, clear the unsaved dot on save, and offer **Overwrite**, **Reload** or **Keep editing** on a conflict. Warn before closing a window with unsaved changes.

**Done when:** you can edit a file, save it, and see the change in another tool. Editing the file elsewhere and then saving shows the conflict choice instead of overwriting.

**Rust you'll meet:** temp files, `Hash`, working with permissions, integration-style tests.

### Milestone 6: Create, rename, delete (M, you)

- `create_file` and `create_dir`: use `create_new`, which fails if the file exists instead of overwriting.
- `rename_path`: both ends go through the guard, and it must not overwrite an existing path.
- `delete_path`: Rust shows the native confirmation, so compromised JavaScript can't skip it.
- In the UI, add new file and new folder buttons, inline naming in the tree, and a right-click menu. Update open tabs when a file is renamed or deleted, and keep unsaved edits if a file disappears.

**Done when:** all the file operations work from the tree, and you could do a day's editing in Claudine without touching another editor. **This completes the first goal.**

### Settings (done, outside the milestones)

- Rust stores settings per user in `settings.json`, in the app config folder.
- Settings in the browser from earlier versions are imported once.
- Every option on the Settings page is live.
- Sidebar widths are settings too. The hidden-name list replaces the fixed list in `files.rs`.

### Milestone 7: Daily-driver polish (M, optional for the goal)

- Recent projects, stored by Rust in the app's config folder, and reopening the last project on launch.
- Detect outside changes when the window regains focus, by rechecking versions. This avoids a file-watcher dependency for now.
- Go to file (Cmd+Shift+O) and project search (Cmd+Shift+F) already work on mock files. Point Go to file at the real file list.
- Replace the TypeScript search in `apps/desktop/src/lib/projectSearch.ts` with a Rust `search_project` command. It reads every file through the path guard, skips binary and oversized files, caps the result count, and returns results in the same shape.

## Later: connecting Claude

Rough order, to be planned in detail when we get there:

1. **Hook protocol:** real `HookEvent` messages, plus the hook failing closed. Any internal failure must exit 2, because other exit codes let the action through. Test the actual exit codes.
2. **Running `claude` (first slice done):** one session per open project, in a real chat panel. Rust runs `claude -p` with stream-json in and out and `--permission-prompt-tool stdio`, asks once per folder whether to trust it, and decides each permission request from the user's Allow or Deny. See `apps/desktop/src-tauri/src/claude.rs` and SECURITY.md. Still to do:
   - Stream text as it's written (`--include-partial-messages`), and render Markdown.
   - Several sessions, and resuming one (`--resume`).
   - "Always allow" and permission modes, through `claude`'s permission updates.
   - Show Claude's edits as a diff to review, instead of reloading the file (step 4).
   - Handle a file with unsaved edits that Claude changes on disk (with Milestone 5's conflict check).
3. **Socket between hook and app,** with authentication.
4. **Real approvals and diff review:** replaces the mock `decideHunk` and `approveEdit`. Decisions must move into Rust. Per-hunk accept needs its own design, because `PreToolUse` decides on a whole tool call.
5. **Accounts:** a separate config folder per account.
6. **Tripwire and audit log** in `crates/core`.
7. **Packaging:** bundling, the hook sidecar, signing and release CI.
8. **Code intelligence (language servers):** type-aware completion, go to definition, hover, rename, live errors and formatting. For Rust this means running `rust-analyzer` as a separate process and talking to it over LSP, which needs Rust backend work.
   - **Security catch:** `rust-analyzer` runs a project's `build.rs` files and procedural macros to understand it, so opening an untrusted project would run its code. VS Code gates this behind Workspace Trust. Claudine would need the same: an explicit per-project trust decision made in Rust, with the language server off until then.
   - Use the user's own `rust-analyzer`, never downloaded by the app, which follows the same rule as Claude Code.
   - Formatting can come earlier and more safely: `rustfmt` doesn't run project code.

## Decisions needed

Defaults are what the plan assumes unless you say otherwise.

| # | Question | Default | Why it matters | Needed by |
|---|---|---|---|---|
| D3 | Does delete go to the Trash or remove permanently? | **Trash**, through the `trash` crate if it passes review. | Trash is recoverable, which matters when an editor can delete things. Permanent delete needs no dependency. | M6 |

**Decided:**

- **D1:** Claude wrote the path guard, for you to review line by line.
- **D2:** Use `cap-std`. In a test, it leaked 0 of 200,000 racing reads, while a plain check-then-read guard leaked 615.
- **D4:** Chat panel, with `claude`'s stream-json output. Permission requests go to Rust through `--permission-prompt-tool stdio`; the hook and socket come later as a second, fail-closed layer.
- **D6:** Ask once per folder before running `claude` there, and remember the answer in Rust.
- **D5:** macOS and Linux first. The attack tests only run on Unix, so Windows needs its own review before it's supported.

## New dependencies this plan asks for

Each needs your approval and a line in `DEPENDENCIES.md` when added. Versions and licenses were looked up on 2026-11-05 and must be rechecked before pinning.

| Crate | Milestone | Why | License |
|---|---|---|---|
| `tauri-plugin-dialog` | M2 | Native folder picker and confirmations | MIT or Apache-2.0 |
| `trash` (if D3) | M6 | Move to Trash. Not yet looked up. | Unknown |

Each crate's own dependencies may bring licenses that `deny.toml` rejects, so run `cargo deny check` before committing to one. `notify`, a file watcher for later, is CC0-1.0, which isn't on the allowlist and would need your approval.

## How we'll check each milestone

- **Before every commit:** `pnpm check`, `pnpm lint`, `pnpm test`, `cargo deny check`.
- **Permissions:** for each new command, confirm the UI gets `not allowed` when its capability entry is removed.
- **In the real app:** run `pnpm tauri dev` and try the milestone's "Done when" by hand. Automated browser checks can't exercise real commands.
- **Test on throwaway folders:** until Milestone 5 is solid, don't point a saving build at work you care about without a clean git state.

## Gaps to close along the way

- **CI has never run.** The repo has no remote yet. Push it early so the workflow gets its first real test.
- **Browser test harness:** the Chrome and WebKit checks used so far lived in a temp folder and aren't in the repo. Decide whether to add them, ideally without new dependencies.
- **npm licenses:** `cargo deny` only covers Rust, so nothing checks npm licenses yet.
- **"Stores nothing but the path":** the Accounts and Setup text overstates what's stored, because labels and colors are kept too. Fix the wording before account linking ships.
