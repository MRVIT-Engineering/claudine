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
  // Completion popup.
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    border: "1px solid var(--line-strong)",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-code)",
    fontSize: "var(--code-size)",
    maxHeight: "16em",
    padding: "3px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "1px 8px 1px 4px",
    borderRadius: "4px",
    lineHeight: "1.6",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--selection)",
    color: "var(--text)",
  },
  ".cm-completionLabel": { color: "var(--text)" },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--accent)",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    marginLeft: "1.2em",
    color: "var(--muted)",
    fontStyle: "normal",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
  },
  ".cm-completionIcon": { width: "1.4em", opacity: "0.9" },
  ".cm-completionIcon-keyword, .cm-completionIcon-snippet": {
    color: "var(--tk-keyword)",
  },
  ".cm-completionIcon-type, .cm-completionIcon-enum": {
    color: "var(--tk-type)",
  },
  ".cm-completionIcon-text": { color: "var(--muted)" },
  ".cm-snippetField": {
    backgroundColor: "var(--accent-soft)",
    outline: "1px solid var(--accent)",
  },
  ".cm-snippetFieldPosition": { borderLeft: "1px solid var(--accent)" },

  // Folding.
  ".cm-foldGutter .cm-gutterElement": {
    width: "1.1em",
    textAlign: "center",
    color: "var(--muted)",
    cursor: "pointer",
  },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--text)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--selected)",
    border: "1px solid var(--line-strong)",
    color: "var(--text-2)",
    borderRadius: "4px",
    padding: "0 5px",
    margin: "0 3px",
  },
  ".cm-specialChar": { color: "var(--red)" },

  // Find widget (components/FindPanel.tsx).
  // Floats over the code at the top right, like VS Code, instead of pushing it down.
  ".cm-panels.cm-panels-top": {
    backgroundColor: "transparent",
    border: "none",
    zIndex: "320",
  },
  ".cm-panel.cm-find": {
    position: "absolute",
    top: "6px",
    right: "14px",
    width: "min(460px, calc(100% - 28px))",
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    padding: "6px 8px",
    border: "1px solid var(--line-strong)",
    borderRadius: "7px",
    backgroundColor: "var(--panel)",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
  },
  // In a diff, stay below the sticky Original/Proposed headings.
  "&.cm-review .cm-panel.cm-find": { top: "34px" },
  ".cm-find-row": { display: "flex", alignItems: "center", gap: "4px" },
  ".cm-find-toggle-replace, .cm-find-spacer": {
    width: "20px",
    flex: "none",
  },
  ".cm-find-toggle-replace": {
    height: "24px",
    border: "none",
    borderRadius: "4px",
    background: "none",
    color: "var(--muted)",
    cursor: "pointer",
  },
  ".cm-find-field": {
    display: "flex",
    alignItems: "center",
    flex: "1",
    minWidth: "0",
    height: "26px",
    padding: "0 3px 0 0",
    border: "1px solid var(--line-strong)",
    borderRadius: "5px",
    backgroundColor: "var(--field)",
  },
  ".cm-find-field:focus-within": { borderColor: "var(--accent)" },
  ".cm-find-input": {
    flex: "1",
    minWidth: "0",
    height: "100%",
    padding: "0 8px",
    border: "none",
    outline: "none",
    background: "none",
    color: "var(--text)",
    font: "12px var(--font-ui)",
  },
  ".cm-find-input::placeholder": { color: "var(--muted)" },
  ".cm-find-option": {
    height: "20px",
    minWidth: "22px",
    padding: "0 3px",
    border: "1px solid transparent",
    borderRadius: "3px",
    background: "none",
    color: "var(--muted)",
    font: "600 11px var(--font-code)",
    cursor: "pointer",
  },
  ".cm-find-option.on": {
    color: "var(--accent)",
    borderColor: "var(--accent)",
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-find-count": {
    minWidth: "88px",
    padding: "0 6px",
    color: "var(--text-2)",
    font: "12px var(--font-ui)",
    whiteSpace: "nowrap",
  },
  ".cm-find-count.empty": { color: "var(--red)" },
  ".cm-find-button, .cm-find-text-button": {
    height: "24px",
    border: "none",
    borderRadius: "4px",
    background: "none",
    color: "var(--text-2)",
    font: "13px var(--font-ui)",
    cursor: "pointer",
  },
  ".cm-find-button": { width: "24px" },
  ".cm-find-text-button": { padding: "0 8px", fontSize: "12px" },
  ".cm-find-button:hover, .cm-find-text-button:hover, .cm-find-toggle-replace:hover, .cm-find-option:hover":
    { backgroundColor: "var(--hover)", color: "var(--text)" },

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
