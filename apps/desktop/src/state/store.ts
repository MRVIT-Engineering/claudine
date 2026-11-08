import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  backend,
  type CommandError,
  type DirEntry,
  type FileList,
  hasBackend,
  isCommandError,
  type ProjectInfo,
} from "../backend";
import { buffers } from "../lib/buffers";
import { PREVIEW_CLAUDE } from "../lib/flags";
import { DEMO_ACCOUNTS, demoSessions, PROPOSALS } from "../mock/data";
import type {
  AccentKey,
  Account,
  AccountColor,
  Decision,
  EditorFont,
  PreviewSettings,
  Session,
  Settings,
  SettingsSection,
  SourceFile,
  TranscriptItem,
  View,
} from "../types";
import { resetClaude } from "./claude";

export const ACCOUNT_COLORS: AccountColor[] = [
  "blue",
  "pink",
  "violet",
  "green",
  "amber",
];
export const ACCENTS: AccentKey[] = [
  "violet",
  "coral",
  "peach",
  "rust",
  "blue",
  "green",
];
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

// These limits and defaults match apps/desktop/src-tauri/src/settings.rs, which
// enforces them again before saving.
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const MAX_TAB_SIZE = 8;
export const WIDTHS = {
  sidebarWidth: [160, 600],
  chatWidth: [260, 720],
  settingsNavWidth: [160, 400],
} as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "violet",
  fontSize: 13,
  editorFont: "jetbrains",
  ligatures: true,
  lineHeight: 1.6,
  tabSize: 4,
  insertSpaces: true,
  wrapLines: true,
  lineNumbers: true,
  highlightActiveLine: true,
  whitespace: "none",
  bracketMatching: true,
  foldGutter: true,
  cursorBlinking: true,
  scrollPastEnd: false,
  suggestOnType: true,
  closeBrackets: true,
  diffLayout: "side",
  excludedNames: [".git", ".DS_Store", "node_modules", "target"],
  sidebarWidth: 240,
  chatWidth: 320,
  settingsNavWidth: 210,
  setupDone: false,
};

const DEFAULT_PREVIEW: PreviewSettings = {
  startOn: "least-busy",
  warnSameFile: true,
  worktreePerSession: false,
  askBeforeEdits: true,
};

// Before settings moved to Rust they lived here. Read once, to import them.
const LEGACY_KEY = "claudine.ui.v1";
const LEGACY_VERSION = 2;
// The design preview's mock accounts and options, which never leave the browser.
const PREVIEW_KEY = "claudine.preview.v1";
// Settings in a plain browser tab, where there's no Rust to store them.
const BROWSER_KEY = "claudine.settings.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable. The UI still works for this run.
  }
}

function pick<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Reads settings from untrusted storage, keeping only known, in-range values. */
function parseSettings(raw: unknown): Settings {
  const s = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const bool = (key: keyof Settings) =>
    typeof s[key] === "boolean" ? (s[key] as boolean) : (d[key] as boolean);
  const names = Array.isArray(s.excludedNames)
    ? s.excludedNames.filter((n): n is string => typeof n === "string")
    : d.excludedNames;
  return {
    theme: pick(s.theme, ["dark", "light", "system"], d.theme),
    accent: pick(s.accent, ACCENTS, d.accent),
    fontSize: clampNumber(s.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, d.fontSize),
    editorFont: pick(
      s.editorFont,
      EDITOR_FONTS.map((f) => f.key),
      d.editorFont,
    ),
    ligatures: bool("ligatures"),
    lineHeight: clampNumber(s.lineHeight, 1, 2.5, d.lineHeight),
    tabSize: clampNumber(s.tabSize, 1, MAX_TAB_SIZE, d.tabSize),
    insertSpaces: bool("insertSpaces"),
    wrapLines: bool("wrapLines"),
    lineNumbers: bool("lineNumbers"),
    highlightActiveLine: bool("highlightActiveLine"),
    whitespace: pick(s.whitespace, ["none", "trailing", "all"], d.whitespace),
    bracketMatching: bool("bracketMatching"),
    foldGutter: bool("foldGutter"),
    cursorBlinking: bool("cursorBlinking"),
    scrollPastEnd: bool("scrollPastEnd"),
    suggestOnType: bool("suggestOnType"),
    closeBrackets: bool("closeBrackets"),
    diffLayout: pick(s.diffLayout, ["side", "inline"], d.diffLayout),
    excludedNames: names,
    sidebarWidth: clampNumber(
      s.sidebarWidth,
      ...WIDTHS.sidebarWidth,
      d.sidebarWidth,
    ),
    chatWidth: clampNumber(s.chatWidth, ...WIDTHS.chatWidth, d.chatWidth),
    settingsNavWidth: clampNumber(
      s.settingsNavWidth,
      ...WIDTHS.settingsNavWidth,
      d.settingsNavWidth,
    ),
    setupDone: bool("setupDone"),
  };
}

