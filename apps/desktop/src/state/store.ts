import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { buffers } from "../lib/buffers";
import {
  DEMO_ACCOUNTS,
  demoSessions,
  FILES,
  INITIAL_COLLAPSED,
} from "../mock/data";
import type {
  AccentKey,
  Account,
  AccountColor,
  Decision,
  EditorFont,
  Session,
  Settings,
  SettingsSection,
  SourceFile,
  TranscriptItem,
  View,
} from "../types";

export const ACCOUNT_COLORS: AccountColor[] = [
  "blue",
  "pink",
  "violet",
  "green",
  "amber",
];
export const ACCENTS: AccentKey[] = ["coral", "peach", "rust", "blue", "green"];
export const EDITOR_FONTS: { key: EditorFont; label: string; stack: string }[] =
  [
    {
      key: "jetbrains",
      label: "JetBrains Mono",
      stack: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
    },
    {
      key: "sf",
      label: "SF Mono",
      stack: '"SF Mono", ui-monospace, Menlo, monospace',
    },
    { key: "menlo", label: "Menlo", stack: "Menlo, Consolas, monospace" },
    {
      key: "fira",
      label: "Fira Code",
      stack: '"Fira Code", ui-monospace, Menlo, monospace',
    },
    { key: "system", label: "System default", stack: "monospace" },
  ];

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 20;

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "coral",
  fontSize: 13,
  editorFont: "jetbrains",
  ligatures: true,
  diffLayout: "side",
  wrapLines: true,
  startOn: "least-busy",
  warnSameFile: true,
  worktreePerSession: false,
  askBeforeEdits: true,
};

const STORAGE_KEY = "claudine.ui.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadSettings(raw: unknown): Settings {
  const s = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  return {
    theme: s.theme === "light" ? "light" : "dark",
    accent: ACCENTS.includes(s.accent as AccentKey)
      ? (s.accent as AccentKey)
      : d.accent,
    fontSize:
      typeof s.fontSize === "number" &&
      s.fontSize >= MIN_FONT_SIZE &&
      s.fontSize <= MAX_FONT_SIZE
        ? s.fontSize
        : d.fontSize,
    editorFont: EDITOR_FONTS.some((f) => f.key === s.editorFont)
      ? (s.editorFont as EditorFont)
      : d.editorFont,
    ligatures: bool(s.ligatures, d.ligatures),
    diffLayout: s.diffLayout === "inline" ? "inline" : "side",
    wrapLines: bool(s.wrapLines, d.wrapLines),
    startOn: typeof s.startOn === "string" ? s.startOn : d.startOn,
    warnSameFile: bool(s.warnSameFile, d.warnSameFile),
    worktreePerSession: bool(s.worktreePerSession, d.worktreePerSession),
    askBeforeEdits: bool(s.askBeforeEdits, d.askBeforeEdits),
  };
}

function loadAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a): Account[] =>
    isRecord(a) &&
    typeof a.id === "string" &&
    typeof a.label === "string" &&
    typeof a.email === "string" &&
    ACCOUNT_COLORS.includes(a.color as AccountColor)
      ? [
          {
            id: a.id,
            label: a.label,
            email: a.email,
            color: a.color as AccountColor,
            signedIn: a.signedIn !== false,
          },
        ]
      : [],
  );
}

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    const s = isRecord(saved) ? saved : {};
    return {
      settings: loadSettings(s.settings),
      setupDone: s.setupDone === true,
      accounts: loadAccounts(s.accounts),
    };
  } catch {
    return {
      settings: { ...DEFAULT_SETTINGS },
      setupDone: false,
      accounts: [],
    };
  }
}

const saved = readSaved();

function sessionsFor(accounts: Account[]): Session[] {
  return demoSessions().filter((s) =>
    accounts.some((a) => a.id === s.accountId),
  );
}

interface AppState {
  setupDone: boolean;
  view: View;
  settingsSection: SettingsSection;
  settings: Settings;
  accounts: Account[];
  sessions: Session[];
  activeSessionId: string | null;
  openTabs: string[];
  activeTab: string;
  collapsed: string[];
  decisions: Record<string, Decision>;
  dirty: Record<string, boolean>;
}

