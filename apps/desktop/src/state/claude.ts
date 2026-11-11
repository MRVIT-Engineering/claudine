// The real Claude session for the open project. Rust runs `claude` and decides what is
// approved; this only shows what Rust relays and passes on the user's answers.
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  backend,
  type CommandError,
  describeError,
  type Effort,
  isCommandError,
  type ModelOption,
  type PermissionMode,
  type Proposal,
  type SessionEvent,
} from "../backend";
import type { ChatImage } from "../lib/images";
import { accounts, refreshStatus, selectAccount } from "./accounts";
import {
  CHAT_TAB,
  closeTab,
  filesChangedOnDisk,
  openChatTab,
  openFile,
  state,
} from "./store";

export type ChatEntry =
  | { kind: "user"; text: string; images?: Blob[] }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      outside: boolean;
      result?: { isError: boolean; text: string };
    }
  | { kind: "notice"; text: string; tone: "muted" | "error" };

export interface PermissionRequest {
  id: string;
  tool: string;
  summary: string;
  detail: string;
  outside: boolean;
  /** The file before and after, when Rust could work it out. Runs never send one. */
  proposal?: Proposal | null;
}

export type ClaudeStatus = "off" | "starting" | "idle" | "working" | "ended";

interface ClaudeState {
  /** Whether the panel is showing. */
  /** Whether Rust found a `claude` install; `null` until asked. */
  found: boolean | null;
  status: ClaudeStatus;
  /** The account the current or last session runs on. */
  account: string;
  /** The full model id, such as `claude-sonnet-5-5`, once `claude` says it. */
  model: string;
  /** What `claude` offers this session; empty for versions that don't say. */
  models: ModelOption[];
  /** The model value picked in Claudine, such as "sonnet". */
  modelChoice: string;
  /** The effort picked in Claudine; `null` is Claude Code's default. Kept between sessions. */
  effort: Effort | null;
  /** `claude`'s permission mode, which can also change by itself (leaving plan mode). */
  mode: string;
  entries: ChatEntry[];
  permissions: PermissionRequest[];
  costUsd: number | null;
}

const [claude, setClaude] = createStore<ClaudeState>({
  found: null,
  status: "off",
  account: "",
  model: "",
  models: [],
  modelChoice: "default",
  effort: null,
  mode: "default",
  entries: [],
  permissions: [],
  costUsd: null,
});

export { claude };

/** Tools that change one file, so only that file needs reloading afterwards. */
const FILE_TOOLS = ["Write", "Edit", "NotebookEdit"];
/** Tools that may change any file. */
const COMMAND_TOOLS = ["Bash"];

// Each start gets a new number, so late events from a replaced session are ignored.
let generation = 0;
// Set when the user stops the session, so its exit isn't reported as a failure.
let stopping = false;

function notice(text: string, tone: "muted" | "error" = "muted") {
  setClaude("entries", (entries) => [
    ...entries,
    { kind: "notice", text, tone },
  ]);
}

function messageFor(error: unknown): string {
  if (!isCommandError(error)) return String(error);
  const known: CommandError = error;
  return known.kind === "tooLarge"
    ? "This message is too long to send."
    : describeError(known);
}

export async function checkClaudeInstalled() {
  try {
    const status = await backend.claudeStatus();
    setClaude("found", status.found);
  } catch {
    setClaude("found", false);
  }
}

/** Shows the chat tab, or closes it when it's the one shown. */
export function toggleClaudePanel() {
  if (state.activeTab === CHAT_TAB) closeTab(CHAT_TAB);
  else openChatTab();
}

// Whether this folder's session was already started for the user. A cancelled trust
// dialog or a failed start then waits for the Start button instead of asking again.
const [autoStarted, setAutoStarted] = createSignal(false);

/** Whether the chat is about to start by itself, so the start screen can wait. */
export function autoStartPending(): boolean {
  if (autoStarted() || claude.found === false || !state.project) return false;
  const status = accounts.status[accounts.selected];
  return (
    !(typeof status === "object" && !status.signedIn) && status !== "error"
  );
}

/**
 * Starts a session with the last used account as soon as the chat is shown, so there's
 * no start step. Waits while the account's sign-in status is being checked, and leaves a
 * signed-out account to the sign-in screen.
 */
