// The real Claude session for the open project. Rust runs `claude` and decides what is
// approved; this only shows what Rust relays and passes on the user's answers.
import { createStore, produce } from "solid-js/store";
import {
  backend,
  type CommandError,
  describeError,
  isCommandError,
  type ModelOption,
  type PermissionMode,
  type SessionEvent,
} from "../backend";
import { accounts } from "./accounts";
import { filesChangedOnDisk } from "./store";

export type ChatEntry =
  | { kind: "user"; text: string }
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
}

export type ClaudeStatus = "off" | "starting" | "idle" | "working" | "ended";

interface ClaudeState {
  /** Whether the panel is showing. */
  open: boolean;
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
  /** `claude`'s permission mode, which can also change by itself (leaving plan mode). */
  mode: string;
  entries: ChatEntry[];
  permissions: PermissionRequest[];
  costUsd: number | null;
}

const [claude, setClaude] = createStore<ClaudeState>({
  open: true,
  found: null,
  status: "off",
  account: "",
  model: "",
  models: [],
  modelChoice: "default",
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

export function toggleClaudePanel() {
  setClaude("open", (open) => !open);
}

/** Ends the session view when the project changes. Rust stops the process itself. */
export function resetClaude() {
  generation++;
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
    await backend.startSession(account, (event) => {
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

export async function sendToClaude(text: string): Promise<boolean> {
  try {
    await backend.sendMessage(text);
    setClaude(
      produce((s) => {
        s.entries.push({ kind: "user", text });
        s.status = "working";
      }),
    );
    return true;
  } catch (error) {
    notice(messageFor(error), "error");
    return false;
  }
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
    label: "Ask before edits",
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

export function cycleMode() {
  const index = MODES.findIndex((m) => m.value === claude.mode);
  const next = MODES[(index + 1) % MODES.length];
  if (next) void setMode(next.value);
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

export async function interruptClaude() {
  try {
    await backend.interruptSession();
  } catch (error) {
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
        },
      ]);
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
      if (event.isError)
        notice(event.message ?? "Claude stopped with an error.", "error");
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
