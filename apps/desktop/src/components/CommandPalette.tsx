import { startCompletion } from "@codemirror/autocomplete";
import {
  addCursorAbove,
  addCursorBelow,
  toggleComment,
} from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { selectSelectionMatches } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { activeEditor } from "../lib/activeEditor";
import { PREVIEW_CLAUDE } from "../lib/flags";
import { isMarkdown, toggleMarkdownPreview } from "../state/markdown";
import {
  accountOf,
  letterOf,
  navigate,
  openFile,
  openProjectFolder,
  refreshFileList,
  setDialog,
  showSidebar,
  state,
  stepFontSize,
  updateSettings,
} from "../state/store";
import { focusProjectSearch } from "../views/SearchPanel";
import { FileTypeIcon } from "./FileTypeIcon";
import { openFindInActive, openReplacePanel } from "./FindPanel";
import { SearchIcon } from "./Icons";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const ALT = IS_MAC ? "⌥" : "Alt+";
const SHIFT = IS_MAC ? "⇧" : "Shift+";

const [initialText, setInitialText] = createSignal<string | null>(null);

/** Opens the palette: "" for files, ">" for commands, ":" for go to line. */
export function openPalette(prefix: string) {
  setInitialText(prefix);
}

interface Item {
  label: JSX.Element;
  title?: string;
  detail?: JSX.Element;
  keys?: string;
  isOpen?: boolean;
  badge?: { letter: string; color: string };
  run: () => void;
}

interface Command {
  label: string;
  keys?: string;
  needsEditor?: boolean;
  run: (view: EditorView | null) => void;
}

function withEditor(run: (view: EditorView) => unknown) {
  return (view: EditorView | null) => {
    if (!view) return;
    run(view);
    view.focus();
  };
}

function searchAllFiles() {
  navigate("editor");
  showSidebar("search");
  const view = activeEditor();
  const range = view?.state.selection.main;
  const selected =
    view && range && !range.empty
      ? view.state.sliceDoc(range.from, range.to)
      : "";
  // Like VS Code, a one-line selection becomes the search text.
  focusProjectSearch(selected.includes("\n") ? "" : selected);
}

const COMMANDS: Command[] = [
  {
    label: "Open Folder…",
    keys: `${MOD}O`,
    run: () => void openProjectFolder(),
  },
  { label: "Go to File…", keys: `${MOD}${SHIFT}O`, run: () => openPalette("") },
  {
    label: "Search in All Files",
    keys: `${MOD}${SHIFT}F`,
    run: searchAllFiles,
  },
  {
    label: "Show Explorer",
    keys: `${MOD}${SHIFT}E`,
    run: () => showSidebar("explorer"),
  },
  {
    label: "Go to Line…",
    keys: "⌃G",
    needsEditor: true,
    run: () => openPalette(":"),
  },
  { label: "Find", keys: `${MOD}F`, run: () => openFindInActive() },
  {
    label: "Toggle Markdown Preview",
    keys: IS_MAC ? "⇧⌘V" : "Ctrl+Shift+V",
    run: toggleMarkdownPreview,
  },
  {
    label: "Replace",
    keys: `${MOD}${ALT}F`,
    needsEditor: true,
    run: withEditor(openReplacePanel),
  },
  {
    label: "Toggle Line Comment",
    keys: `${MOD}/`,
    needsEditor: true,
    run: withEditor(toggleComment),
  },
  {
    label: "Trigger Suggest",
    keys: "⌃Space",
    needsEditor: true,
    run: withEditor(startCompletion),
  },
  {
    label: "Select All Occurrences",
    keys: `${MOD}${SHIFT}L`,
    needsEditor: true,
    run: withEditor(selectSelectionMatches),
  },
  {
    label: "Add Cursor Above",
    keys: `${MOD}${ALT}↑`,
    needsEditor: true,
    run: withEditor(addCursorAbove),
  },
  {
    label: "Add Cursor Below",
    keys: `${MOD}${ALT}↓`,
    needsEditor: true,
    run: withEditor(addCursorBelow),
  },
  {
    label: "Fold All",
    keys: `⌃${ALT}[`,
    needsEditor: true,
    run: withEditor(foldAll),
  },
  {
    label: "Unfold All",
    keys: `⌃${ALT}]`,
    needsEditor: true,
    run: withEditor(unfoldAll),
  },
  {
    label: "Toggle Word Wrap",
    run: () => updateSettings({ wrapLines: !state.settings.wrapLines }),
  },
  {
    label: "Toggle Inline / Side-by-Side Diff",
    run: () =>
      updateSettings({
        diffLayout: state.settings.diffLayout === "side" ? "inline" : "side",
      }),
  },
  { label: "Increase Font Size", keys: `${MOD}+`, run: () => stepFontSize(1) },
  { label: "Decrease Font Size", keys: `${MOD}-`, run: () => stepFontSize(-1) },
  { label: "Reset Font Size", keys: `${MOD}0`, run: () => stepFontSize(0) },
  {
    label: "Toggle Light / Dark Theme",
    run: () =>
      updateSettings({
        theme: state.settings.theme === "dark" ? "light" : "dark",
      }),
  },
  { label: "Open Settings", run: () => navigate("settings") },
  ...(PREVIEW_CLAUDE
    ? [{ label: "New Session", run: () => setDialog("new-session") }]
    : []),
];