function initialTabs() {
  return ["src/session/pool.rs", "src/config.rs", "tests/diff_spec.rs"];
}

const initialSessions = sessionsFor(saved.accounts);

const [state, setState] = createStore<AppState>({
  setupDone: saved.setupDone,
  view: "editor",
  settingsSection: "appearance",
  settings: saved.settings,
  accounts: saved.accounts,
  sessions: initialSessions,
  activeSessionId: initialSessions[0]?.id ?? null,
  openTabs: initialTabs(),
  activeTab: "src/session/pool.rs",
  collapsed: [...INITIAL_COLLAPSED],
  decisions: {},
  dirty: {},
});

export { state };

const [composerFocus, setComposerFocus] = createSignal(0);
const [cursor, setCursor] = createSignal<{
  line: number;
  column: number;
} | null>(null);

export { cursor, setCursor };

const [dialog, setDialog] = createSignal<"new-session" | "broadcast" | null>(
  null,
);

export { composerFocus, dialog, setDialog };

function applyHash() {
  const [view, section] = location.hash.replace(/^#/, "").split("/");
  if (
    view === "editor" ||
    view === "parallel" ||
    view === "accounts" ||
    view === "settings"
  ) {
    setState("view", view);
  }
  if (
    section === "appearance" ||
    section === "editor" ||
    section === "accounts" ||
    section === "sessions"
  ) {
    setState("settingsSection", section);
  }
}

applyHash();
window.addEventListener("hashchange", applyHash);

createRoot(() => {
  createEffect(() => {
    const root = document.documentElement;
    const s = state.settings;
    root.dataset.theme = s.theme;
    root.dataset.accent = s.accent;
    root.dataset.ligatures = s.ligatures ? "on" : "off";
    root.style.setProperty("--code-size", `${s.fontSize}px`);
    const font = EDITOR_FONTS.find((f) => f.key === s.editorFont);
    if (font) root.style.setProperty("--font-code", font.stack);
  });

  createEffect(() => {
    const data = {
      settings: { ...state.settings },
      setupDone: state.setupDone,
      accounts: state.accounts.map((a) => ({ ...a })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable. The UI still works for this run.
    }
  });
});

export function accountOf(id: string): Account | undefined {
  return state.accounts.find((a) => a.id === id);
}

export function letterOf(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

export function configDirOf(account: Account): string {
  return `~/.claudine/accounts/${account.id}`;
}

export function activeSession(): Session | undefined {
  return state.sessions.find((s) => s.id === state.activeSessionId);
}

export function navigate(view: View, section?: SettingsSection) {
  setState("view", view);
  if (section) setState("settingsSection", section);
  const hash = view === "settings" ? `settings/${state.settingsSection}` : view;
  history.replaceState(null, "", `#${hash}`);
}

export function updateSettings(patch: Partial<Settings>) {
  setState("settings", patch);
}

export function resetAppearance() {
  const d = DEFAULT_SETTINGS;
  setState("settings", {
    theme: d.theme,
    accent: d.accent,
    fontSize: d.fontSize,
    editorFont: d.editorFont,
    ligatures: d.ligatures,
  });
}

function uniqueAccountId(label: string): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "account";
  let id = slug;
  let n = 2;
  while (state.accounts.some((a) => a.id === id)) {
    id = `${slug}-${n}`;
    n += 1;
  }
  return id;
}

export function connectAccount(label: string, color: AccountColor) {
  const id = uniqueAccountId(label);
  setState("accounts", state.accounts.length, {
    id,
    label: label.trim(),
    email: `${id}@example.com`,
    color,
    signedIn: true,
  });
}

export function updateAccount(id: string, patch: Partial<Account>) {
  setState("accounts", (a) => a.id === id, patch);
}

export function removeAccount(id: string) {
  setState(
    produce((s) => {
      s.accounts = s.accounts.filter((a) => a.id !== id);
      s.sessions = s.sessions.filter((session) => session.accountId !== id);
      if (!s.sessions.some((session) => session.id === s.activeSessionId)) {
        s.activeSessionId = s.sessions[0]?.id ?? null;
      }
    }),
  );
}

export function finishSetup() {
  setState(
    produce((s) => {
      const free = (id: string) => !s.accounts.some((a) => a.id === id);
      const demo = DEMO_ACCOUNTS.filter((a) => free(a.id)).map((a) => ({
        ...a,
      }));
      s.accounts = [...demo, ...s.accounts];
      s.sessions = sessionsFor(s.accounts);
      s.activeSessionId = s.sessions[0]?.id ?? null;
      s.setupDone = true;
    }),
  );
  navigate("editor");
}

export function restartSetup() {
  setState(
    produce((s) => {
      s.accounts = [];
      s.sessions = [];
      s.activeSessionId = null;
      s.decisions = {};
      s.dirty = {};
      s.setupDone = false;
    }),
  );
  buffers.clear();
}

export function openFile(path: string) {
  if (!FILES[path]) return;
  setState(
    produce((s) => {
      if (!s.openTabs.includes(path)) s.openTabs.push(path);
      s.activeTab = path;
    }),
  );
}

export function setDirty(path: string, dirty: boolean) {
  setState("dirty", path, dirty);
}

// The file's text after review: accepted hunks applied, everything else original.
export function resolvedText(path: string): string {
  const file = FILES[path];
  if (!file) return "";
  if (!file.segments) return (file.lines ?? []).join("\n");
  return file.segments
    .flatMap((segment) => {
      if (segment.kind === "context") return segment.lines;
      return decisionOf(path, segment.id) === "accepted"
        ? segment.added
        : segment.removed;
    })
    .join("\n");
}

export function closeTab(path: string) {
  setState(
    produce((s) => {
      const index = s.openTabs.indexOf(path);
      if (index === -1) return;
      s.openTabs.splice(index, 1);
      if (s.activeTab === path) {
        s.activeTab = s.openTabs[Math.max(0, index - 1)] ?? "";
      }
    }),
  );
}

export function toggleFolder(path: string) {
  setState(
    produce((s) => {
      s.collapsed = s.collapsed.includes(path)
        ? s.collapsed.filter((p) => p !== path)
        : [...s.collapsed, path];
    }),
  );
}

export function selectSession(id: string) {
  setState("activeSessionId", id);
}

function hunkIds(file: SourceFile): string[] {
  return (file.segments ?? []).flatMap((seg) =>
    seg.kind === "hunk" ? [seg.id] : [],
  );
}

export function decisionOf(path: string, hunkId: string): Decision {
  return state.decisions[`${path}:${hunkId}`] ?? "pending";
}

export function hunkCounts(path: string) {
  const file = FILES[path];
  const counts = { total: 0, pending: 0, accepted: 0, rejected: 0 };
  if (!file) return counts;
  for (const id of hunkIds(file)) {
    counts.total += 1;
    counts[decisionOf(path, id)] += 1;
  }
  return counts;
}

export function lineStats(path: string) {
  const stats = { added: 0, removed: 0 };
  for (const seg of FILES[path]?.segments ?? []) {
    if (seg.kind === "hunk") {
      stats.added += seg.added.length;
      stats.removed += seg.removed.length;
    }
  }
  return stats;
}

function appendTo(sessionId: string, ...items: TranscriptItem[]) {
  setState(
    "sessions",
    (s) => s.id === sessionId,
    "transcript",
    (list) => [...list, ...items],
  );
}

function setSession(sessionId: string, patch: Partial<Session>) {
  setState("sessions", (s) => s.id === sessionId, patch);
}

function syncReviewState(path: string) {
  const session = state.sessions.find(
    (s) => s.file === path && (s.status === "review" || s.status === "idle"),
  );
  if (!session) return;
  const counts = hunkCounts(path);
  if (counts.pending === 0 && session.status === "review") {
    setSession(session.id, { status: "idle", awaitingApproval: false });
    appendTo(session.id, {
      kind: "status",
      text: `Reviewed: ${counts.accepted} accepted, ${counts.rejected} rejected.`,
      tone: "muted",
    });
  } else if (counts.pending > 0 && session.status === "idle") {
    setSession(session.id, { status: "review", awaitingApproval: true });
    appendTo(session.id, {
      kind: "status",
      text: "Back to review.",
      tone: "review",
    });
  }
}

export function decideHunk(path: string, hunkId: string, decision: Decision) {
  buffers.delete(path);
  setState("decisions", `${path}:${hunkId}`, decision);
  syncReviewState(path);
}

export function decideAll(path: string, decision: Decision) {
  const file = FILES[path];
  if (!file) return;
  buffers.delete(path);
  for (const id of hunkIds(file)) {
    if (decisionOf(path, id) === "pending") {
      setState("decisions", `${path}:${id}`, decision);
    }
  }
  syncReviewState(path);
}

export function approveEdit(session: Session, allowForSession: boolean) {
  if (allowForSession) setSession(session.id, { mode: "auto" });
  if (session.file) decideAll(session.file, "accepted");
}

export function declineEdit(session: Session) {
  if (session.file) decideAll(session.file, "rejected");
  setComposerFocus((n) => n + 1);
}

export function setSessionMode(sessionId: string, mode: "ask" | "auto") {
  setSession(sessionId, { mode });
}

export function resolvePermission(
  session: Session,
  outcome: "deny" | "once" | "always",
) {
  const command = session.permission;
  if (!command) return;
  const id = session.id;
  if (outcome === "deny") {
    setSession(id, { permission: null, status: "idle" });
    appendTo(id, { kind: "status", text: `Denied ${command}`, tone: "muted" });
    return;
  }
  if (outcome === "always") setSession(id, { mode: "auto" });
  setSession(id, { permission: null, status: "running" });
  appendTo(id, { kind: "tool", verb: "bash", target: command });
  window.setTimeout(() => {
    appendTo(id, { kind: "output", text: "Finished mock build" });
    const pending = session.file ? hunkCounts(session.file).pending : 0;
    setSession(id, {
      status: pending > 0 ? "review" : "idle",
      awaitingApproval: pending > 0,
    });
    if (pending > 0) {
      appendTo(id, {
        kind: "status",
        text: "Ready for your review.",
        tone: "review",
      });
    }
  }, 1200);
}

export function sendMessage(sessionId: string, text: string) {
  const message = text.trim();
  if (!message) return;
  const before = state.sessions.find((s) => s.id === sessionId)?.status;
  appendTo(sessionId, { kind: "user", text: message });
  if (before === "idle") setSession(sessionId, { status: "running" });
  window.setTimeout(() => {
    appendTo(sessionId, {
      kind: "text",
      text: "Mock reply. The real answer will come from the claude process once the Rust backend exists.",
    });
    const current = state.sessions.find((s) => s.id === sessionId);
    if (before === "idle" && current?.status === "running") {
      setSession(sessionId, { status: "idle" });
    }
  }, 700);
}

export function leastBusyAccount(): Account | undefined {
  const signedIn = state.accounts.filter((a) => a.signedIn);
  const load = (a: Account) =>
    state.sessions.filter((s) => s.accountId === a.id && s.status !== "idle")
      .length;
  return [...signedIn].sort((a, b) => load(a) - load(b))[0];
}

export function defaultAccountId(): string {
  const start = state.settings.startOn;
  if (accountOf(start)?.signedIn) return start;
  return leastBusyAccount()?.id ?? "";
}

let nextSessionNumber = 0;

export function createSession(accountId: string, task: string) {
  nextSessionNumber += 1;
  const id = `s-new-${nextSessionNumber}`;
  const text = task.trim() || "New session";
  setState("sessions", state.sessions.length, {
    id,
    accountId,
    task: text,
    status: "idle",
    file: null,
    awaitingApproval: false,
    permission: null,
    mode: state.settings.askBeforeEdits ? "ask" : "auto",
    transcript: [
      { kind: "user", text },
      {
        kind: "status",
        text: "Mock session. Nothing is running yet.",
        tone: "muted",
      },
    ],
  });
  setState("activeSessionId", id);
}

export function conflictingFiles(): string[] {
  const seen = new Set<string>();
  const conflicts = new Set<string>();
  for (const session of state.sessions) {
    if (!session.file) continue;
    if (seen.has(session.file)) conflicts.add(session.file);
    seen.add(session.file);
  }
  return [...conflicts];
}
