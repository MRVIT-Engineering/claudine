// A GitLens-style side bar: uncommitted changes, the open file's history and recent
// commits. Clicking a file shows its change as a diff in the editor area.
import { createEffect, For, onMount, Show } from "solid-js";
import type { GitChange, GitCommit } from "../backend";
import { ChevronDown, ChevronRight } from "../components/Icons";
import { timeAgo } from "../lib/blame";
import {
  git,
  loadHistory,
  openGitDiff,
  refreshGit,
  toggleCommit,
} from "../state/git";
import { activeFile, fileName } from "../state/store";

const STATUS_LABEL: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  "?": "Untracked",
};

function byline(commit: GitCommit): string {
  return `${commit.isYou ? "You" : commit.author} · ${timeAgo(commit.time)}`;
}

function ChangeRow(props: { change: GitChange; commit: GitCommit | null }) {
  return (
    <button
      type="button"
      class="git-row git-file"
      title={`${STATUS_LABEL[props.change.status] ?? props.change.status}: ${props.change.path}`}
      onClick={() => void openGitDiff(props.commit, props.change.path)}
    >
      <span
        class={`git-status git-status-${props.change.status === "?" ? "u" : props.change.status}`}
      >
        {props.change.status === "?" ? "U" : props.change.status}
      </span>
      <span class="git-name">{fileName(props.change.path)}</span>
      <span class="git-dir">
        {props.change.path.slice(0, props.change.path.lastIndexOf("/") + 1)}
      </span>
    </button>
  );
}

function CommitRow(props: { commit: GitCommit; path?: string }) {
  const open = () => git.expanded[props.commit.id];
  return (
    <div class="git-commit">
      <button
        type="button"
        class="git-row"
        title={`${props.commit.short} · ${props.commit.subject}`}
        aria-expanded={props.path ? undefined : open()}
        onClick={() =>
          props.path
            ? void openGitDiff(props.commit, props.path)
            : void toggleCommit(props.commit.id)
        }
      >
        <Show when={!props.path}>
          <span class="git-chevron">
            {open() ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        </Show>
        <span class="git-commit-text">
          <span class="git-subject">
            {props.commit.subject || "(no message)"}
          </span>
          <span class="git-byline">
            {byline(props.commit)} · <code>{props.commit.short}</code>
          </span>
        </span>
      </button>
      <Show when={!props.path && open()}>
        <div class="git-commit-files">
          <For
            each={git.files[props.commit.id]}
            fallback={<p class="git-empty">Loading…</p>}
          >
            {(change) => <ChangeRow change={change} commit={props.commit} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function GitPanel() {
  onMount(() => void refreshGit());
  // The history follows the open file.
  createEffect(() => {
    const path = activeFile() || null;
    if (path !== git.historyPath) void loadHistory(path);
  });
  return (
    <aside class="sidebar git-panel">
      <div class="sidebar-head">
        <h2 class="section-title">Git</h2>
        <button
          type="button"
          class="icon-btn"
          title="Refresh"
          aria-label="Refresh"
          disabled={git.loading}
          onClick={() => {
            void refreshGit();
            void loadHistory(git.historyPath);
          }}
        >
          ↻
        </button>
      </div>
      <Show when={git.error}>
        <p class="git-error">{git.error}</p>
      </Show>
      <div class="git-scroll">
        <section>
          <h3 class="git-section">Changes · {git.status.length}</h3>
          <For
            each={git.status}
            fallback={<p class="git-empty">No uncommitted changes.</p>}
          >
            {(change) => <ChangeRow change={change} commit={null} />}
          </For>
        </section>
        <Show when={git.historyPath}>
          {(path) => (
            <section>
              <h3 class="git-section">History · {fileName(path())}</h3>
              <For
                each={git.history}
                fallback={<p class="git-empty">No commits for this file.</p>}
              >
                {(commit) => <CommitRow commit={commit} path={path()} />}
              </For>
            </section>
          )}
        </Show>
        <section>
          <h3 class="git-section">Commits</h3>
          <For
            each={git.commits}
            fallback={
              <p class="git-empty">
                {git.loading
                  ? "Loading…"
                  : "No commits, or not a git repository."}
              </p>
            }
          >
            {(commit) => <CommitRow commit={commit} />}
          </For>
        </section>
      </div>
    </aside>
  );
}
