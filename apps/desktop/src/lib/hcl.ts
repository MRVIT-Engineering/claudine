// HCL, the language of Terraform (.tf, .tfvars) and other HashiCorp tools. CodeMirror has
// no package for it, so this is a small stream tokenizer: comments, strings with `${}`
// interpolation, heredocs, numbers, block keywords, attribute names and function calls.
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StringStream,
} from "@codemirror/language";

/** Words that start a top-level or nested block, or are part of an expression. */
const KEYWORDS = new Set([
  "resource",
  "data",
  "variable",
  "output",
  "locals",
  "module",
  "provider",
  "terraform",
  "backend",
  "required_providers",
  "dynamic",
  "content",
  "lifecycle",
  "provisioner",
  "connection",
  "import",
  "moved",
  "removed",
  "check",
  "for",
  "in",
  "if",
]);
const ATOMS = new Set(["true", "false", "null"]);
/** The roots of references, such as `var.region` or `each.key`. */
const ROOTS = new Set([
  "var",
  "local",
  "module",
  "data",
  "each",
  "count",
  "path",
  "self",
  "terraform",
]);

interface State {
  /** Open `${` nestings inside the string being read, or -1 outside a string. */
  inString: number;
  /** Braces open inside the current interpolation. */
  depth: number[];
  /** The heredoc's closing word while inside one. */
  heredoc: string | null;
  inComment: boolean;
}

function readString(stream: StringStream, state: State): string {
  while (!stream.eol()) {
    if (stream.match("${", false) || stream.match("%{", false)) {
      // Leave the `${` for the next call, which reads it as interpolation.
      return "string";
    }
    const next = stream.next();
    if (next === "\\") {
      stream.next();
    } else if (next === '"') {
      state.inString = -1;
      return "string";
    }
  }
  return "string";
}

export const hclLanguage = StreamLanguage.define<State>({
  name: "hcl",
  startState: () => ({
    inString: -1,
    depth: [],
    heredoc: null,
    inComment: false,
  }),
  token(stream, state) {
    if (state.heredoc !== null) {
      if (
        stream.sol() &&
        stream.match(new RegExp(`^\\s*${state.heredoc}\\s*$`))
      ) {
        state.heredoc = null;
        return "string";
      }
      stream.skipToEnd();
      return "string";
    }
    if (state.inComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.inComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    // Inside a string, outside any interpolation.
    if (state.inString >= 0 && state.depth.length === state.inString) {
      if (stream.match("${") || stream.match("%{")) {
        state.depth.push(0);
        return "keyword";
      }
      return readString(stream, state);
    }

    if (stream.eatSpace()) return null;

    // Closing an interpolation returns to its string.
    if (state.inString >= 0 && stream.peek() === "}") {
      const top = state.depth.length - 1;
      if ((state.depth[top] ?? 0) === 0) {
        stream.next();
        state.depth.pop();
        return "keyword";
      }
    }

    if (stream.match("#") || stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inComment = true;
      return "comment";
    }
    const heredoc = stream.match(/^<<-?([A-Za-z_][A-Za-z0-9_]*)/);
    if (heredoc && typeof heredoc !== "boolean") {
      state.heredoc = heredoc[1] ?? null;
      return "string";
    }
    if (stream.peek() === '"') {
      stream.next();
      state.inString = state.depth.length;
      return readString(stream, state);
    }
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";

    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_-]*/);
    if (word && typeof word !== "boolean") {
      const name = word[0];
      if (ATOMS.has(name)) return "atom";
      if (stream.match(/^\s*\(/, false)) return "variableName.function";
      // `name =` is an attribute; `name {` or `name "label"` is a block.
      if (stream.match(/^\s*=(?!=)/, false)) return "propertyName";
      if (KEYWORDS.has(name) && stream.match(/^\s*("|\{|[A-Za-z_])/, false)) {
        return "keyword";
      }
      if (ROOTS.has(name) && stream.peek() === ".") return "typeName";
      if (stream.match(/^\s*\{/, false)) return "keyword";
      return "variableName";
    }

    const char = stream.next();
    if (char === "{" && state.depth.length > 0) {
      state.depth[state.depth.length - 1] = (state.depth.at(-1) ?? 0) + 1;
    } else if (char === "}" && state.depth.length > 0) {
      state.depth[state.depth.length - 1] = Math.max(
        0,
        (state.depth.at(-1) ?? 0) - 1,
      );
    }
    if (char && "{}[]()".includes(char)) return "bracket";
    if (char && "=!<>+-*/%&|?:,.".includes(char)) return "operator";
    return null;
  },
  languageData: {
    commentTokens: { line: "#", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
  },
});

/** Picked by file name, like CodeMirror's own languages. */
export const hclDescription = LanguageDescription.of({
  name: "HCL",
  alias: ["terraform", "hcl"],
  extensions: ["tf", "tfvars", "hcl", "nomad"],
  load: async () => new LanguageSupport(hclLanguage),
});