export function autoStartClaude() {
  if (autoStarted() || claude.status !== "off" || claude.found !== true) return;
  if (!state.project || !accounts.loaded) return;
  const status = accounts.status[accounts.selected];
  if (status === undefined || status === "checking") return;
  if (typeof status === "object" && !status.signedIn) return;
  setAutoStarted(true);
  void startClaude();
}

/** Picks the chat's account. A live session restarts with it, as a new conversation. */
export function switchAccount(id: string) {
  if (id === accounts.selected) return;
  selectAccount(id);
  void refreshStatus(id);
  if (claude.status === "idle") void startClaude();
}

/** Ends the session view when the project changes. Rust stops the process itself. */
export function resetClaude() {
  generation++;
  setAutoStarted(false);
  setClaude(
    produce((s) => {
      s.status = "off";
      s.model = "";
      s.models = [];
      s.modelChoice = "default";
      s.mode = "default";
      s.entries = [];
      s.permissions = [];
      s.costUsd = null;
    }),
  );
}

export async function startClaude() {
  const mine = ++generation;
  const account = accounts.selected;
  stopping = false;
  setClaude(
    produce((s) => {
      s.status = "starting";
      s.account = account;
      s.model = "";
      s.models = [];
      s.modelChoice = "default";
      s.mode = "default";
      s.entries = [];
      s.permissions = [];
      s.costUsd = null;
    }),
  );
  try {
    await backend.startSession(account, claude.effort, (event) => {
      if (mine === generation) onEvent(event);
    });
    if (mine === generation) setClaude("status", "idle");
  } catch (error) {
    if (mine !== generation) return;
    setClaude("status", "off");
    if (isCommandError(error) && error.kind === "claudeNotFound") {
      setClaude("found", false);
    }
    // Cancelling the trust dialog is a choice, not a failure.
    if (!(isCommandError(error) && error.kind === "notTrusted")) {
      notice(messageFor(error), "error");
    }
  }
}

export async function sendToClaude(
  text: string,
  images: ChatImage[] = [],
): Promise<boolean> {
  // A stop that came after the last turn had already ended doesn't carry over.
  if (claude.status !== "working") interrupting = false;
  try {
    await backend.sendMessage(text, images);
    setClaude(
      produce((s) => {
        s.entries.push({
          kind: "user",
          text,
          images: images.length > 0 ? images.map((i) => i.blob) : undefined,
        });
        s.status = "working";
      }),
    );
    return true;
  } catch (error) {
    notice(messageFor(error), "error");
    return false;
  }
}

export interface PendingEdit {
  id: string;
  tool: string;
  proposal: Proposal;
}

/** The first edit to `path` waiting for an answer, which the editor shows as a diff. */
export function pendingEditOf(path: string): PendingEdit | undefined {
  for (const request of claude.permissions) {
    if (request.proposal?.path === path) {
      return { id: request.id, tool: request.tool, proposal: request.proposal };
    }
  }
  return undefined;
}

export async function answerPermission(id: string, allow: boolean) {
  // Removed first, so a double click can't answer twice. Rust refuses that too.
  setClaude("permissions", (list) => list.filter((p) => p.id !== id));
  try {
    await backend.answerPermission(id, allow);
  } catch (error) {
    notice(messageFor(error), "error");
  }
}

/** The modes in the order Shift+Tab cycles through them, like the terminal. */
export const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  {
    value: "default",
    label: "Manual",
    hint: "Every edit and command waits for your Allow.",
  },
  {
    value: "acceptEdits",
    label: "Accept edits",
    hint: "Claude Code edits files in this folder without asking. Commands still ask.",
  },
  {
    value: "plan",
    label: "Plan",
    hint: "Claude explores and proposes a plan, without changing anything.",
  },
];

export async function setMode(mode: PermissionMode) {
  try {
    await backend.setMode(mode);
    // Shown when `claude` confirms, through its status message.
  } catch (error) {
    notice(messageFor(error), "error");
  }
}

export async function setModel(value: string) {
  const previous = claude.modelChoice;
  setClaude("modelChoice", value);
  try {
    await backend.setModel(value);
  } catch (error) {
    setClaude("modelChoice", previous);
    notice(messageFor(error), "error");
  }
}

