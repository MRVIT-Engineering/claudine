// The real Claude session for the open project. Rust runs `claude` and decides what is
// approved; this only shows what Rust relays and passes on the user's answers.
import { createStore, produce } from "solid-js/store";
import {
  backend,
  type CommandError,
  describeError,
  isCommandError,
  type SessionEvent,
} from "../backend";
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
  model: string;
  entries: ChatEntry[];
  permissions: PermissionRequest[];
  costUsd: number | null;
}

const [claude, setClaude] = createStore<ClaudeState>({
  open: true,
  found: null,
  status: "off",
  model: "",
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
      s.entries = [];
      s.permissions = [];
      s.costUsd = null;
    }),
  );
}

export async function startClaude() {
  const mine = ++generation;
  stopping = false;
  setClaude(
    produce((s) => {
      s.status = "starting";
      s.model = "";
      s.entries = [];
      s.permissions = [];
      s.costUsd = null;
    }),
  );
  try {
    await backend.startSession((event) => {
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
