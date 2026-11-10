import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { ChevronDown, ChevronRight } from "../components/Icons";
import { type SearchResults, searchProject } from "../lib/projectSearch";
import { fileName, loadSearchTexts, revealMatch, state } from "../state/store";

const [focusRequest, setFocusRequest] = createSignal<{ text: string } | null>(
  null,
);

/** Cmd+Shift+F: focuses the search box, starting from `text` if given. */
export function focusProjectSearch(text: string) {
  setFocusRequest({ text });
}

const EMPTY: SearchResults = {
  files: [],
  total: 0,
  truncated: false,
  error: null,
};

function Highlighted(props: { text: string; start: number; end: number }) {
  return (
    <>
      {props.text.slice(0, props.start)}
      <mark>{props.text.slice(props.start, props.end)}</mark>
      {props.text.slice(props.end)}
    </>
  );
}

export function SearchPanel() {
  let input!: HTMLInputElement;
  const [text, setText] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [wholeWord, setWholeWord] = createSignal(false);
  const [regexp, setRegexp] = createSignal(false);
  const [results, setResults] = createSignal<SearchResults>(EMPTY);
  const [collapsed, setCollapsed] = createSignal<string[]>([]);
  let timer: number | undefined;

  const [searching, setSearching] = createSignal(false);
  const [skipped, setSkipped] = createSignal(0);
  let run = 0;

  // Waits for a pause in typing, like VS Code, so each keystroke doesn't rescan.
  createEffect(() => {
    const options = {
      text: text(),
      caseSensitive: caseSensitive(),
      wholeWord: wholeWord(),
      regexp: regexp(),
    };
    state.project;
    window.clearTimeout(timer);
    if (!options.text) {
      setResults(EMPTY);
      return;
    }
    timer = window.setTimeout(async () => {
      const mine = ++run;
      setSearching(true);
      const loaded = await loadSearchTexts();
      // A newer search started while this one was reading files.
      if (mine !== run) return;
      const found = searchProject(loaded.texts, options);
      setResults({ ...found, truncated: found.truncated || loaded.truncated });
      setSkipped(loaded.skipped);
      setSearching(false);
    }, 150);
  });
  onCleanup(() => window.clearTimeout(timer));

  createEffect(
    on(focusRequest, (request) => {
      if (!request) return;
      if (request.text) setText(request.text);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      setFocusRequest(null);
    }),
  );

  const summary = () => {
    const r = results();
    if (!state.project) return "Open a folder to search it.";
    if (r.error) return r.error;
    if (!text()) return "";
    if (searching()) return "Searching…";
    if (r.total === 0) return "No results";
    const files = r.files.length;
    return `${r.total}${r.truncated ? "+" : ""} ${r.total === 1 ? "result" : "results"} in ${files} ${files === 1 ? "file" : "files"}`;
  };

  const toggleFile = (path: string) =>
    setCollapsed((list) =>
      list.includes(path) ? list.filter((p) => p !== path) : [...list, path],
    );

  return (
    <aside class="sidebar search-sidebar">
      <h2 class="section-title">Search</h2>
      <div class="search-field">
        <input
          ref={input}
          aria-label="Search all files"
          placeholder="Search"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            const first = results().files[0]?.matches[0];
            const path = results().files[0]?.path;
            if (e.key === "Enter" && first && path) {
              revealMatch(path, first.line, first.start, first.end);
            }
          }}
        />
        <button
          type="button"
          class="search-option"
          classList={{ on: caseSensitive() }}
          title="Match case"
          aria-pressed={caseSensitive()}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          type="button"
          class="search-option"
          classList={{ on: wholeWord() }}
          title="Match whole word"
          aria-pressed={wholeWord()}
          onClick={() => setWholeWord((v) => !v)}
        >
          ab
        </button>
        <button
          type="button"
          class="search-option"
          classList={{ on: regexp() }}
          title="Use regular expression"
          aria-pressed={regexp()}
          onClick={() => setRegexp((v) => !v)}
        >
          .*
        </button>
      </div>
      <p class="search-summary" classList={{ error: !!results().error }}>
        {summary()}
      </p>
      <Show when={text() && skipped() > 0 && !searching()}>
        <p class="search-summary">
          Skipped {skipped()} binary or oversized{" "}
          {skipped() === 1 ? "file" : "files"}.
        </p>
      </Show>
      <div class="search-results">
        <For each={results().files}>
          {(file) => {
            const name = () => fileName(file.path);
            const dir = () => file.path.split("/").slice(0, -1).join("/");
            const open = () => !collapsed().includes(file.path);
            return (
              <div class="search-file">
                <button
                  type="button"
                  class="search-file-row"
                  aria-expanded={open()}
                  onClick={() => toggleFile(file.path)}
                >
                  <span class="tree-chevron">
                    <Show when={open()} fallback={<ChevronRight size={12} />}>
                      <ChevronDown size={12} />
                    </Show>
                  </span>
                  <span class="tree-file">
                    <FileTypeIcon name={name()} size={14} />
                  </span>
                  <span class="search-file-name">{name()}</span>
                  <span class="search-file-dir">{dir()}</span>
                  <span class="search-count">{file.matches.length}</span>
                </button>
                <Show when={open()}>
                  <For each={file.matches}>
                    {(match) => (
                      <button
                        type="button"
                        class="search-match"
                        title={`Line ${match.line}`}
                        onClick={() =>
                          revealMatch(
                            file.path,
                            match.line,
                            match.start,
                            match.end,
                          )
                        }
                      >
                        <Highlighted
                          text={match.preview}
                          start={match.previewStart}
                          end={match.previewEnd}
                        />
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </aside>
  );
}
