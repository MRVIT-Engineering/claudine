// Agentic runs as Rust reports them. Rust runs `claude`, git and every check; this only
// shows what it relays and passes on the user's choices by run id.
import { createStore, produce } from "solid-js/store";
import {
  backend,
  describeError,
  type FileDiff,
  isCommandError,
  type ModelOption,
  type NewRunInfo,
  type Run,
  type RunChanges,
  type RunOptions,
  type RunUpdate,
  type SessionEvent,
} from "../backend";
import type { ChatEntry } from "./claude";

export type RunTab = "conversation" | "changes";

interface ChangesState {
  data: RunChanges | null;
  loading: boolean;
  error: string | null;
  /** When the last refresh finished, to keep refreshes about a second apart. */
  at: number;
}

interface RunsStore {
  loaded: boolean;
  list: Run[];
  selected: string | null;
  /** Showing the new-run form instead of a run. */
  creating: boolean;
  newRun: NewRunInfo | null;
  transcripts: Record<string, ChatEntry[]>;
  changes: Record<string, ChangesState>;
  tabs: Record<string, RunTab>;
  /** Shows only the diff since the last review. */
  sinceLast: Record<string, boolean>;
  error: string | null;
  busy: Record<string, boolean>;
  /** Each account's models, as its `claude` lists them. */
  models: Record<string, ModelOption[]>;
}

const [runs, setRuns] = createStore<RunsStore>({
  loaded: false,
  list: [],
  selected: null,
  creating: false,
  newRun: null,
  transcripts: {},
  changes: {},
  tabs: {},
  sinceLast: {},
  error: null,
  busy: {},
  models: {},
});

export { runs };

function messageFor(error: unknown): string {
  return isCommandError(error) ? describeError(error) : String(error);
}

function showError(error: unknown) {
  // Cancelling a native confirmation is a choice, not a failure.
  if (isCommandError(error) && error.kind === "cancelled") return;
  setRuns("error", messageFor(error));
}

export function dismissRunsError() {
  setRuns("error", null);
}

export function runById(id: string | null): Run | undefined {
  return id ? runs.list.find((r) => r.id === id) : undefined;
}

export function selectedRun(): Run | undefined {
  return runById(runs.selected);
}

/** Runs waiting for the user's review, for the Agentic badge. */
export function toReviewCount(): number {
  return runs.list.filter((r) => r.state === "review").length;
}

export function runningCount(): number {
  return runs.list.filter(
    (r) => r.state === "running" || r.state === "finishing",
  ).length;
}

/** Files that more than one active run changed. */
export function overlapsFor(run: Run): string[] {
  const active = (r: Run) =>
    r.state !== "approved" && r.state !== "applied" && r.id !== run.id;
  const others = new Set(
    runs.list.filter(active).flatMap((r) => r.stats.paths),
  );
  if (run.state === "approved" || run.state === "applied") return [];
  return run.stats.paths.filter((p) => others.has(p));
}

let watching = false;

export async function loadRuns() {
  try {
    if (!watching) {
      await backend.watchRuns(onUpdate);
      watching = true;
    }
    const list = await backend.listRuns();
    setRuns(
      produce((s) => {
        s.list = list;
        s.loaded = true;
        if (!s.selected || !list.some((r) => r.id === s.selected)) {
          s.selected = list[0]?.id ?? null;
        }
        if (list.length === 0) s.creating = true;
      }),
    );
    if (runs.selected) void openRun(runs.selected);
  } catch (error) {
    setRuns("loaded", true);
    showError(error);
  }
}

function upsert(run: Run) {
  setRuns(
    produce((s) => {
      const index = s.list.findIndex((r) => r.id === run.id);
      const before = index >= 0 ? s.list[index] : undefined;
      if (index >= 0) s.list[index] = run;
      else s.list.unshift(run);
      // A run that just became ready opens on its changes.
      if (before && before.state !== "review" && run.state === "review") {
        s.tabs[run.id] = "changes";
      }
    }),
  );
}

