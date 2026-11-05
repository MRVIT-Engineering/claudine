import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completeFromList,
  ifNotIn,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { selectLine } from "@codemirror/commands";
import { codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
import { search } from "@codemirror/search";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import {
  crosshairCursor,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import {
  createFindPanel,
  openFind,
  openReplacePanel,
} from "../components/FindPanel";

const NOT_CODE = ["String", "RawString", "Char", "LineComment", "BlockComment"];

const RUST_KEYWORDS = [
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
].map((label): Completion => ({ label, type: "keyword" }));

const RUST_NAMES = [
  ["Option", "type"],
  ["Some", "enum"],
  ["None", "enum"],
  ["Result", "type"],
  ["Ok", "enum"],
  ["Err", "enum"],
  ["String", "type"],
  ["Vec", "type"],
  ["Box", "type"],
  ["HashMap", "type"],
  ["Arc", "type"],
  ["Mutex", "type"],
].map(([label, type]): Completion => ({ label: label ?? "", type }));

const RUST_SNIPPETS: Completion[] = [
  ["fn #{name}(#{}) {\n\t#{}\n}", "fn", "function"],
  ["pub fn #{name}(#{}) -> #{Type} {\n\t#{}\n}", "pub fn", "public function"],
  ["struct #{Name} {\n\t#{field}: #{Type},\n}", "struct", "struct"],
  ["enum #{Name} {\n\t#{Variant},\n}", "enum", "enum"],
  ["impl #{Type} {\n\t#{}\n}", "impl", "impl block"],
  ["impl #{Trait} for #{Type} {\n\t#{}\n}", "impl for", "trait impl"],
  ["match #{value} {\n\t#{pattern} => #{},\n}", "match", "match"],
  ["if let #{Some(x)} = #{value} {\n\t#{}\n}", "if let", "if let"],
  ["for #{item} in #{items} {\n\t#{}\n}", "for", "for loop"],
  ["while let #{Some(x)} = #{value} {\n\t#{}\n}", "while let", "while let"],
  ["#[test]\nfn #{name}() {\n\t#{}\n}", "test", "test function"],
  [
    "#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#{}\n}",
    "mod tests",
    "test module",
  ],
  ["#[derive(#{Debug})]", "derive", "derive attribute"],
  ['println!("#{}");', "println!", "print line"],
  ['eprintln!("#{}");', "eprintln!", "print to stderr"],
  ['format!("#{}")', "format!", "format string"],
  ["vec![#{}]", "vec!", "vector"],
  ["assert_eq!(#{left}, #{right});", "assert_eq!", "assert equal"],
].map(([template, label, detail]) =>
  snippetCompletion(template ?? "", {
    label: label ?? "",
    detail,
    type: "snippet",
    // Ranks `println!` above the plain word `println` found in the file.
    boost: 1,
  }),
);

const WORD = /[A-Za-z_][A-Za-z0-9_]{2,}/g;

/** Words from other files, like VS Code's word-based suggestions. */
function otherFileWords(
  currentPath: string,
  texts: () => Map<string, string>,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const here = new Set(context.state.doc.toString().match(WORD) ?? []);
    const found = new Set<string>();
    for (const [path, text] of texts()) {
      if (path === currentPath) continue;
      for (const match of text.match(WORD) ?? []) {
        if (!here.has(match)) found.add(match);
      }
    }
    return {
      from: word.from,
      options: [...found].map((label) => ({
        label,
        type: "text",
        detail: "other file",
        boost: -1,
      })),
      validFor: /^\w*$/,
    };
  };
}

export function completionSources(
  path: string,
  texts: () => Map<string, string>,
): CompletionSource[] {
  const words = [completeAnyWord, otherFileWords(path, texts)];
  if (!path.endsWith(".rs")) return words;
  return [
    ifNotIn(
      NOT_CODE,
      completeFromList([...RUST_SNIPPETS, ...RUST_KEYWORDS, ...RUST_NAMES]),
    ),
    ...words,
  ];
}

export function assistExtensions(
  options: { suggest: boolean; brackets: boolean },
  sources: CompletionSource[],
): Extension {
  return [
    autocompletion({
      override: sources,
      activateOnTyping: options.suggest,
      icons: true,
    }),
    options.brackets ? closeBrackets() : [],
  ];
}

/** Editing behavior from VS Code that CodeMirror doesn't turn on by default. */
export const editingExtensions: Extension = [
  EditorState.allowMultipleSelections.of(true),
  // Alt+click adds a cursor, and Shift+Alt+drag makes a column selection.
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
  crosshairCursor({ key: "Alt" }),
  highlightSpecialChars(),
  dropCursor(),
  codeFolding({ placeholderText: "⋯" }),
  foldGutter({ openText: "⌄", closedText: "›" }),
  search({ top: true, createPanel: createFindPanel }),
  // Ahead of CodeMirror's own Cmd+F binding in `searchKeymap`.
  Prec.high(keymap.of([{ key: "Mod-f", run: openFind, preventDefault: true }])),
  keymap.of([
    ...closeBracketsKeymap,
    ...foldKeymap,
    { key: "Mod-l", run: selectLine, preventDefault: true },
    { key: "Mod-Alt-f", run: openReplacePanel, preventDefault: true },
  ]),
];