interface Match {
  score: number;
  hits: number[];
}

/** Subsequence match, scoring consecutive letters and word starts higher. */
function fuzzyMatch(query: string, text: string): Match | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let qi = 0;
  let last = -2;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] !== q[qi]) continue;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || "/_.- ".includes(t[i - 1] ?? "")) score += 2;
    hits.push(i);
    last = i;
    qi += 1;
  }
  return qi === q.length ? { score: score - t.length * 0.01, hits } : null;
}

function ranked<T>(
  query: string,
  items: T[],
  text: (item: T) => string,
): { item: T; hits: number[] }[] {
  if (!query) return items.map((item) => ({ item, hits: [] }));
  return items
    .flatMap((item) => {
      const match = fuzzyMatch(query, text(item));
      return match ? [{ item, ...match }] : [];
    })
    .sort((a, b) => b.score - a.score);
}

/** Shows `text` with the characters at `hits` (offset by `offset`) highlighted. */
function Highlighted(props: { text: string; hits: number[]; offset?: number }) {
  const parts = () => {
    const offset = props.offset ?? 0;
    const marked = new Set(props.hits.map((hit) => hit - offset));
    const out: { text: string; hit: boolean }[] = [];
    for (let i = 0; i < props.text.length; i += 1) {
      const hit = marked.has(i);
      const lastPart = out[out.length - 1];
      if (lastPart && lastPart.hit === hit) lastPart.text += props.text[i];
      else out.push({ text: props.text[i] ?? "", hit });
    }
    return out;
  };
  return (
    <For each={parts()}>
      {(part) => (part.hit ? <mark>{part.text}</mark> : part.text)}
    </For>
  );
}

function goToLine(view: EditorView, line: number) {
  const target = view.state.doc.line(
    Math.min(Math.max(line, 1), view.state.doc.lines),
  );
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
  });
  view.focus();
}

/** Like `ranked`, but matches in the file name count more than matches in its folder. */
function rankedFiles(query: string): { item: string; hits: number[] }[] {
  const paths = state.fileList?.paths ?? [];
  if (!query) return paths.map((item) => ({ item, hits: [] }));
  return paths
    .flatMap((path) => {
      const match = fuzzyMatch(query, path);
      if (!match) return [];
      const nameStart = path.lastIndexOf("/") + 1;
      const inName = match.hits.filter((hit) => hit >= nameStart).length;
      return [{ item: path, hits: match.hits, score: match.score + inName }];
    })
    .sort((a, b) => b.score - a.score);
}

function fileItems(query: string): Item[] {
  return rankedFiles(query).map(({ item: path, hits }) => {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    const dir = slash > 0 ? path.slice(0, slash) : "";
    const session = state.sessions.find((s) => s.file === path);
    const account = session ? accountOf(session.accountId) : undefined;
    return {
      label: <Highlighted text={name} hits={hits} offset={slash + 1} />,
      title: path,
      detail: dir ? <Highlighted text={dir} hits={hits} /> : undefined,
      isOpen: state.openTabs.includes(path),
      badge: account
        ? { letter: letterOf(account.label), color: account.color }
        : undefined,
      run: () => {
        navigate("editor");
        openFile(path);
      },
    };
  });
}

