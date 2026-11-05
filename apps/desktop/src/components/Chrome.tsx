import { For, Match, Show, Switch } from "solid-js";
import { languageName } from "../lib/codemirror";
import { BRANCH, FILES, PROJECT_PATH } from "../mock/data";
import {
  accountOf,
  conflictingFiles,
  cursor,
  navigate,
  setDialog,
  state,
  updateSettings,
} from "../state/store";
import type { View } from "../types";
import { openPalette } from "./CommandPalette";
import { STATUS_WORD } from "./Common";
import { findMatches } from "./FindPanel";
import { CheckIcon, LogoIcon, SearchIcon } from "./Icons";

const TABS: { view: View; label: string }[] = [
  { view: "editor", label: "Editor" },
  { view: "parallel", label: "Parallel" },
  { view: "accounts", label: "Accounts" },
  { view: "settings", label: "Settings" },
];

export function Brand() {
  return (
    <span class="brand">
      <span class="brand-mark">
        <LogoIcon size={16} />
      </span>
      Claudine
    </span>
  );
}

export function AppBar() {
  const workspaceView = () =>
    state.view === "editor" || state.view === "parallel";
  return (
    <header class="appbar">
      <Brand />
      <Show when={workspaceView()}>
        <span class="project-path">{PROJECT_PATH}</span>
      </Show>
      <nav class="tabs" aria-label="Main">
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              class="nav-tab"
              classList={{ active: state.view === tab.view }}
              aria-current={state.view === tab.view ? "page" : undefined}
              onClick={() => navigate(tab.view)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </nav>
      <Show when={workspaceView()}>
        <button type="button" class="goto-box" onClick={() => openPalette("")}>
          <SearchIcon size={13} />
          <span>Go to file…</span>
          <kbd>⌘⇧O</kbd>
        </button>
      </Show>
      <div class="appbar-right">
        <Switch>
          <Match when={state.view === "editor"}>
            <span class="live-pill">
              <span class="dot dot-running" />
              {state.sessions.length}{" "}
              {state.sessions.length === 1 ? "session" : "sessions"} live
            </span>
            <button
              type="button"
              class="btn btn-accent"
              onClick={() => setDialog("new-session")}
            >
              New session
            </button>
          </Match>
          <Match when={state.view === "parallel"}>
            <span class="muted appbar-note">
              Each session runs its own Claude Code process on its own account
            </span>
            <button
              type="button"
              class="btn"
              disabled={state.sessions.length === 0}
              onClick={() => setDialog("broadcast")}
            >
              Broadcast prompt
            </button>
            <button
              type="button"
              class="btn btn-accent"
              onClick={() => setDialog("new-session")}
            >
              Add session
            </button>
          </Match>
          <Match when={state.view === "settings"}>
            <span class="saved-note">
              <CheckIcon size={13} /> Changes save automatically
            </span>
          </Match>
        </Switch>
      </div>
    </header>
  );
}

export function StatusBar() {
  const conflictNote = () => {
    const files = conflictingFiles();
    if (!state.settings.warnSameFile) return "Conflict warnings off";
    if (files.length === 0)
      return "Conflicts: none · sessions touch separate files";
    return `Conflict: ${files.length} ${files.length === 1 ? "file" : "files"} edited by more than one session`;
  };
  return (
    <footer class="statusbar">
      <span>{BRANCH}</span>
      <Show
        when={state.view === "editor"}
        fallback={<span>{conflictNote()}</span>}
      >
        <span>{languageName(state.activeTab)}</span>
        <Show when={FILES[state.activeTab]?.segments}>
          <button
            type="button"
            class="status-btn"
            title="Switch diff layout"
            onClick={() =>
              updateSettings({
                diffLayout:
                  state.settings.diffLayout === "side" ? "inline" : "side",
              })
            }
          >
            {state.settings.diffLayout === "side"
              ? "Side-by-side diff"
              : "Inline diff"}
          </button>
        </Show>
      </Show>
      <Show when={state.view === "editor" && cursor()}>
        {(c) => (
          <span>
            Ln {c().line}, Col {c().column}
            {c().selections > 1
              ? ` (${c().selections} cursors)`
              : c().selected > 0
                ? ` (${c().selected} selected)`
                : ""}
          </span>
        )}
      </Show>
      <Show when={state.view === "editor" && cursor()}>
        <span>Spaces: 4</span>
      </Show>
      <Show when={state.view === "editor" && state.dirty[state.activeTab]}>
        <span class="status-unsaved">
          Unsaved · saving needs the Rust backend
        </span>
      </Show>
      <Show when={state.view === "editor" && findMatches()?.total}>
        <span>
          {findMatches()?.current || "–"}/{findMatches()?.total} matches
        </span>
      </Show>
      <span class="status-legend">
        <Show when={state.view === "editor"}>
          <span class="status-hint">⌘⇧O files</span>
          <span class="status-hint">⌘F find</span>
          <span class="status-hint status-hint-last">⌘⇧F search</span>
        </Show>
        <For each={state.sessions}>
          {(session) => {
            const account = () => accountOf(session.accountId);
            return (
              <Show when={account()}>
                {(a) => (
                  <span class={`legend-item acct-${a().color}`}>
                    {a().label.charAt(0).toUpperCase()}{" "}
                    <span class="dot dot-acct" /> {STATUS_WORD[session.status]}
                  </span>
                )}
              </Show>
            );
          }}
        </For>
      </span>
    </footer>
  );
}
