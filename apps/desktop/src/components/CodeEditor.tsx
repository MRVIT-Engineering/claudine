import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
  scrollPastEnd,
} from "@codemirror/view";
import { createEffect, onCleanup, onMount } from "solid-js";
import { setActiveEditor } from "../lib/activeEditor";
import { buffers } from "../lib/buffers";
import {
  createEditorRoot,
  languageFor,
  loadLanguage,
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

import type { Settings } from "../types";

const preferences = new Compartment();
const language = new Compartment();
const assist = new Compartment();

/** Everything in Settings → Editor that changes how the editor behaves. */
function preferenceExtensions(s: Settings): Extension {
  return [
    s.lineNumbers ? lineNumbers() : [],
    s.foldGutter ? foldGutter({ openText: "⌄", closedText: "›" }) : [],
    s.highlightActiveLine
      ? [highlightActiveLine(), highlightActiveLineGutter()]
      : [],
    s.bracketMatching ? bracketMatching() : [],
    s.whitespace === "all" ? highlightWhitespace() : [],
    s.whitespace === "trailing" ? highlightTrailingWhitespace() : [],
    s.scrollPastEnd ? scrollPastEnd() : [],
    s.wrapLines ? EditorView.lineWrapping : [],
    // A blink rate of 0 keeps the cursor solid.
    drawSelection({ cursorBlinkRate: s.cursorBlinking ? 1200 : 0 }),
    EditorState.tabSize.of(s.tabSize),
    indentUnit.of(s.insertSpaces ? " ".repeat(s.tabSize) : "\t"),
  ];
}
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
      language.of(languageFor(path)),
      preferences.of(preferenceExtensions(appState.settings)),
      history(),
      indentOnInput(),
      editingExtensions,
      assist.of(assistFor(path)),
      highlightSelectionMatches(),
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
    void loadLanguage(props.path).then((extension) => {
      if (view === editor) {
        editor.dispatch({ effects: language.reconfigure(extension) });
      }
    });
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
    const extensions = preferenceExtensions(appState.settings);
    view?.dispatch({ effects: preferences.reconfigure(extensions) });
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
      view = undefined;
    }
    setCursor(null);
  });

  return <div ref={host} class="cm-host editor-host" />;
}