/**
 * Changes the effort. A running session starts again with it, keeping the conversation;
 * otherwise the next session uses it.
 */
export async function setEffort(value: Effort | null) {
  const previous = claude.effort;
  setClaude("effort", value);
  if (value === null || claude.status === "off" || claude.status === "ended") {
    return;
  }
  try {
    await backend.setEffort(value);
    // The old process's open requests went with it.
    setClaude("permissions", []);
  } catch (error) {
    setClaude("effort", previous);
    notice(messageFor(error), "error");
  }
}

// Set when the user stops a turn, so the turn's end isn't reported as a failure.
let interrupting = false;

export async function interruptClaude() {
  interrupting = true;
  try {
    await backend.interruptSession();
  } catch (error) {
    interrupting = false;
    notice(messageFor(error), "error");
  }
}

export async function stopClaude() {
  stopping = true;
  try {
    await backend.stopSession();
  } catch (error) {
    notice(messageFor(error), "error");
  }
}

function toolName(id: string): string | undefined {
  for (const entry of claude.entries) {
    if (entry.kind === "tool" && entry.id === id) return entry.name;
  }
  return undefined;
}

function onEvent(event: SessionEvent) {
  switch (event.kind) {
    case "ready":
      setClaude("model", event.model);
      return;
    case "options":
      setClaude(
        produce((s) => {
          s.models = event.models;
          s.mode = event.mode;
        }),
      );
      return;
    case "mode":
      setClaude("mode", event.mode);
      return;
    case "model":
      setClaude("model", event.model);
      return;
    case "notice":
      notice(`Claude Code: ${event.message}`, "error");
      return;
    case "text":
      setClaude("entries", (e) => [...e, { kind: "text", text: event.text }]);
      return;
    case "tool":
      setClaude("entries", (e) => [
        ...e,
        {
          kind: "tool",
          id: event.id,
          name: event.name,
          summary: event.summary,
          outside: event.outside,
        },
      ]);
      return;
    case "toolResult": {
      setClaude(
        "entries",
        (entry) => entry.kind === "tool" && entry.id === event.id,
        produce((entry) => {
          if (entry.kind === "tool") {
            entry.result = { isError: event.isError, text: event.text };
          }
        }),
      );
      const name = toolName(event.id);
      if (event.isError || !name) return;
      if (COMMAND_TOOLS.includes(name)) filesChangedOnDisk("all");
      if (FILE_TOOLS.includes(name)) {
        const entry = claude.entries.find(
          (e) => e.kind === "tool" && e.id === event.id,
        );
        if (entry?.kind === "tool" && !entry.outside) {
          filesChangedOnDisk([entry.summary]);
        }
      }
      return;
    }
    case "permission":
      setClaude("permissions", (list) => [
        ...list,
        {
          id: event.id,
          tool: event.tool,
          summary: event.summary,
          detail: event.detail,
          outside: event.outside,
          proposal: event.proposal,
        },
      ]);
      // Shows the proposed change in the editor too, where there's room to read it.
      if (event.proposal) openFile(event.proposal.path);
      return;
    case "permissionClosed":
      setClaude("permissions", (list) => list.filter((p) => p.id !== event.id));
      return;
    case "turnDone":
      setClaude(
        produce((s) => {
          s.status = "idle";
          if (event.costUsd !== null) s.costUsd = event.costUsd;
        }),
      );
      // Claude Code ends a turn it was told to stop as an error; that's the user's choice.
      if (interrupting) notice("Stopped.");
      else if (event.isError)
        notice(event.message ?? "Claude stopped with an error.", "error");
      interrupting = false;
      return;
    case "exited": {
      const failed = !stopping && event.code !== 0;
      setClaude(
        produce((s) => {
          s.status = "ended";
          s.permissions = [];
        }),
      );
      if (failed) {
        const detail = event.stderr.trim();
        notice(
          detail
            ? `Claude Code exited unexpectedly:\n${detail}`
            : "Claude Code exited unexpectedly.",
          "error",
        );
      } else {
        notice("Session ended.");
      }
      return;
    }
  }
}
