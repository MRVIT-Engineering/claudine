import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { createEffect, onCleanup, onMount } from "solid-js";
import { buffers } from "../lib/buffers";
import {
  createEditorRoot,
  languageFor,
  sharedExtensions,
} from "../lib/codemirror";
import { state as appState, setCursor, setDirty } from "../state/store";

const wrapping = new Compartment();
const wrapExtension = (wrap: boolean) => (wrap ? EditorView.lineWrapping : []);

function createState(path: string, text: string) {
  return EditorState.create({
    doc: text,
    extensions: [
      sharedExtensions,
      languageFor(path),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      search({ top: true }),
      highlightSelectionMatches(),
      wrapping.of(wrapExtension(appState.settings.wrapLines)),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
        // Stops the webview's own handling. Saving needs the Rust backend.
        { key: "Mod-s", run: () => true },
      ]),
      EditorView.contentAttributes.of({ "aria-label": `Editing ${path}` }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setDirty(path, update.state.doc.toString() !== text);
        }
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          setCursor({ line: line.number, column: head - line.from + 1 });
        }
      }),
    ],
  });
}

export function CodeEditor(props: { path: string; text: string }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    const root = createEditorRoot(host);
    const cached = buffers.get(props.path);
    const editor = new EditorView({
      state: cached?.state ?? createState(props.path, props.text),
      scrollTo: cached?.scroll,
      parent: root,
      root,
    });
    view = editor;
    const head = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(head);
    setCursor({ line: line.number, column: head - line.from + 1 });
  });

  createEffect(() => {
    const wrap = appState.settings.wrapLines;
    view?.dispatch({ effects: wrapping.reconfigure(wrapExtension(wrap)) });
  });

  onCleanup(() => {
    if (view) {
      buffers.set(props.path, {
        state: view.state,
        scroll: view.scrollSnapshot(),
      });
      view.destroy();
    }
    setCursor(null);
  });

  return <div ref={host} class="cm-host editor-host" />;
}