function onUpdate(update: RunUpdate) {
  switch (update.kind) {
    case "changed":
      upsert(update.run);
      return;
    case "removed":
      setRuns(
        produce((s) => {
          s.list = s.list.filter((r) => r.id !== update.id);
          delete s.transcripts[update.id];
          delete s.changes[update.id];
          if (s.selected === update.id) s.selected = s.list[0]?.id ?? null;
          if (s.list.length === 0) s.creating = true;
        }),
      );
      return;
    case "event":
      if (runs.transcripts[update.run]) {
        setRuns(
          "transcripts",
          update.run,
          produce((entries) => applyEvent(entries, update.event)),
        );
      }
      return;
    case "filesChanged":
      scheduleChanges(update.run);
      return;
  }
}

/** Turns one recorded or live event into chat entries, like the Editor chat does. */
function applyEvent(entries: ChatEntry[], event: SessionEvent) {
  switch (event.kind) {
    // Older transcripts showed Claude's echo; newer ones record the message when sent.
    case "userEcho":
    case "userMessage":
      entries.push({ kind: "user", text: event.text });
      return;
    case "text":
      entries.push({ kind: "text", text: event.text });
      return;
    case "tool":
      entries.push({
        kind: "tool",
        id: event.id,
        name: event.name,
        summary: event.summary,
        outside: event.outside,
      });
      return;
    case "toolResult": {
      const entry = entries.find((e) => e.kind === "tool" && e.id === event.id);
      if (entry?.kind === "tool") {
        entry.result = { isError: event.isError, text: event.text };
      }
      return;
    }
    case "notice":
      entries.push({ kind: "notice", text: event.message, tone: "muted" });
      return;
    case "turnDone":
      if (event.isError && event.message) {
        entries.push({ kind: "notice", text: event.message, tone: "error" });
      }
      return;
    case "rateLimit":
      if (event.status === "rejected") {
        entries.push({
          kind: "notice",
          text: "This account hit its usage limit. The run is paused.",
          tone: "error",
        });
      }
      return;
    case "exited":
      if (event.code !== 0 && event.code !== null && event.stderr.trim()) {
        entries.push({
          kind: "notice",
          text: `Claude Code exited:\n${event.stderr.trim()}`,
          tone: "error",
        });
      }
      return;
    default:
      return;
  }
}

/** Shows a run, loading its conversation the first time. */
export async function openRun(id: string) {
  setRuns(
    produce((s) => {
      s.selected = id;
      s.creating = false;
    }),
  );
  if (runs.transcripts[id]) return;
  try {
    const events = await backend.runTranscript(id);
    const entries: ChatEntry[] = [];
    for (const event of events) applyEvent(entries, event);
    setRuns("transcripts", id, entries);
  } catch (error) {
    showError(error);
  }
  const run = runById(id);
  if (run && run.state !== "running") void refreshChanges(id);
}

export function tabOf(run: Run): RunTab {
  const chosen = runs.tabs[run.id];
  if (chosen) return chosen;
  return run.state === "review" ? "changes" : "conversation";
}

export function setTab(id: string, tab: RunTab) {
  setRuns("tabs", id, tab);
  if (tab === "changes") void refreshChanges(id);
}

export function toggleSinceLast(id: string) {
  setRuns("sinceLast", id, (on) => !on);
}

const askedModels = new Set<string>();

/** Asks Rust for an account's models once; the pickers show aliases until they arrive. */
export async function loadModels(account: string) {
  if (askedModels.has(account)) return;
  askedModels.add(account);
  try {
    const models = await backend.listModels(account);
    if (models.length > 0) setRuns("models", account, models);
  } catch {
    // The aliases still work.
    askedModels.delete(account);
  }
}

