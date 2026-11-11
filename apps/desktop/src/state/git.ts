// The Git panel's data, all from read-only git commands Rust runs in the open folder.
import { createStore, produce } from "solid-js/store";
import {
  backend,
  describeError,
  type GitChange,
  type GitCommit,
  isCommandError,
  type Proposal,
} from "../backend";

export interface GitDiffView {
  /** Shown above the diff, such as "a1b2c3d · Fix the engine". */
  title: string;
  proposal: Proposal;
}

interface GitStore {
  status: GitChange[];
  commits: GitCommit[];
  /** The file whose history is shown, and its commits. */
  historyPath: string | null;
  history: GitCommit[];
  /** Each expanded commit's files. */
  files: Record<string, GitChange[]>;
  expanded: Record<string, boolean>;
  diff: GitDiffView | null;
  loading: boolean;
  error: string | null;
}

const [git, setGit] = createStore<GitStore>({
  status: [],
  commits: [],
  historyPath: null,
  history: [],
  files: {},
  expanded: {},
  diff: null,
  loading: false,
  error: null,
});

export { git };

function messageFor(error: unknown): string {
  return isCommandError(error) ? describeError(error) : String(error);
}

/** Reads the changes and the recent commits again. */
export async function refreshGit() {
  setGit("loading", true);
  try {
    const [status, commits] = await Promise.all([
      backend.gitStatus(),
      backend.gitLog(null),
    ]);
    setGit(
      produce((s) => {
        s.status = status;
        s.commits = commits;
        s.error = null;
      }),
    );
  } catch (error) {
    setGit("error", messageFor(error));
  } finally {
    setGit("loading", false);
  }
}

/** Shows `path`'s history; `null` clears it. */
export async function loadHistory(path: string | null) {
  setGit(
    produce((s) => {
      s.historyPath = path;
      s.history = [];
    }),
  );
  if (!path) return;
  try {
    const history = await backend.gitLog(path);
    if (git.historyPath === path) setGit("history", history);
  } catch {
    // Not in a repository, or untracked: no history to show.
  }
}

export async function toggleCommit(id: string) {
  const open = !git.expanded[id];
  setGit("expanded", id, open);
  if (!open || git.files[id]) return;
  try {
    setGit("files", id, await backend.gitCommitFiles(id));
  } catch (error) {
    setGit("error", messageFor(error));
  }
}

/** Opens a file's change in the editor area: in a commit, or uncommitted when `commit` is null. */
export async function openGitDiff(commit: GitCommit | null, path: string) {
  try {
    const proposal = await backend.gitDiff(commit?.id ?? null, path);
    const title = commit
      ? `${commit.short} · ${commit.subject}`
      : "Uncommitted changes";
    setGit("diff", { title, proposal });
  } catch (error) {
    setGit("error", messageFor(error));
  }
}

export function closeGitDiff() {
  setGit("diff", null);
}

/** Forgets everything, when another folder opens. */
export function resetGit() {
  setGit(
    produce((s) => {
      s.status = [];
      s.commits = [];
      s.historyPath = null;
      s.history = [];
      s.files = {};
      s.expanded = {};
      s.diff = null;
      s.error = null;
    }),
  );
}
