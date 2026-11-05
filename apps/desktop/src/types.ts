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

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

export type View = "editor" | "parallel" | "accounts" | "settings";
export type SettingsSection = "appearance" | "editor" | "accounts" | "sessions";
export type AccentKey = "coral" | "peach" | "rust" | "blue" | "green";
export type EditorFont = "jetbrains" | "sf" | "menlo" | "fira" | "system";

export interface Settings {
  theme: "dark" | "light";
  accent: AccentKey;
  fontSize: number;
  editorFont: EditorFont;
  ligatures: boolean;
  diffLayout: "side" | "inline";
  wrapLines: boolean;
  suggestOnType: boolean;
  closeBrackets: boolean;
  startOn: string;
  warnSameFile: boolean;
  worktreePerSession: boolean;
  askBeforeEdits: boolean;
}
