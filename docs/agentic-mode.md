# Agentic mode

In Editor mode the user approves each edit. In Agentic mode the user hands Claude a task,
Claude Code works on its own in auto mode on a separate branch and git worktree, and the
result comes back as a pre-PR review: every changed file with Claude's explanation, line
comments, then **Approve** (commit, push, `gh pr create`) or **Request changes** (a new
revision in the same Claude Code session).

The spec's Summary tab is left out on purpose. Claude's summary still becomes the PR
description.

## What the installed Claude Code supports

Checked against `claude --help` and a live session with Claude Code 2.1.309:

| Need | How |
|---|---|
| Auto mode | `--permission-mode auto` is one of the listed choices. Older versions without it fall back to `acceptEdits` plus an allowlist (`--allowed-tools`). |
| Approvals during a run | `--permission-prompt-tool stdio`, the same as Editor mode: anything that needs a person arrives as a `can_use_tool` control request. |
| Things that must always ask | `ask` rules passed with `--settings '{"permissions":{"ask":[…]}}'`. Verified: in auto mode a command matching an `ask` rule still comes to Claudine for approval. |
| Messages sent mid-run | Stream-JSON input accepts them at any time. Claude reads a queued message between steps of the current turn. `--replay-user-messages` echoes each one when Claude reads it, so the UI shows it as queued until then. |
| Knowing when a run is done | A `result` arrives when Claude has nothing left to do. Messages read mid-turn don't produce their own `result`, so a run counts as finished on a `result` with no queued messages left. |
| Usage limits | `rate_limit_event` messages, with `status`, plus a `result` error. |
| Resume after a restart | `system/init` carries the `session_id`; `--resume <id>` continues it. |
| The plan checklist | `TodoWrite` tool calls, whose input lists the todos with their status. |

## Reused

- `claude.rs`: finding `claude`, spawning it with the account's `CLAUDE_CONFIG_DIR`
  (`use_account`), the stream-JSON relay, tool descriptions, and permission answers that
  use the input Rust kept. The relay now sends events to any sink, so the Editor chat
  and runs share it.
- `accounts.rs`: account ids and config folders. A run keeps the account it started on.
- `settings.rs`: the new Agentic settings live in the same Rust-owned `Settings`.
- `trust.rs`: a run needs the main project trusted, with the same native dialog.
- The webview's chat components (`views/ClaudePanel.tsx`), dropdowns, account badges,
  file icons, theme tokens and the change colors.

## Added

- `src-tauri/src/git.rs`: runs the user's `git`. Branch names, worktrees, a snapshot of
  the worktree as a git tree (through a temporary index, so Claude's own index is never
  touched), diffs between trees, commit and push. Destructive commands only ever run
  inside a run's own worktree, or on the run's own branch.
- `src-tauri/src/runs.rs`: runs, their states and transitions, persistence, the finishing
  steps (checks, explanations), review actions, and the Tauri commands.
- `views/Agentic.tsx`, `state/runs.ts`, `components/RunChanges.tsx`: runs list, new-run
  form, conversation, changes and review.
- An "Agentic mode" section in Settings.

## On disk

All under the app's data folder (`~/Library/Application Support/dev.my-editor.desktop/`):

- `runs/runs.json`: every run's id, title, task, account id, project folder, base branch
  and commit, branch, worktree path, Claude Code session id, state, revision, timestamps,
  plan, comments, viewed files, revision snapshots, check results, and the last summary
  and explanations.
- `runs/<id>/events.jsonl`: the conversation, as Claudine's own summarized events, so it
  shows again after a restart.
- `worktrees/<id>/`: each run's git worktree.
- `runs/approved-checks.json`: check commands the user confirmed in a native dialog.

Nothing from inside an account's config folder is read or stored.

## Security

- **Auto mode only in runs.** Editor mode still offers only ask, accept edits and plan.
  A run works in its own worktree, and these always ask, in every mode: `git push`,
  package installs, `rm`, `WebFetch` and `WebSearch`, and every command on the user's
  deny list.
- **Pushing and PRs.** `git push` and `gh pr create` are the only network actions
  Claudine starts itself, and only after the user approves in the review *and* confirms
  in a native dialog shown by Rust. A compromised webview can't push.
- **Check commands.** Auto-detected checks (`cargo test`, `npm test`, `pytest`) run as
  they are. Commands typed in Settings run only after the user confirms them once in a
  native dialog, because the webview could otherwise set any shell command.
- **Discarding** deletes the run's worktree and branch only, after a native confirmation.
- The webview sends run ids, comment text and choices. It never sends a path to run git
  or `claude` in, and Rust never sends absolute paths back.

## Phases

A: runs and conversation. B: live changes. C: finishing and review. D: review outcomes.
E: settings and edge cases. Each phase is its own commit.
