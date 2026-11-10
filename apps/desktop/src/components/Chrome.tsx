import { For, Match, Show, Switch } from "solid-js";
import { languageName } from "../lib/codemirror";
import { PREVIEW_CLAUDE } from "../lib/flags";
import { toReviewCount } from "../state/runs";
import {
  accountOf,
  conflictingFiles,
  cursor,
  navigate,
  proposalFor,
  saveStatus,
  setDialog,
  state,
  updateSettings,
} from "../state/store";
import type { View } from "../types";
import { NewRunButton } from "../views/Agentic";
import { openPalette } from "./CommandPalette";
import { STATUS_WORD } from "./Common";
import { findMatches } from "./FindPanel";
import { CheckIcon, SearchIcon } from "./Icons";
import { Mascot } from "./Mascot";

const ALL_TABS: { view: View; label: string; preview?: boolean }[] = [
  { view: "editor", label: "Editor" },
  { view: "agentic", label: "Agentic" },
  { view: "parallel", label: "Parallel", preview: true },
  { view: "accounts", label: "Accounts", preview: true },
  { view: "settings", label: "Settings" },
];
const TABS = ALL_TABS.filter((tab) => PREVIEW_CLAUDE || !tab.preview);

export function Brand() {
  return (
    <span class="brand">
      <Mascot size={22} class="brand-mark" />
      Claudine
    </span>
  );
}

export function AppBar() {
  const workspaceView = () =>
    state.view === "editor" ||
    state.view === "agentic" ||
    state.view === "parallel";
  return (
    <header class="appbar">
      <Brand />
      <Show when={workspaceView() && state.project}>
        {(project) => <span class="project-path">{project().name}</span>}
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
              <Show when={tab.view === "agentic" && toReviewCount() > 0}>
                <span
                  class="count-badge accent"
                  title={`${toReviewCount()} to review`}
                >
                  {toReviewCount()}
                </span>
              </Show>
            </button>
          )}
        </For>
      </nav>
      <Show when={workspaceView() && state.project}>
        <button type="button" class="goto-box" onClick={() => openPalette("")}>
          <SearchIcon size={13} />
          <span>Go to file…</span>
          <kbd>⌘⇧O</kbd>
        </button>
      </Show>
      <div class="appbar-right">
        <Switch>
          <Match when={state.view === "editor" && PREVIEW_CLAUDE}>
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
          <Match when={state.view === "agentic"}>
            <NewRunButton />
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
            <Switch>
              <Match when={saveStatus() === "error"}>
                <span class="saved-note save-error">
                  Couldn't save settings
                </span>
              </Match>
              <Match when={saveStatus() === "saving"}>
                <span class="saved-note">Saving…</span>
              </Match>
              <Match when={saveStatus() === "saved"}>
                <span class="saved-note">
                  <CheckIcon size={13} /> Changes save automatically
                </span>
              </Match>
            </Switch>
          </Match>
        </Switch>
      </div>
    </header>
  );
}

export function StatusBar() {
  const conflictNote = () => {
    const files = conflictingFiles();
    if (!state.preview.warnSameFile) return "Conflict warnings off";
    if (files.length === 0)
      return "Conflicts: none · sessions touch separate files";
    return `Conflict: ${files.length} ${files.length === 1 ? "file" : "files"} edited by more than one session`;
  };
  return (
    <footer class="statusbar">
      <Show when={state.view === "agentic"}>
        <span>
          Agentic mode ·{" "}
          {
            {
              auto: "Auto mode",
              acceptEdits: "Accept edits",
              ask: "Ask each time",
            }[state.settings.runPermissions]
          }
        </span>
        <span>Pre-PR review {state.settings.prePrReview ? "on" : "off"}</span>
      </Show>
      <Show
        when={state.view === "editor"}
        fallback={
          <Show when={state.view === "parallel"}>
            <span>{conflictNote()}</span>
          </Show>
        }
      >
        <Show when={state.activeTab}>
          <span>{languageName(state.activeTab)}</span>
        </Show>
        <Show when={proposalFor(state.activeTab)}>
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
        <span>
          {state.settings.insertSpaces ? "Spaces" : "Tab size"}:{" "}
          {state.settings.tabSize}
        </span>
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
