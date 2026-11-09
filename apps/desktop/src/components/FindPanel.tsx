import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { activeEditor, reviewEditor } from "../lib/activeEditor";

// Stops counting here so a huge file can't freeze the UI.
const MAX_COUNT = 10_000;
const replaceRequested = new WeakSet<EditorView>();

// The open find bar's count, for the status bar.
const [findMatches, setFindMatches] = createSignal<{
  current: number;
  total: number;
} | null>(null);

export { findMatches };

/** The find bar for whatever is on screen: the editor, or the Proposed side of a diff. */
export function openFindInActive() {
  const view = activeEditor() ?? reviewEditor();
  if (view) openFind(view);
}
const revealReplace = new WeakMap<EditorView, () => void>();
const focusFind = new WeakMap<EditorView, () => void>();

/**
 * Cmd+F. CodeMirror's own command re-focuses an open panel through a `main-field` input,
 * but its find-next commands then select that input's text after every keystroke.
 */
export function openFind(view: EditorView): boolean {
  const focus = focusFind.get(view);
  if (searchPanelOpen(view.state) && focus) {
    focus();
    return true;
  }
  return openSearchPanel(view);
}

/** Like VS Code: while typing, select the first match at or after the cursor. */
function selectNearestMatch(view: EditorView) {
  const query = getSearchQuery(view.state);
  if (!query.search || !query.valid) return;
  const from = view.state.selection.main.from;
  let match = query.getCursor(view.state, from).next();
  if (match.done) match = query.getCursor(view.state).next();
  if (match.done) return;
  view.dispatch({
    selection: { anchor: match.value.from, head: match.value.to },
    effects: EditorView.scrollIntoView(match.value.from, { y: "center" }),
  });
}

/** Cmd+Alt+F: like Cmd+F, with the replace row open. */
export function openReplacePanel(view: EditorView): boolean {
  const reveal = revealReplace.get(view);
  if (searchPanelOpen(view.state) && reveal) {
    reveal();
    return true;
  }
  replaceRequested.add(view);
  return openSearchPanel(view);
}

function countMatches(state: EditorState) {
  const query = getSearchQuery(state);
  if (!query.search || !query.valid) return { current: 0, total: 0 };
  const main = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total += 1;
    if (next.value.from === main.from && next.value.to === main.to) {
      current = total;
    }
    if (total >= MAX_COUNT) break;
  }
  return { current, total };
}