function Palette(props: { initial: string; onClose: () => void }) {
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  let list!: HTMLUListElement;
  const [text, setText] = createSignal(props.initial);
  const [selected, setSelected] = createSignal(0);
  // Read before the dialog takes focus, so commands act on the editor that was in use.
  const view = activeEditor();

  const mode = () =>
    text().startsWith(">")
      ? "commands"
      : text().startsWith(":")
        ? "line"
        : "files";

  const items = createMemo((): Item[] => {
    const value = text();
    if (mode() === "commands") {
      const available = COMMANDS.filter((c) => !c.needsEditor || view);
      return ranked(value.slice(1).trim(), available, (c) => c.label).map(
        ({ item: c, hits }) => ({
          label: <Highlighted text={c.label} hits={hits} />,
          keys: c.keys,
          run: () => c.run(view),
        }),
      );
    }
    if (mode() === "line") {
      if (!view)
        return [{ label: "Open a file to go to a line", run: () => {} }];
      const line = Number.parseInt(value.slice(1), 10);
      const lines = view.state.doc.lines;
      if (Number.isNaN(line)) {
        return [
          { label: `Type a line number, from 1 to ${lines}`, run: () => {} },
        ];
      }
      return [{ label: `Go to line ${line}`, run: () => goToLine(view, line) }];
    }
    return fileItems(value.trim());
  });

  const choose = (item: Item | undefined) => {
    if (!item) return;
    dialog.close();
    item.run();
  };

  const move = (step: number) => {
    const count = items().length;
    if (!count) return;
    setSelected((i) => (i + step + count) % count);
    list
      .querySelector(`[data-index="${selected()}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items()[selected()]);
    }
  };

  onMount(() => {
    // Picks up files created since the list was last read.
    if (mode() === "files") void refreshFileList();
    dialog.showModal();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  const placeholder = () => {
    if (mode() === "commands") return "Type a command";
    if (mode() === "line") return "Type a line number";
    return "Go to file. Type > for commands, : for a line";
  };

  const countText = () => {
    const count = items().length;
    if (mode() === "line") return "";
    const noun = mode() === "commands" ? "command" : "file";
    const more = mode() === "files" && state.fileList?.truncated ? "+" : "";
    return `${count}${more} ${noun}${count === 1 ? "" : "s"}`;
  };

  return (
    <dialog
      ref={dialog}
      class="palette"
      aria-label="Command palette"
      onClose={props.onClose}
    >
      <div class="palette-search">
        <SearchIcon size={14} />
        <input
          ref={input}
          class="palette-input"
          aria-label={placeholder()}
          placeholder={placeholder()}
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={onKey}
        />
        <kbd>esc</kbd>
      </div>
      <ul ref={list} class="palette-list">
        <For each={items()}>
          {(item, index) => (
            <li data-index={index()}>
              <button
                type="button"
                class="palette-item"
                title={item.title}
                classList={{ selected: index() === selected() }}
                aria-current={index() === selected() ? "true" : undefined}
                onMouseMove={() => setSelected(index())}
                onClick={() => choose(item)}
              >
                <Show when={mode() === "files"}>
                  <span class="tree-file">
                    <FileTypeIcon name={item.title ?? ""} size={14} />
                  </span>
                </Show>
                <span class="palette-label">{item.label}</span>
                <Show when={item.detail}>
                  <span class="palette-detail">{item.detail}</span>
                </Show>
                <span class="spacer" />
                <Show when={item.isOpen}>
                  <span class="palette-open">open</span>
                </Show>
                <Show when={item.badge}>
                  {(badge) => (
                    <span class={`tree-letter acct-${badge().color}`}>
                      {badge().letter}
                    </span>
                  )}
                </Show>
                <Show when={item.keys}>
                  <kbd>{item.keys}</kbd>
                </Show>
              </button>
            </li>
          )}
        </For>
        <Show when={items().length === 0}>
          <li class="palette-empty">
            {mode() === "files" && !state.project
              ? "Open a folder first (⌘O)"
              : "No matches"}
          </li>
        </Show>
      </ul>
      <footer class="palette-footer">
        <span>
          <kbd>↑↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
        <span class="spacer" />
        <span>{countText()}</span>
      </footer>
    </dialog>
  );
}

function inEditor(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof HTMLElement && node.classList.contains("cm-editor"),
    );
}

/** App-wide shortcuts, and the palette they open. */
export function CommandPalette() {
  const onKey = (event: KeyboardEvent) => {
    if (!state.settings.setupDone) return;
    const mod = IS_MAC ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    const plain = mod && !event.altKey;
    let run: (() => void) | null = null;

    if (plain && !event.shiftKey && key === "o") {
      run = () => void openProjectFolder();
    } else if (plain && event.shiftKey && key === "o")
      run = () => openPalette("");
    else if (plain && !event.shiftKey && key === "p")
      run = () => openPalette("");
    else if (plain && event.shiftKey && key === "p")
      run = () => openPalette(">");
    else if (plain && event.shiftKey && key === "f") run = searchAllFiles;
    else if (
      plain &&
      event.shiftKey &&
      key === "v" &&
      state.view === "editor" &&
      state.activeTab &&
      isMarkdown(state.activeTab)
    )
      run = toggleMarkdownPreview;
    else if (plain && event.shiftKey && key === "e") {
      run = () => {
        navigate("editor");
        showSidebar("explorer");
      };
    } else if (plain && (key === "=" || key === "+")) {
      run = () => stepFontSize(1);
    } else if (plain && (key === "-" || key === "_")) {
      run = () => stepFontSize(-1);
    } else if (plain && !event.shiftKey && key === "0") {
      run = () => stepFontSize(0);
    } else if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      key === "g"
    ) {
      run = () => openPalette(":");
    } else if (
      plain &&
      !event.shiftKey &&
      key === "f" &&
      state.view === "editor" &&
      !inEditor(event)
    ) {
      // Inside an editor, its own Cmd+F binding handles this.
      run = openFindInActive;
    }
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  onMount(() => window.addEventListener("keydown", onKey, true));
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

  return (
    <Show when={initialText() !== null}>
      <Palette
        initial={initialText() ?? ""}
        onClose={() => setInitialText(null)}
      />
    </Show>
  );
}
