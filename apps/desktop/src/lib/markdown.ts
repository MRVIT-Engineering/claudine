// A small Markdown parser for the preview. It builds a tree that MarkdownPreview turns
// into DOM nodes; nothing is ever inserted as HTML, so a file can't run script or load
// anything. It covers common CommonMark and GitHub syntax, not every edge case.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; src: string; alt: string }
  | { kind: "break" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** `null` unless it's a task item: `- [ ]` or `- [x]`. */
  checked: boolean | null;
  children: Block[];
}

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  /** Raw HTML, shown as text: the preview never renders it. */
  | { kind: "html"; text: string }
  | { kind: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const INDENTED = /^(?: {4}|\t)/;
const HTML = /^ {0,3}(?:<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?\/?>|<!--)/;
const TABLE_SEP =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function parseMarkdown(text: string): Block[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
  return parseBlocks(lines);
}

/** A line that ends a paragraph without a blank line before it. */
function startsBlock(line: string): boolean {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line)) return true;
  if (QUOTE.test(line) || HTML.test(line)) return true;
  const item = ITEM.exec(line);
  // Only a list starting at 1 can interrupt a paragraph, so "2019. was a year" can't.
  return (
    !!item &&
    (item[4] ?? "") !== "" &&
    (!/\d/.test(item[2] ?? "") || /^1\D/.test(item[2] ?? ""))
  );
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "";
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i] ?? "", marker)) {
        body.push((lines[i] ?? "").replace(new RegExp(`^ {0,${indent}}`), ""));
        i++;
      }
      i++;
      blocks.push({
        kind: "code",
        lang: fence[2] ?? "",
        text: body.join("\n"),
      });
      continue;
    }

    if (INDENTED.test(line)) {
      const body: string[] = [];
      while (
        i < lines.length &&
        (INDENTED.test(lines[i] ?? "") || !(lines[i] ?? "").trim())
      ) {
        body.push((lines[i] ?? "").replace(INDENTED, ""));
        i++;
      }
      while (body.length && !(body[body.length - 1] ?? "").trim()) body.pop();
      blocks.push({ kind: "code", lang: "", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "").length,
        children: parseInline(heading[2] ?? ""),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        inner.push((lines[i] ?? "").replace(QUOTE, ""));
        i++;
      }
      blocks.push({ kind: "quote", children: parseBlocks(inner) });
      continue;
    }

    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      const [table, next] = parseTable(lines, i);
      blocks.push(table);
      i = next;
      continue;
    }

    if (HTML.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim()) {
        body.push(lines[i] ?? "");
        i++;
      }
      blocks.push({ kind: "html", text: body.join("\n") });
      continue;
    }

    const body: string[] = [line];
    i++;
    let level = 0;
    while (i < lines.length && (lines[i] ?? "").trim()) {
      const setext = SETEXT.exec(lines[i] ?? "");
      if (setext) {
        level = (setext[1] ?? "").startsWith("=") ? 1 : 2;
        i++;
        break;
      }
      if (startsBlock(lines[i] ?? "")) break;
      body.push(lines[i] ?? "");
      i++;
    }
    const children = parseInline(body.map((l) => l.trimStart()).join("\n"));
    blocks.push(
      level
        ? { kind: "heading", level, children }
        : { kind: "paragraph", children },
    );
  }
  return blocks;
}

function closesFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= marker.length &&
    trimmed === (marker[0] ?? "").repeat(trimmed.length) &&
    line.length - line.trimStart().length < 4
  );
}