/** A VS Code-style find widget, used in place of CodeMirror's default panel. */
export function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-find";
  const [query, setQuery] = createSignal(getSearchQuery(view.state));
  const [counts, setCounts] = createSignal(countMatches(view.state));
  setFindMatches(counts());
  const [showReplace, setShowReplace] = createSignal(
    replaceRequested.has(view) || getSearchQuery(view.state).replace !== "",
  );
  replaceRequested.delete(view);
  let findInput!: HTMLInputElement;
  let replaceInput: HTMLInputElement | undefined;
  focusFind.set(view, () => {
    findInput.focus();
    findInput.select();
  });
  revealReplace.set(view, () => {
    setShowReplace(true);
    replaceInput?.focus();
    replaceInput?.select();
  });

  const update = (
    patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>,
  ) => {
    const current = query();
    const next = new SearchQuery({
      search: current.search,
      caseSensitive: current.caseSensitive,
      regexp: current.regexp,
      wholeWord: current.wholeWord,
      replace: current.replace,
      ...patch,
    });
    view.dispatch({ effects: setSearchQuery.of(next) });
    // Like VS Code, typing jumps to the nearest match from the cursor.
    if (
      patch.search !== undefined ||
      patch.caseSensitive !== undefined ||
      patch.regexp !== undefined ||
      patch.wholeWord !== undefined
    ) {
      selectNearestMatch(view);
    }
  };

  const onFindKey = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    } else if (
      event.code === "KeyF" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
      event.preventDefault();
      findInput.select();
    } else if (event.altKey && (event.metaKey || event.ctrlKey)) {
      const toggles: Record<string, () => void> = {
        KeyF: () => revealReplace.get(view)?.(),
        KeyC: () => update({ caseSensitive: !query().caseSensitive }),
        KeyW: () => update({ wholeWord: !query().wholeWord }),
        KeyR: () => update({ regexp: !query().regexp }),
      };
      const toggle = toggles[event.code];
      if (toggle) {
        event.preventDefault();
        toggle();
      }
    }
  };

  const onReplaceKey = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) replaceAll(view);
      else replaceNext(view);
    } else {
      onFindKey(event);
    }
  };

  const countText = () => {
    if (!query().search) return "";
    if (!query().valid) return "Invalid pattern";
    const { current, total } = counts();
    if (total === 0) return "No results";
    const shown = total >= MAX_COUNT ? `${MAX_COUNT}+` : String(total);
    return current > 0 ? `${current} of ${shown}` : `${shown} found`;
  };

  // Events use `on:` so they're attached here, not delegated past the shadow root.
  const dispose = render(
    () => (
      <>
        <div class="cm-find-row">
          <button
            type="button"
            class="cm-find-toggle-replace"
            aria-label="Toggle replace"
            aria-expanded={showReplace()}
            on:click={() => setShowReplace((open) => !open)}
          >
            {showReplace() ? "⌄" : "›"}
          </button>
          <div class="cm-find-field">
            <input
              ref={findInput}
              class="cm-find-input"
              aria-label="Find"
              placeholder="Find"
              value={query().search}
              on:input={(e) => update({ search: e.currentTarget.value })}
              on:keydown={onFindKey}
            />
            <button
              type="button"
              class="cm-find-option"
              classList={{ on: query().caseSensitive }}
              title="Match case (⌥⌘C)"
              aria-pressed={query().caseSensitive}
              on:click={() => update({ caseSensitive: !query().caseSensitive })}
            >
              Aa
            </button>
            <button
              type="button"
              class="cm-find-option"
              classList={{ on: query().wholeWord }}
              title="Match whole word (⌥⌘W)"
              aria-pressed={query().wholeWord}
              on:click={() => update({ wholeWord: !query().wholeWord })}
            >
              ab
            </button>
            <button
              type="button"
              class="cm-find-option"
              classList={{ on: query().regexp }}
              title="Use regular expression (⌥⌘R)"
              aria-pressed={query().regexp}
              on:click={() => update({ regexp: !query().regexp })}
            >
              .*
            </button>
          </div>
          <span
            class="cm-find-count"
            classList={{
              empty: countText() === "No results" || !query().valid,
            }}
          >
            {countText()}
          </span>
          <button
            type="button"
            class="cm-find-button"
            title="Previous match (⇧Enter)"
            aria-label="Previous match"
            on:click={() => findPrevious(view)}
          >
            ↑
          </button>
          <button
            type="button"
            class="cm-find-button"
            title="Next match (Enter)"
            aria-label="Next match"
            on:click={() => findNext(view)}
          >
            ↓
          </button>
          <button
            type="button"
            class="cm-find-button"
            title="Close (Escape)"
            aria-label="Close find"
            on:click={() => {
              closeSearchPanel(view);
              view.focus();
            }}
          >
            ×
          </button>
        </div>
        <Show when={showReplace()}>
          <div class="cm-find-row">
            <span class="cm-find-spacer" />
            <div class="cm-find-field">
              <input
                ref={replaceInput}
                class="cm-find-input"
                aria-label="Replace"
                placeholder="Replace"
                value={query().replace}
                on:input={(e) => update({ replace: e.currentTarget.value })}
                on:keydown={onReplaceKey}
              />
            </div>
            <button
              type="button"
              class="cm-find-text-button"
              title="Replace (Enter)"
              on:click={() => replaceNext(view)}
            >
              Replace
            </button>
            <button
              type="button"
              class="cm-find-text-button"
              title="Replace all (⌘Enter)"
              on:click={() => replaceAll(view)}
            >
              All
            </button>
          </div>
        </Show>
      </>
    ),
    dom,
  );

  return {
    dom,
    top: true,
    mount() {
      findInput.focus();
      findInput.select();
    },
    update(update: ViewUpdate) {
      const changedQuery = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setSearchQuery)),
      );
      if (changedQuery) setQuery(getSearchQuery(update.state));
      if (changedQuery || update.docChanged || update.selectionSet) {
        setCounts(countMatches(update.state));
        setFindMatches(counts());
      }
    },
    destroy() {
      revealReplace.delete(view);
      focusFind.delete(view);
      setFindMatches(null);
      dispose();
    },
  };
}