/** Settings saved by an earlier version in the browser, or `null` if there are none. */
function legacySettings(): Settings | null {
  const legacy = readJson(LEGACY_KEY);
  if (!isRecord(legacy.settings)) return null;
  const settings = parseSettings({
    ...legacy.settings,
    setupDone: legacy.setupDone === true,
  });
  // Version 1 saved coral as the default. Move those to Claudine's purple.
  if (legacy.version !== LEGACY_VERSION && settings.accent === "coral") {
    settings.accent = DEFAULT_SETTINGS.accent;
  }
  return settings;
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

function readPreview() {
  const stored = readJson(PREVIEW_KEY);
  const legacy = readJson(LEGACY_KEY);
  const options = isRecord(stored.options) ? stored.options : {};
  const d = DEFAULT_PREVIEW;
  return {
    accounts: loadAccounts(stored.accounts ?? legacy.accounts),
    options: {
      startOn:
        typeof options.startOn === "string" ? options.startOn : d.startOn,
      warnSameFile:
        typeof options.warnSameFile === "boolean"
          ? options.warnSameFile
          : d.warnSameFile,
      worktreePerSession:
        typeof options.worktreePerSession === "boolean"
          ? options.worktreePerSession
          : d.worktreePerSession,
      askBeforeEdits:
        typeof options.askBeforeEdits === "boolean"
          ? options.askBeforeEdits
          : d.askBeforeEdits,
    },
  };
}

const saved = readPreview();

function sessionsFor(accounts: Account[]): Session[] {
  if (!PREVIEW_CLAUDE) return [];
  return demoSessions().filter((s) =>
    accounts.some((a) => a.id === s.accountId),
  );
}

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: CommandError };

interface AppState {
  view: View;
  settingsSection: SettingsSection;
  /** Loaded from Rust before anything renders. */
  settings: Settings;
  preview: PreviewSettings;
  accounts: Account[];
  sessions: Session[];
  activeSessionId: string | null;
  /** The open folder, from Rust. `undefined` until the app has asked. */
  project: ProjectInfo | null | undefined;
  /** Folder listings by path; "" is the project root. */
  dirs: Record<string, Loadable<DirEntry[]>>;
  expanded: string[];
  /** File contents by path, as last read from disk. */
  files: Record<string, Loadable<string>>;
  fileList: FileList | null;
  openTabs: string[];
  activeTab: string;
  sidebar: "explorer" | "search";
  decisions: Record<string, Decision>;
  dirty: Record<string, boolean>;
}

const initialSessions = sessionsFor(saved.accounts);

const [state, setState] = createStore<AppState>({
  view: "editor",
  settingsSection: "appearance",
  settings: { ...DEFAULT_SETTINGS },
  preview: saved.options,
  accounts: saved.accounts,
  sessions: initialSessions,
  activeSessionId: initialSessions[0]?.id ?? null,
  project: undefined,
  dirs: {},
  expanded: [],
  files: {},
  fileList: null,
  openTabs: [],
  activeTab: "",
  sidebar: "explorer",
  decisions: {},
  dirty: {},
});

export { state };

const [composerFocus, setComposerFocus] = createSignal(0);
export interface CursorInfo {
  line: number;
  column: number;
  selections: number;
  selected: number;
}
const [cursor, setCursor] = createSignal<CursorInfo | null>(null);

export { cursor, setCursor };

/** A place to jump to once a file is open: a line, and a column range to select. */
export interface Reveal {
  path: string;
  line: number;
  start: number;
  end: number;
}
const [reveal, setReveal] = createSignal<Reveal | null>(null);

export { reveal, setReveal };

const [dialog, setDialog] = createSignal<
  "new-session" | "broadcast" | "discard-changes" | null
>(null);

export { composerFocus, dialog, setDialog };

