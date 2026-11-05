import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
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
import { setActiveEditor } from "../lib/activeEditor";
import { buffers } from "../lib/buffers";
import {
  createEditorRoot,
  languageFor,
  sharedExtensions,
} from "../lib/codemirror";
import {
  assistExtensions,
  completionSources,
  editingExtensions,
} from "../lib/editorFeatures";
import {
  state as appState,
  type CursorInfo,
  projectTexts,
  reveal,
  setCursor,
  setDirty,
  setReveal,
} from "../state/store";

const wrapping = new Compartment();
const assist = new Compartment();
const wrapExtension = (wrap: boolean) => (wrap ? EditorView.lineWrapping : []);
const assistFor = (path: string) =>
  assistExtensions(
    {
      suggest: appState.settings.suggestOnType,
      brackets: appState.settings.closeBrackets,
    },
    completionSources(path, projectTexts),
  );

function cursorInfo(editorState: EditorState): CursorInfo {
  const ranges = editorState.selection.ranges;
  const head = editorState.selection.main.head;
  const line = editorState.doc.lineAt(head);
  return {
    line: line.number,
    column: head - line.from + 1,
    selections: ranges.length,
    selected: ranges.reduce((sum, range) => sum + range.to - range.from, 0),
  };
}

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
      editingExtensions,
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      assist.of(assistFor(path)),
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
          setCursor(cursorInfo(update.state));
        }
        if (update.focusChanged && update.view.hasFocus) {
          setActiveEditor(update.view);
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
    setActiveEditor(editor);
    setCursor(cursorInfo(editor.state));
  });

  createEffect(() => {
    const target = reveal();
    if (!target || !view || target.path !== props.path) return;
    setReveal(null);
    const line = view.state.doc.line(
      Math.min(target.line, view.state.doc.lines),
    );
    view.dispatch({
      selection: {
        anchor: line.from + target.start,
        head: line.from + target.end,
      },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  });

  createEffect(() => {
    const wrap = appState.settings.wrapLines;
    view?.dispatch({ effects: wrapping.reconfigure(wrapExtension(wrap)) });
  });

  createEffect(() => {
    appState.settings.suggestOnType;
    appState.settings.closeBrackets;
    view?.dispatch({ effects: assist.reconfigure(assistFor(props.path)) });
  });

  onCleanup(() => {
    if (view) {
      buffers.set(props.path, {
        state: view.state,
        scroll: view.scrollSnapshot(),
      });
      setActiveEditor((current) => (current === view ? null : current));
      view.destroy();
    }
    setCursor(null);
  });

  return <div ref={host} class="cm-host editor-host" />;
}
