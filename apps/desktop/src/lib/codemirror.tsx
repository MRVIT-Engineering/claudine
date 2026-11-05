import { rust, rustLanguage } from "@codemirror/lang-rust";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";
import type { JSX } from "solid-js";

// CodeMirror adds a <style> tag to a normal document, which `style-src 'self'`
// blocks. In a shadow root it uses constructable stylesheets instead, which the
// CSP allows. Every editor must mount through this, with this `root`.
export function createEditorRoot(host: HTMLElement): ShadowRoot {
  return host.attachShadow({ mode: "open" });
}

const tokenHighlighter = tagHighlighter([
  { tag: tags.comment, class: "tk-comment" },
  { tag: tags.string, class: "tk-string" },
  { tag: tags.meta, class: "tk-attr" },
  { tag: tags.keyword, class: "tk-keyword" },
  { tag: [tags.typeName, tags.className], class: "tk-type" },
  { tag: tags.macroName, class: "tk-macro" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.function(tags.variableName)),
    ],
    class: "tk-call",
  },
  { tag: tags.number, class: "tk-number" },
]);

const theme = EditorView.theme({
  "&": {
    flex: "1",
    minWidth: "0",
    height: "100%",
    color: "var(--text)",
    backgroundColor: "transparent",
    fontVariantLigatures: "inherit",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-code)",
    fontSize: "var(--code-size)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--text)", padding: "0" },
  ".cm-gutters": {
    backgroundColor: "var(--bg)",
    color: "var(--muted)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3em",
    padding: "0 0.8em 0 0",
  },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--selected)",
    outline: "1px solid var(--line-strong)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--accent-soft)",
    outline: "1px solid var(--accent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-ink)",
  },
  ".cm-panels": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
  ".cm-panel.cm-search": { padding: "6px 8px" },
  ".cm-panel.cm-search label": { fontSize: "12px" },
  ".cm-textfield": {
    border: "1px solid var(--line-strong)",
    borderRadius: "5px",
    backgroundColor: "var(--field)",
    color: "var(--text)",
    fontSize: "12px",
    padding: "3px 7px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--field)",
    border: "1px solid var(--line-strong)",
    borderRadius: "5px",
    color: "var(--text)",
    fontSize: "12px",
    padding: "3px 8px",
  },
  ".cm-button:active": { backgroundImage: "none" },
  ".tk-comment": { color: "var(--tk-comment)", fontStyle: "italic" },
  ".tk-string": { color: "var(--tk-string)" },
  ".tk-attr": { color: "var(--tk-attr)" },
  ".tk-keyword": { color: "var(--tk-keyword)" },
  ".tk-type": { color: "var(--tk-type)" },
  ".tk-macro": { color: "var(--tk-macro)" },
  ".tk-call": { color: "var(--tk-call)" },
  ".tk-number": { color: "var(--tk-number)" },

  // Hunk colors come from our own hunks, not CodeMirror's character diff.
  ".cm-changedLine": { backgroundColor: "transparent !important" },
  ".cm-line.cm-hunk-del": { backgroundColor: "var(--del-bg) !important" },
  ".cm-line.cm-hunk-add": { backgroundColor: "var(--add-bg) !important" },
  ".cm-gutter-del": {
    backgroundColor: "var(--del-gutter)",
    color: "var(--del-ink)",
  },
  ".cm-gutter-add": {
    backgroundColor: "var(--add-gutter)",
    color: "var(--add-ink)",
  },
  ".cm-sign-gutter .cm-gutterElement": { width: "1.3em", userSelect: "none" },
  ".cm-hunk-decided": { opacity: "0.55" },
  ".cm-hunk-space": { display: "block" },
  ".cm-mergeSpacer": {
    background:
      "repeating-linear-gradient(-45deg, var(--hatch) 0 4px, transparent 4px 9px)",
  },
  "&.cm-merge-a": { borderRight: "1px solid var(--line)" },
  ".cm-deletedChunk": { backgroundColor: "var(--del-bg)", paddingLeft: "4px" },
  ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": {
    backgroundColor: "transparent",
    textDecoration: "none",
  },
});

export const sharedExtensions: Extension = [
  theme,
  syntaxHighlighting(tokenHighlighter),
];

export function languageFor(path: string): Extension {
  return path.endsWith(".rs") ? rust() : [];
}

export function languageName(path: string): string {
  if (path.endsWith(".rs")) return "Rust";
  if (path.endsWith(".toml")) return "TOML";
  if (path.endsWith(".md")) return "Markdown";
  return "Plain text";
}

// Syntax colors for code shown outside an editor, using the same parser and classes.
export function highlight(line: string): JSX.Element {
  const parts: JSX.Element[] = [];
  highlightCode(
    line,
    rustLanguage.parser.parse(line),
    tokenHighlighter,
    (text, classes) => {
      parts.push(classes ? <span class={classes}>{text}</span> : text);
    },
    () => {},
  );
  return parts;
}
