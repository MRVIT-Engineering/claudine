export interface SearchOptions {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface SearchMatch {
  /** 1-based line number. */
  line: number;
  /** Column range of the match in the line, 0-based. */
  start: number;
  end: number;
  /** A shortened line to show, with the match's range inside it. */
  preview: string;
  previewStart: number;
  previewEnd: number;
}

export interface FileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileResult[];
  total: number;
  truncated: boolean;
  error: string | null;
}

// Stops here so a huge project can't freeze the UI.
const MAX_MATCHES = 2_000;
// Characters kept before a match, so it stays visible in a narrow sidebar.
const PREVIEW_LEAD = 12;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preview(line: string, start: number, end: number) {
  const indent = line.length - line.trimStart().length;
  const from = Math.max(indent, start - PREVIEW_LEAD);
  const prefix = from > indent ? "…" : "";
  const text = prefix + line.slice(from);
  const shift = prefix.length - from;
  return {
    preview: text,
    previewStart: start + shift,
    previewEnd: end + shift,
  };
}

/**
 * Searches file texts the way VS Code's search view does, one line at a time.
 * Temporary: Milestone 7 replaces this with a Rust command that searches the disk.
 */
export function searchProject(
  texts: Map<string, string>,
  options: SearchOptions,
): SearchResults {
  const empty = { files: [], total: 0, truncated: false, error: null };
  if (!options.text) return empty;

  let source = options.regexp ? options.text : escapeRegExp(options.text);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, options.caseSensitive ? "g" : "gi");
  } catch {
    return { ...empty, error: "Invalid pattern" };
  }

  const files: FileResult[] = [];
  let total = 0;
  const paths = [...texts.keys()].sort();
  for (const path of paths) {
    const lines = (texts.get(path) ?? "").split("\n");
    const matches: SearchMatch[] = [];
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      for (let found = pattern.exec(line); found; found = pattern.exec(line)) {
        if (found[0] === "") {
          pattern.lastIndex += 1;
          continue;
        }
        if (total >= MAX_MATCHES) return;
        const start = found.index;
        const end = start + found[0].length;
        matches.push({
          line: index + 1,
          start,
          end,
          ...preview(line, start, end),
        });
        total += 1;
      }
    });
    if (matches.length > 0) files.push({ path, matches });
    if (total >= MAX_MATCHES) {
      return { files, total, truncated: true, error: null };
    }
  }
  return { files, total, truncated: false, error: null };
}
