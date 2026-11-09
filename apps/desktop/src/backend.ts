// The only way the UI reaches files and Claude: commands implemented in
// apps/desktop/src-tauri/src/project.rs and claude.rs. Every security decision is made there.
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export type CommandError =
  | { kind: "noProject" }
  | { kind: "invalidPath" }
  | { kind: "outsideProject" }
  | { kind: "protected" }
  | { kind: "needsConfirmation" }
  | { kind: "throughSymlink" }
  | { kind: "notFound" }
  | { kind: "accessDenied" }
  | { kind: "notADirectory" }
  | { kind: "isADirectory" }
  | { kind: "tooLarge" }
  | { kind: "notText" }
  | { kind: "io"; detail: string }
  | { kind: "internal" }
  | { kind: "claudeNotFound" }
  | { kind: "notTrusted" }
  | { kind: "noSession" }
  | { kind: "unavailable" };

/** Mirrors `SessionEvent` in apps/desktop/src-tauri/src/claude.rs. */
export type SessionEvent =
  | { kind: "ready"; model: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      outside: boolean;
    }
  | { kind: "toolResult"; id: string; isError: boolean; text: string }
  | {
      kind: "permission";
      id: string;
      tool: string;
      summary: string;
      detail: string;
      outside: boolean;
    }
  | { kind: "permissionClosed"; id: string }
  | {
      kind: "turnDone";
      isError: boolean;
      message: string | null;
      costUsd: number | null;
    }
  | { kind: "exited"; code: number | null; stderr: string };

export interface ProjectInfo {
  name: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
}

export interface FileList {
  paths: string[];
  truncated: boolean;
}

/** False in a plain browser tab, such as `pnpm dev` without Tauri. */
export function hasBackend(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function toCommandError(error: unknown): CommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string"
  ) {
    return error as CommandError;
  }
  return { kind: "io", detail: String(error) };
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!hasBackend()) throw { kind: "unavailable" } satisfies CommandError;
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}

export const backend = {
  currentProject: () => call<ProjectInfo | null>("current_project"),
  /** Shows the native folder picker. Resolves to `null` if it's cancelled. */
  openProject: () => call<ProjectInfo | null>("open_project"),
  /** One folder's entries; `null` for the project root. */
  listDir: (path: string | null) => call<DirEntry[]>("list_dir", { path }),
  readFile: (path: string) => call<string>("read_file", { path }),
  listFiles: () => call<FileList>("list_files"),
  /** `existed` is false until a settings file has been saved for this user. */
  getSettings: () =>
    call<{ settings: Settings; existed: boolean }>("get_settings"),
  /** Saves and returns what Rust stored, after it checked every value. */
  setSettings: (settings: Settings) =>
    call<Settings>("set_settings", { settings }),
  claudeStatus: () => call<{ found: boolean }>("claude_status"),
  /**
   * Starts `claude` in the open project. The first time for a folder, Rust asks
   * natively whether to trust it. Events arrive on `onEvent` until it exits.
   */
  startSession: (onEvent: (event: SessionEvent) => void) => {
    const channel = new Channel<SessionEvent>();
    channel.onmessage = onEvent;
    return call<void>("start_session", { onEvent: channel });
  },
  sendMessage: (text: string) => call<void>("send_message", { text }),
  /** Only an id and a yes or no: Rust runs the tool input it kept. */
  answerPermission: (id: string, allow: boolean) =>
    call<void>("answer_permission", { id, allow }),
  interruptSession: () => call<void>("interrupt_session"),
  stopSession: () => call<void>("stop_session"),
};

export function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string"
  );
}

export function describeError(error: CommandError): string {
  switch (error.kind) {
    case "noProject":
      return "No folder is open.";
    case "invalidPath":
      return "This name can't be opened.";
    case "outsideProject":
      return "This path is outside the open folder.";
    case "protected":
      return "This path can't be changed.";
    case "needsConfirmation":
      return "Changing this path needs confirmation.";
    case "throughSymlink":
      return "Can't write through a symlink.";
    case "notFound":
      return "This file no longer exists.";
    case "accessDenied":
      return "Can't open this: no permission, or it links outside the folder.";
    case "notADirectory":
      return "This isn't a folder.";
    case "isADirectory":
      return "This is a folder, not a file.";
    case "tooLarge":
      return "This file is larger than 5 MB, so it isn't opened.";
    case "notText":
      return "This looks like a binary file, so it can't be shown.";
    case "io":
      return `Couldn't read this: ${error.detail}.`;
    case "internal":
      return "Something went wrong. Restart the app and try again.";
    case "claudeNotFound":
      return "Claude Code isn't installed. Install it, then try again.";
    case "notTrusted":
      return "Claude wasn't started, because the folder isn't trusted.";
    case "noSession":
      return "Claude isn't running. Start a new session.";
    case "unavailable":
      return "Opening folders needs the desktop app. Run pnpm tauri dev.";
  }
}
