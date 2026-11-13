# Changelog

Every release of Claudine, newest first. Versions follow [Semantic Versioning](https://semver.org): a major version for breaking changes, a minor version for new features, a patch version for fixes.

## Unreleased

### Added

- Windows support: build from source, with Windows in CI. Claudine runs the native Claude Code install (`claude.exe`).

### Security

- On Windows, the path guard refuses names Windows reads differently (`.git.`, `.git::$INDEX_ALLOCATION`, `NUL`) and never writes through an 8.3 short name such as `GIT~1`. Junctions are treated like symlinks.

## 1.0.0 - 2026-11-11

The first versioned release.

### Editor

- Open any folder, browse it in the file tree, go to a file (⌘⇧O) and search the project (⌘⇧F).
- A CodeMirror 6 editor with VS Code-style shortcuts, find and replace, folding, and syntax highlighting for 140+ languages, loaded only when a file needs it.
- Save files through the Rust path guard.
- Draggable tabs, and splits to the left, right, top or bottom.
- A Git panel with changes, inline blame and side-by-side diffs.
- The file tree shows changed files and folders in yellow and new ones in green.
- Markdown preview in the same tab.

### Claude Code

- Runs the user's own `claude` install in the open folder. Claudine never bundles, downloads or installs it.
- The chat is an editor tab. Every write, edit and command shows its content or diff and waits for approval.
- Modes, models and effort from the chat input. Paste images into a message.
- Several Claude Code accounts, each with its own login, picked from the chat input. Sign-in is Claude Code's own; Claudine never reads a token.

### Agentic mode

- Hand off tasks that Claude works on in auto mode, each on its own branch in its own git worktree, several at once and on different accounts.
- Risky actions still ask. Pushing and opening a pull request each need a native confirmation.
- Review the result like a pull request: Claude's explanation of every file, check results and line comments, then approve or request another revision.

### Security

- The webview is untrusted: path checks, approvals and trust decisions are made in Rust.
- Files stay inside the project, through a path guard built on `cap-std`.
- No network from the app, no telemetry, no plugins or extension marketplace, no remote code.