export async function startNewRun() {
  setRuns(
    produce((s) => {
      s.creating = true;
      s.newRun = null;
    }),
  );
  try {
    setRuns("newRun", await backend.newRunInfo());
  } catch (error) {
    showError(error);
  }
}

export function cancelNewRun() {
  if (runs.list.length > 0) setRuns("creating", false);
}

export async function createRun(
  account: string,
  task: string,
  base: string,
  options: RunOptions,
): Promise<boolean> {
  setRuns("busy", "new", true);
  try {
    const run = await backend.startRun(account, task, base, options);
    upsert(run);
    setRuns("transcripts", run.id, []);
    await openRun(run.id);
    return true;
  } catch (error) {
    if (!(isCommandError(error) && error.kind === "notTrusted")) {
      showError(error);
    }
    return false;
  } finally {
    setRuns("busy", "new", false);
  }
}

export async function sendRunMessage(id: string, text: string) {
  try {
    await backend.sendRunMessage(id, text);
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

async function act(id: string, action: () => Promise<unknown>) {
  setRuns("busy", id, true);
  try {
    await action();
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    setRuns("busy", id, false);
  }
}

export const answerRunPermission = (
  id: string,
  request: string,
  allow: boolean,
) => act(id, () => backend.answerRunPermission(id, request, allow));
/** Switches a run's mode or model; a working run switches at once. */
export const setRunOptions = (id: string, options: RunOptions) =>
  act(id, () => backend.setRunOptions(id, options));
export const stopRun = (id: string) => act(id, () => backend.stopRun(id));
export const resumeRun = (id: string) => act(id, () => backend.resumeRun(id));
export const reviewRunNow = (id: string) =>
  act(id, () => backend.reviewRunNow(id));
export const requestChanges = (id: string, note: string) =>
  act(id, async () => {
    await backend.requestRunChanges(id, note);
    setRuns("tabs", id, "conversation");
  });
export const approveRun = (id: string, commitOnly: boolean) =>
  act(id, () => backend.approveRun(id, commitOnly));
export const discardRun = (id: string) => act(id, () => backend.discardRun(id));
export const addComment = (
  id: string,
  path: string,
  line: number,
  side: "new" | "old",
  body: string,
) => act(id, () => backend.addRunComment(id, path, line, side, body));
export const deleteComment = (id: string, comment: string) =>
  act(id, () => backend.deleteRunComment(id, comment));

export function setViewed(id: string, file: FileDiff, viewed: boolean) {
  void act(id, () =>
    backend.setRunViewed(id, file.path, viewed ? file.hash : null),
  );
}

export async function openRunInEditor(id: string): Promise<boolean> {
  return act(id, () => backend.openRunInEditor(id));
}

// Refreshes are about a second apart while Claude keeps editing.
const timers = new Map<string, number>();

function scheduleChanges(id: string) {
  if (timers.has(id) || !runs.changes[id]) return;
  const wait = Math.max(0, 1000 - (Date.now() - runs.changes[id].at));
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id);
      void refreshChanges(id);
    }, wait),
  );
}

export async function refreshChanges(id: string) {
  const current = runs.changes[id];
  if (current?.loading) return;
  setRuns("changes", id, {
    data: current?.data ?? null,
    loading: true,
    error: null,
    at: current?.at ?? 0,
  });
  try {
    const data = await backend.runChanges(id);
    setRuns("changes", id, {
      data,
      loading: false,
      error: null,
      at: Date.now(),
    });
  } catch (error) {
    setRuns("changes", id, {
      data: current?.data ?? null,
      loading: false,
      error: messageFor(error),
      at: Date.now(),
    });
  }
}

/** Whether the user marked the file viewed, and whether it changed since. */
export function viewedState(
  run: Run,
  file: FileDiff,
): "no" | "yes" | "changed" {
  const hash = run.viewed[file.path];
  if (!hash) return "no";
  return hash === file.hash ? "yes" : "changed";
}