function parseList(lines: string[], start: number): [Block, number] {
  const first = ITEM.exec(lines[start] ?? "");
  if (!first) return [{ kind: "paragraph", children: [] }, start + 1];
  const ordered = /\d/.test(first[2] ?? "");
  // The marker's last character: `-`, `*`, `+`, `.` or `)`. A different one starts a new list.
  const kind = (first[2] ?? "").slice(-1);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const item = ITEM.exec(lines[i] ?? "");
    if (!item || (item[2] ?? "").slice(-1) !== kind) break;
    const contentIndent =
      (item[1] ?? "").length +
      (item[2] ?? "").length +
      Math.max((item[3] ?? "").length, 1);
    const body: string[] = [item[4] ?? ""];
    i++;
    let blank = false;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      if (!line.trim()) {
        blank = true;
        body.push("");
        i++;
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent >= contentIndent) {
        body.push(line.slice(contentIndent));
      } else if (!blank && !startsBlock(line) && !ITEM.test(line)) {
        // A lazy continuation of the item's paragraph.
        body.push(line.trimStart());
      } else {
        break;
      }
      blank = false;
      i++;
    }
    let checked: boolean | null = null;
    const task = /^\[([ xX])\][ \t]+/.exec(body[0] ?? "");
    if (task) {
      checked = (task[1] ?? "") !== " ";
      body[0] = (body[0] ?? "").slice((task[0] ?? "").length);
    }
    items.push({ checked, children: parseBlocks(body) });
    // A blank line followed by something that isn't an item ends the list.
    if (blank && !ITEM.test(lines[i] ?? "")) break;
  }
  const startNumber = ordered ? Number.parseInt(first[2] ?? "", 10) : 1;
  return [{ kind: "list", ordered, start: startNumber, items }, i];
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseTable(lines: string[], start: number): [Block, number] {
  const head = splitRow(lines[start] ?? "");
  const align: Align[] = splitRow(lines[start + 1] ?? "").map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
  const width = head.length;
  const fit = (cells: string[]) =>
    Array.from({ length: width }, (_, n) => parseInline(cells[n] ?? ""));
  const rows: Inline[][][] = [];
  let i = start + 2;
  while (
    i < lines.length &&
    (lines[i] ?? "").trim() &&
    !startsBlock(lines[i] ?? "")
  ) {
    rows.push(fit(splitRow(lines[i] ?? "")));
    i++;
  }
  return [
    { kind: "table", align: align.slice(0, width), head: fit(head), rows },
    i,
  ];
}

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";

    if (c === "\\" && i + 1 < text.length) {
      const next = text[i + 1] ?? "";
      if (next === "\n") {
        flush();
        out.push({ kind: "break" });
        i += 2;
        continue;
      }
      if (ESCAPABLE.test(next)) {
        buffer += next;
        i += 2;
        continue;
      }
    }

    if (c === "\n") {
      // Two trailing spaces make a line break; otherwise a newline is a space.
      const hard = / {2,}$/.test(buffer);
      buffer = buffer.replace(/ +$/, "");
      if (hard) {
        flush();
        out.push({ kind: "break" });
      } else {
        buffer += " ";
      }
      i++;
      continue;
    }

    if (c === "`") {
      const run = /^`+/.exec(text.slice(i))?.[0] ?? "`";
      const close = findCodeClose(text, i + run.length, run);
      if (close >= 0) {
        flush();
        let code = text.slice(i + run.length, close).replace(/\n/g, " ");
        if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
        out.push({ kind: "code", text: code });
        i = close + run.length;
      } else {
        buffer += run;
        i += run.length;
      }
      continue;
    }

    if (c === "!" && (text[i + 1] ?? "") === "[") {
      const link = parseLinkAt(text, i + 1);
      if (link) {
        flush();
        out.push({
          kind: "image",
          src: link.href,
          alt: plainText(parseInline(link.label)),
        });
        i = link.end;
        continue;
      }
    }

    if (c === "[") {
      const link = parseLinkAt(text, i);
      if (link) {
        flush();
        out.push({
          kind: "link",
          href: link.href,
          children: parseInline(link.label),
        });
        i = link.end;
        continue;
      }
    }

    if (c === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(text.slice(i));
      if (auto) {
        flush();
        out.push({
          kind: "link",
          href: auto[1] ?? "",
          children: [{ kind: "text", text: auto[1] ?? "" }],
        });
        i += (auto[0] ?? "").length;
        continue;
      }
    }

    if (c === "*" || c === "_" || c === "~") {
      const run = new RegExp(`^\\${c}+`).exec(text.slice(i))?.[0] ?? c;
      const opened = openEmphasis(text, i, run);
      if (opened) {
        flush();
        out.push(opened.node);
        i = opened.end;
      } else {
        buffer += run;
        i += run.length;
      }
      continue;
    }

    buffer += c;
    i++;
  }
  flush();
  return out;
}

function findCodeClose(text: string, from: number, run: string): number {
  let k = text.indexOf(run, from);
  while (k >= 0) {
    if ((text[k + run.length] ?? "") !== "`" && (text[k - 1] ?? "") !== "`")
      return k;
    k = text.indexOf(run, k + 1);
  }
  return -1;
}

function openEmphasis(
  text: string,
  i: number,
  run: string,
): { node: Inline; end: number } | null {
  const c = run[0] ?? "";
  const after = text[i + run.length] ?? "";
  if (after === undefined || /\s/.test(after)) return null;
  // `snake_case_names` stay as they are.
  if (c === "_" && i > 0 && WORD.test(text[i - 1] ?? "")) return null;
  const sizes = c === "~" ? [2] : run.length >= 2 ? [2, 1] : [1];
  for (const size of sizes) {
    if (run.length < size) continue;
    const delimiter = c.repeat(size);
    const close = findEmphasisClose(text, i + size, delimiter);
    if (close < 0) continue;
    const kind = c === "~" ? "del" : size === 2 ? "strong" : "em";
    return {
      node: { kind, children: parseInline(text.slice(i + size, close)) },
      end: close + size,
    };
  }
  return null;
}

function findEmphasisClose(
  text: string,
  from: number,
  delimiter: string,
): number {
  const c = delimiter[0] ?? "";
  let k = text.indexOf(delimiter, from);
  while (k >= 0) {
    let end = k;
    while ((text[end] ?? "") === c) end++;
    const runLength = end - k;
    const closable =
      k > from &&
      !/\s/.test(text[k - 1] ?? "") &&
      // A single `*` doesn't close on a `**`.
      (delimiter.length > 1 || runLength !== 2) &&
      (c !== "_" || !WORD.test(text[end] ?? ""));
    // In `***`, the closer is the end of the run.
    if (closable) return end - delimiter.length;
    k = text.indexOf(delimiter, end);
  }
  return -1;
}

function parseLinkAt(
  text: string,
  i: number,
): { label: string; href: string; end: number } | null {
  let depth = 0;
  let j = i;
  for (; j < text.length; j++) {
    const ch = text[j] ?? "";
    if (ch === "\\") {
      j++;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || (text[j + 1] ?? "") !== "(") return null;
  const target =
    /^\([ \t]*(<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*\)/.exec(
      text.slice(j + 1),
    );
  if (!target) return null;
  let href = target[1] ?? "";
  if (href.startsWith("<")) href = href.slice(1, -1);
  return {
    label: text.slice(i + 1, j),
    href,
    end: j + 1 + (target[0] ?? "").length,
  };
}

export function plainText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.text;
        case "image":
          return node.alt;
        case "break":
          return " ";
        default:
          return plainText(node.children);
      }
    })
    .join("");
}