function applyHash() {
  const [view, section] = location.hash.replace(/^#/, "").split("/");
  const previewOnly = view === "parallel" || view === "accounts";
  if (previewOnly && !PREVIEW_CLAUDE) {
    setState("view", "editor");
  } else if (
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
    section === "files" ||
    section === "about" ||
    section === "accounts" ||
    section === "sessions"
  ) {
    setState("settingsSection", section);
  }
}

applyHash();
window.addEventListener("hashchange", applyHash);

const [settingsReady, setSettingsReady] = createSignal(false);
// The settings as last stored, to skip saving when nothing changed.
let lastSaved = "";
export type SaveStatus = "saved" | "saving" | "error";
const [saveStatus, setSaveStatus] = createSignal<SaveStatus>("saved");

export { saveStatus, settingsReady };

/**
 * Loads settings from Rust, which keeps them in the user's app config folder. The
 * first time, it imports anything an earlier version left in the browser.
 */
export async function loadSettings() {
  if (!hasBackend()) {
    const settings = parseSettings(readJson(BROWSER_KEY));
    lastSaved = JSON.stringify(settings);
    setState("settings", settings);
    setSettingsReady(true);
    return;
  }
  try {
    const loaded = await backend.getSettings();
    // Nothing is written until something changes, so a later import still works.
    lastSaved = JSON.stringify(loaded.settings);
    const legacy = loaded.existed ? null : legacySettings();
    setState("settings", legacy ?? loaded.settings);
    if (legacy) await saveSettings();
  } catch {
    setSaveStatus("error");
  }
  setSettingsReady(true);
}

async function saveSettings() {
  const snapshot: Settings = JSON.parse(JSON.stringify(state.settings));
  const text = JSON.stringify(snapshot);
  // Already on disk, for example after changing a value back. Clears an old error too.
  if (text === lastSaved) {
    setSaveStatus("saved");
    return;
  }
  if (!hasBackend()) {
    writeJson(BROWSER_KEY, snapshot);
    lastSaved = text;
    return;
  }
  setSaveStatus("saving");
  const hiddenBefore = JSON.parse(lastSaved || "{}").excludedNames;
  try {
    const stored = await backend.setSettings(snapshot);
    lastSaved = JSON.stringify(stored);
    // Rust may have corrected a value, such as an out-of-range number.
    if (lastSaved !== JSON.stringify(state.settings))
      setState("settings", stored);
    setSaveStatus("saved");
    if (JSON.stringify(stored.excludedNames) !== JSON.stringify(hiddenBefore)) {
      reloadTree();
    }
  } catch {
    setSaveStatus("error");
  }
}

const [prefersDark, setPrefersDark] = createSignal(true);
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
setPrefersDark(darkQuery.matches);
darkQuery.addEventListener("change", (event) => setPrefersDark(event.matches));

/** The theme actually shown: "system" follows the operating system. */
export function resolvedTheme(): "dark" | "light" {
  const theme = state.settings.theme;
  if (theme === "system") return prefersDark() ? "dark" : "light";
  return theme;
}

createRoot(() => {
  createEffect(() => {
    const root = document.documentElement;
    const s = state.settings;
    root.dataset.theme = resolvedTheme();
    root.dataset.accent = s.accent;
    root.dataset.ligatures = s.ligatures ? "on" : "off";
    root.style.setProperty("--code-size", `${s.fontSize}px`);
    root.style.setProperty("--code-line-height", String(s.lineHeight));
    root.style.setProperty("--sidebar-width", `${s.sidebarWidth}px`);
    root.style.setProperty("--chat-width", `${s.chatWidth}px`);
    root.style.setProperty("--settings-nav-width", `${s.settingsNavWidth}px`);
    const font = EDITOR_FONTS.find((f) => f.key === s.editorFont);
    if (font) root.style.setProperty("--font-code", font.stack);
  });

  // Saves a moment after the last change, so dragging a slider isn't a write per step.
  let timer: number | undefined;
  createEffect(() => {
    JSON.stringify(state.settings);
    if (!settingsReady()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveSettings(), 300);
  });

  createEffect(() => {
    writeJson(PREVIEW_KEY, {
      options: { ...state.preview },
      accounts: state.accounts.map((a) => ({ ...a })),
    });
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

export function updatePreview(patch: Partial<PreviewSettings>) {
  setState("preview", patch);
}

const APPEARANCE_KEYS: (keyof Settings)[] = [
  "theme",
  "accent",
  "fontSize",
  "editorFont",
  "ligatures",
  "lineHeight",
];
const EDITOR_KEYS: (keyof Settings)[] = [
  "tabSize",
  "insertSpaces",
  "wrapLines",
  "lineNumbers",
  "highlightActiveLine",
  "whitespace",
  "bracketMatching",
  "foldGutter",
  "cursorBlinking",
  "scrollPastEnd",
  "suggestOnType",
  "closeBrackets",
  "diffLayout",
];

function resetKeys(keys: (keyof Settings)[]) {
  const patch: Partial<Settings> = {};
  for (const key of keys) {
    Object.assign(patch, { [key]: structuredClone(DEFAULT_SETTINGS[key]) });
  }
  setState("settings", patch);
}

export function resetAppearance() {
  resetKeys(APPEARANCE_KEYS);
}

export function resetEditor() {
  resetKeys(EDITOR_KEYS);
}

export function resetExcludedNames() {
  setState("settings", "excludedNames", [...DEFAULT_SETTINGS.excludedNames]);
}

/** Back to defaults, except that setup stays done. */
export function resetAllSettings() {
  setState("settings", {
    ...structuredClone(DEFAULT_SETTINGS),
    setupDone: true,
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
      const preview = PREVIEW_CLAUDE ? DEMO_ACCOUNTS : [];
      const demo = preview
        .filter((a) => free(a.id))
        .map((a) => ({
          ...a,
        }));
      s.accounts = [...demo, ...s.accounts];
      s.sessions = sessionsFor(s.accounts);
      s.activeSessionId = s.sessions[0]?.id ?? null;
      s.settings.setupDone = true;
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
      s.settings.setupDone = false;
    }),
  );
  buffers.clear();
}

export function openFile(path: string) {
  setState(
    produce((s) => {
      if (!s.openTabs.includes(path)) s.openTabs.push(path);
      s.activeTab = path;
    }),
  );
  const loaded = state.files[path];
  if (!loaded || loaded.status === "error") void loadFile(path);
}

async function loadFile(path: string) {
  setState("files", path, { status: "loading" });
  try {
    const text = await backend.readFile(path);
    setState("files", path, { status: "ready", value: text });
  } catch (error) {
    setState("files", path, { status: "error", error: asError(error) });
  }
}

function asError(error: unknown): CommandError {
  return isCommandError(error) ? error : { kind: "io", detail: String(error) };
}

async function loadDir(path: string) {
  // When refreshing, keep showing the old listing until the new one arrives.
  if (state.dirs[path]?.status !== "ready") {
    setState("dirs", path, { status: "loading" });
  }
  try {
    const entries = await backend.listDir(path === "" ? null : path);
    setState("dirs", path, { status: "ready", value: entries });
  } catch (error) {
    setState("dirs", path, { status: "error", error: asError(error) });
  }
}

/** Reloads the list of every file, for Go to file and project search. */
export async function refreshFileList(): Promise<FileList | null> {
  if (!state.project) return null;
  try {
    const list = await backend.listFiles();
    setState("fileList", list);
    return list;
  } catch {
    return state.fileList;
  }
}

/** Reads every listing again, after the hidden names changed. */
function reloadTree() {
  if (!state.project) return;
  searchCache.clear();
  setState("dirs", {});
  void loadDir("");
  for (const path of state.expanded) void loadDir(path);
  void refreshFileList();
}

/**
 * Re-reads what Claude may have changed: the tree, and open files without unsaved edits.
 * `paths` limits it to those files; `"all"` is for commands, which can touch anything.
 */
export function filesChangedOnDisk(paths: string[] | "all") {
  if (!state.project) return;
  searchCache.clear();
  void loadDir("");
  for (const path of state.expanded) void loadDir(path);
  void refreshFileList();
  for (const path of state.openTabs) {
    if (state.dirty[path] || !state.files[path]) continue;
    if (paths !== "all" && !paths.includes(path)) continue;
    buffers.delete(path);
    void loadFile(path);
  }
}

function projectOpened(project: ProjectInfo) {
  resetClaude();
  buffers.clear();
  searchCache.clear();
  setState(
    produce((s) => {
      s.project = project;
      s.dirs = {};
      s.expanded = [];
      s.files = {};
      s.fileList = null;
      s.openTabs = [];
      s.activeTab = "";
      s.dirty = {};
    }),
  );
  void loadDir("");
  void refreshFileList();
}

/** Picks up a folder Rust already has open, after a reload of the window. */
export async function loadCurrentProject() {
  if (!hasBackend()) {
    setState("project", null);
    return;
  }
  try {
    const project = await backend.currentProject();
    if (project) projectOpened(project);
    else setState("project", null);
  } catch {
    setState("project", null);
  }
}

const [openError, setOpenError] = createSignal<CommandError | null>(null);

export { openError };

/**
 * Shows the native folder picker. Opening a folder drops unsaved edits, because
 * they can't be saved yet, so ask first.
 */
export async function openProjectFolder(discardUnsaved = false) {
  setOpenError(null);
  if (!discardUnsaved && Object.values(state.dirty).some(Boolean)) {
    setDialog("discard-changes");
    return;
  }
  try {
    const project = await backend.openProject();
    if (project) projectOpened(project);
  } catch (error) {
    setOpenError(asError(error));
  }
}

/** A folder's listing for the tree, loading it the first time it's needed. */
export function dirEntries(path: string): Loadable<DirEntry[]> | undefined {
  const listing = state.dirs[path];
  if (!listing && state.project) queueMicrotask(() => void loadDir(path));
  return listing;
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function setDirty(path: string, dirty: boolean) {
  setState("dirty", path, dirty);
}

// The file's text after review: accepted hunks applied, everything else original.
export function resolvedText(path: string): string {
  const file = PROPOSALS[path];
  if (!file?.segments) return "";
  return file.segments
    .flatMap((segment) => {
      if (segment.kind === "context") return segment.lines;
      return decisionOf(path, segment.id) === "accepted"
        ? segment.added
        : segment.removed;
    })
    .join("\n");
}

export function showSidebar(sidebar: "explorer" | "search") {
  setState("sidebar", sidebar);
}

// Files read for project search, so searching again doesn't reread them all.
const searchCache = new Map<string, string | null>();
// Stops here so a huge project can't flood the app with reads.
const MAX_SEARCHED_FILES = 2_000;

/**
 * What project search looks at: unsaved edits where they exist, like VS Code, and
 * otherwise each file as it is on disk. Binary and oversized files are skipped.
 */
export async function loadSearchTexts(): Promise<{
  texts: Map<string, string>;
  skipped: number;
  truncated: boolean;
}> {
  const list = (await refreshFileList()) ?? { paths: [], truncated: false };
  const paths = list.paths.slice(0, MAX_SEARCHED_FILES);
  const texts = new Map<string, string>();
  let skipped = 0;
  const missing = paths.filter(
    (path) => !buffers.has(path) && !searchCache.has(path),
  );
  // A few reads at a time, so the app stays responsive while searching.
  for (let i = 0; i < missing.length; i += 16) {
    await Promise.all(
      missing.slice(i, i + 16).map(async (path) => {
        try {
          searchCache.set(path, await backend.readFile(path));
        } catch {
          searchCache.set(path, null);
        }
      }),
    );
  }
  for (const path of paths) {
    const text =
      buffers.get(path)?.state.doc.toString() ?? searchCache.get(path) ?? null;
    if (text === null) skipped += 1;
    else texts.set(path, text);
  }
  return {
    texts,
    skipped,
    truncated: list.truncated || list.paths.length > MAX_SEARCHED_FILES,
  };
}

export function revealMatch(
  path: string,
  line: number,
  start: number,
  end: number,
) {
  navigate("editor");
  openFile(path);
  setReveal({ path, line, start, end });
}

/** Text of every file read so far, with unsaved edits, for word completion. */
export function projectTexts(): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [path, file] of Object.entries(state.files)) {
    if (file.status === "ready") texts.set(path, file.value);
  }
  for (const [path, buffer] of buffers) {
    texts.set(path, buffer.state.doc.toString());
  }
  return texts;
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
      s.expanded = s.expanded.includes(path)
        ? s.expanded.filter((p) => p !== path)
        : [...s.expanded, path];
    }),
  );
  // Reload on every expand, so changes made outside the app show up.
  if (state.expanded.includes(path)) void loadDir(path);
}

export function selectSession(id: string) {
  setState("activeSessionId", id);
}

/** A proposed change to show for this file, in the design preview only. */
export function proposalFor(path: string): SourceFile | undefined {
  return PREVIEW_CLAUDE ? PROPOSALS[path] : undefined;
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
  const file = proposalFor(path);
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
  for (const seg of proposalFor(path)?.segments ?? []) {
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
  const file = proposalFor(path);
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
  const start = state.preview.startOn;
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
    mode: state.preview.askBeforeEdits ? "ask" : "auto",
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
