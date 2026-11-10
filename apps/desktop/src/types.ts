export type AccountColor = "blue" | "pink" | "violet" | "green" | "amber";

export interface Account {
  id: string;
  label: string;
  email: string;
  color: AccountColor;
  signedIn: boolean;
}

export type SessionStatus = "review" | "running" | "waiting" | "idle";
export type Decision = "pending" | "accepted" | "rejected";

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string; chatOnly?: boolean }
  | { kind: "think"; text: string }
  | {
      kind: "tool";
      verb: "read" | "write" | "edit" | "bash";
      target: string;
      detail?: string;
    }
  | { kind: "output"; text: string }
  | { kind: "status"; text: string; tone: "review" | "running" | "muted" };

export interface Session {
  id: string;
  accountId: string;
  task: string;
  status: SessionStatus;
  file: string | null;
  transcript: TranscriptItem[];
  awaitingApproval: boolean;
  permission: string | null;
  mode: "ask" | "auto";
}

export type Segment =
  | { kind: "context"; lines: string[] }
  | {
      kind: "hunk";
      id: string;
      title: string;
      removed: string[];
      added: string[];
    };

export interface PreviewLine {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface SourceFile {
  path: string;
  name: string;
  lines?: string[];
  segments?: Segment[];
  isNew?: boolean;
  preview?: PreviewLine[];
}

export type View = "editor" | "agentic" | "parallel" | "accounts" | "settings";
export type SettingsSection =
  | "appearance"
  | "editor"
  | "files"
  | "about"
  | "accounts"
  | "agentic"
  | "sessions";
export type AccentKey =
  | "violet"
  | "coral"
  | "peach"
  | "rust"
  | "blue"
  | "green";
export type EditorFont = "jetbrains" | "sf" | "menlo" | "fira" | "system";

/** Mirrors `Settings` in apps/desktop/src-tauri/src/settings.rs, which stores it. */
export interface Settings {
  theme: "dark" | "light" | "system";
  accent: AccentKey;
  fontSize: number;
  editorFont: EditorFont;
  ligatures: boolean;
  lineHeight: number;
  tabSize: number;
  insertSpaces: boolean;
  wrapLines: boolean;
  lineNumbers: boolean;
  highlightActiveLine: boolean;
  whitespace: "none" | "trailing" | "all";
  bracketMatching: boolean;
  foldGutter: boolean;
  cursorBlinking: boolean;
  scrollPastEnd: boolean;
  suggestOnType: boolean;
  closeBrackets: boolean;
  diffLayout: "side" | "inline";
  excludedNames: string[];
  sidebarWidth: number;
  chatWidth: number;
  settingsNavWidth: number;
  setupDone: boolean;
  // Agentic mode; checked again in settings.rs.
  prePrReview: boolean;
  runPermissions: "auto" | "acceptEdits" | "ask";
  onApprove: "pr" | "commit";
  explainFiles: boolean;
  runChecks: boolean;
  checkCommands: string[];
  worktreePerRun: boolean;
  branchPrefix: string;
  denyList: string[];
  maxRunMinutes: number;
  maxRunTurns: number;
}

/** Options for the hidden design preview. Kept in the browser, not with real settings. */
export interface PreviewSettings {
  startOn: string;
  warnSameFile: boolean;
  worktreePerSession: boolean;
  askBeforeEdits: boolean;
}
