// Which icon a file gets, from its name. Exact names win over patterns, which win over
// the extension. Colors are each language's usual one; the icons are drawn here, not
// copied logos.

/** A picture instead of letters, drawn in components/FileTypeIcon.tsx. */
export type Glyph =
  | "node"
  | "git"
  | "key"
  | "gear"
  | "lock"
  | "image"
  | "atom"
  | "database"
  | "archive"
  | "lines"
  | "info"
  | "box"
  | "terminal"
  | "code";

export type FileType =
  /** Letters on a colored badge. `dark` text for light badges. */
  | { kind: "badge"; label: string; color: string; dark?: boolean }
  | { kind: "glyph"; glyph: Glyph; color: string };

const badge = (label: string, color: string, dark = false): FileType => ({
  kind: "badge",
  label,
  color,
  dark,
});
const glyph = (name: Glyph, color: string): FileType => ({
  kind: "glyph",
  glyph: name,
  color,
});

const NODE = glyph("node", "#8cc84b");
const TS = badge("TS", "#3178c6");
const JS = badge("JS", "#f1e05a", true);
const REACT = glyph("atom", "#61dafb");
const RUST = badge("RS", "#dea584", true);
const PYTHON = badge("PY", "#3572a5");
const GO = badge("GO", "#00add8");
const RUBY = badge("RB", "#cc342d");
const PHP = badge("PHP", "#777bb4");
const DOCKER = glyph("box", "#2496ed");
const GIT = glyph("git", "#f05033");
const CONFIG = glyph("gear", "#8c9aa8");
const LOCK = glyph("lock", "#8c9aa8");
const TEXT = glyph("lines", "#8c9aa8");
const IMAGE = glyph("image", "#26a69a");
const MARKDOWN = badge("MD", "#519aba");
const JSON_FILE = badge("{}", "#e8b84a", true);
const SHELL = glyph("terminal", "#89e051");

const NAMES: Record<string, FileType> = {
  "package.json": NODE,
  "package-lock.json": NODE,
  "npm-shrinkwrap.json": NODE,
  ".npmrc": NODE,
  ".nvmrc": NODE,
  ".node-version": NODE,
  "yarn.lock": badge("Y", "#2c8ebb"),
  ".yarnrc": badge("Y", "#2c8ebb"),
  ".yarnrc.yml": badge("Y", "#2c8ebb"),
  "pnpm-lock.yaml": badge("PN", "#f69220", true),
  "pnpm-workspace.yaml": badge("PN", "#f69220", true),
  "bun.lock": badge("BUN", "#fbf0df", true),
  "bun.lockb": badge("BUN", "#fbf0df", true),
  "deno.json": badge("DN", "#70ffaf", true),
  "deno.jsonc": badge("DN", "#70ffaf", true),
  "cargo.toml": RUST,
  "cargo.lock": RUST,
  "rust-toolchain": RUST,
  "rust-toolchain.toml": RUST,
  "go.mod": GO,
  "go.sum": GO,
  "go.work": GO,
  "pyproject.toml": PYTHON,
  pipfile: PYTHON,
  "pipfile.lock": PYTHON,
  "poetry.lock": PYTHON,
  "uv.lock": PYTHON,
  "setup.py": PYTHON,
  "setup.cfg": PYTHON,
  ".python-version": PYTHON,
  gemfile: RUBY,
  "gemfile.lock": RUBY,
  rakefile: RUBY,
  "composer.json": PHP,
  "composer.lock": PHP,
  dockerfile: DOCKER,
  containerfile: DOCKER,
  ".dockerignore": DOCKER,
  "compose.yml": DOCKER,
  "compose.yaml": DOCKER,
  ".gitignore": GIT,
  ".gitattributes": GIT,
  ".gitmodules": GIT,
  ".gitkeep": GIT,
  ".mailmap": GIT,
  ".editorconfig": CONFIG,
  makefile: badge("MK", "#6d8086"),
  gnumakefile: badge("MK", "#6d8086"),
  "cmakelists.txt": badge("CM", "#064f8c"),
  license: glyph("lines", "#e8b84a"),
  licence: glyph("lines", "#e8b84a"),
  copying: glyph("lines", "#e8b84a"),
  "claude.md": badge("C", "#d97757"),
  "biome.json": glyph("gear", "#60a5fa"),
  "biome.jsonc": glyph("gear", "#60a5fa"),
  "deny.toml": CONFIG,
  "rustfmt.toml": CONFIG,
  ".rustfmt.toml": CONFIG,
  "clippy.toml": CONFIG,
  ".prettierrc": glyph("gear", "#f7b93e"),
  ".prettierignore": glyph("gear", "#f7b93e"),
  ".eslintignore": glyph("gear", "#8080f2"),
};

/** Checked in order, after exact names. */
const PATTERNS: [RegExp, FileType][] = [
  [/^readme(\..*)?$/, glyph("info", "#519aba")],
  [/^(license|licence|copying)\..*$/, glyph("lines", "#e8b84a")],
  [/^\.env(\..*)?$/, glyph("key", "#e8b84a")],
  [/^(docker-)?compose\..*\.ya?ml$|^docker-compose\.ya?ml$/, DOCKER],
  [/\.dockerfile$|^dockerfile\..*$/, DOCKER],
  [/^[tj]sconfig(\..*)?\.json$/, TS],
  [/^\.prettierrc\..*$|^prettier\.config\..*$/, glyph("gear", "#f7b93e")],
  [/^\.eslintrc(\..*)?$|^eslint\.config\..*$/, glyph("gear", "#8080f2")],
  [/^vite\.config\..*$|^vitest\.config\..*$/, glyph("gear", "#f0c476")],
  [/^(tauri|tauri\..*)\.conf\.json$/, glyph("gear", "#24c8db")],
  [/^requirements.*\.txt$/, PYTHON],
  [/\.d\.[mc]?ts$/, TS],
];

const EXTENSIONS: Record<string, FileType> = {
  ts: TS,
  mts: TS,
  cts: TS,
  tsx: REACT,
  jsx: REACT,
  js: JS,
  mjs: JS,
  cjs: JS,
  rs: RUST,
  py: PYTHON,
  pyi: PYTHON,
  pyw: PYTHON,
  ipynb: badge("NB", "#f37626"),
  go: GO,
  java: badge("JV", "#b07219"),
  class: badge("JV", "#b07219"),
  jar: badge("JV", "#b07219"),
  kt: badge("KT", "#a97bff"),
  kts: badge("KT", "#a97bff"),
  scala: badge("SC", "#c22d40"),
  swift: badge("SW", "#f05138"),
  c: badge("C", "#a8b9cc", true),
  h: badge("H", "#a8b9cc", true),
  cpp: badge("C++", "#f34b7d"),
  cc: badge("C++", "#f34b7d"),
  cxx: badge("C++", "#f34b7d"),
  hpp: badge("H++", "#f34b7d"),
  hh: badge("H++", "#f34b7d"),
  cs: badge("C#", "#178600"),
  fs: badge("F#", "#378bba"),
  m: badge("OC", "#438eff"),
  rb: RUBY,
  php: PHP,
  lua: badge("LUA", "#51a0cf"),
  dart: badge("DT", "#00b4ab"),
  ex: badge("EX", "#6e4a7e"),
  exs: badge("EX", "#6e4a7e"),
  erl: badge("ER", "#b83998"),
  hs: badge("HS", "#5e5086"),
  ml: badge("ML", "#ee6a1a"),
  clj: badge("CLJ", "#63b132"),
  zig: badge("ZIG", "#ec915c", true),
  nim: badge("NIM", "#ffc200", true),
  jl: badge("JL", "#9558b2"),
  r: badge("R", "#198ce7"),
  pl: badge("PL", "#0298c3"),
  sol: badge("SOL", "#6f7a8a"),
  vue: badge("V", "#41b883"),
  svelte: badge("S", "#ff3e00"),
  astro: badge("A", "#ff5d01"),
  html: glyph("code", "#e34c26"),
  htm: glyph("code", "#e34c26"),
  xml: glyph("code", "#e37933"),
  css: badge("CSS", "#2965f1"),
  scss: badge("SC", "#c6538c"),
  sass: badge("SA", "#c6538c"),
  less: badge("LS", "#1d365d"),
  json: JSON_FILE,
  jsonc: JSON_FILE,
  json5: JSON_FILE,
  yaml: badge("YML", "#cb4b4b"),
  yml: badge("YML", "#cb4b4b"),
  toml: badge("TML", "#9c4221"),
  ini: CONFIG,
  cfg: CONFIG,
  conf: CONFIG,
  properties: CONFIG,
  md: MARKDOWN,
  markdown: MARKDOWN,
  mdx: badge("MDX", "#519aba"),
  rst: TEXT,
  txt: TEXT,
  log: TEXT,
  csv: badge("CSV", "#4caf50"),
  tsv: badge("TSV", "#4caf50"),
  sql: glyph("database", "#e38c00"),
  db: glyph("database", "#e38c00"),
  sqlite: glyph("database", "#e38c00"),
  graphql: badge("GQ", "#e10098"),
  gql: badge("GQ", "#e10098"),
  proto: badge("PB", "#6f7a8a"),
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  fish: SHELL,
  ps1: glyph("terminal", "#5391fe"),
  bat: glyph("terminal", "#c1f12e"),
  tf: badge("TF", "#7b42bc"),
  hcl: badge("HCL", "#7b42bc"),
  nix: badge("NIX", "#7e7eff"),
  wasm: badge("WA", "#654ff0"),
  lock: LOCK,
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  webp: IMAGE,
  avif: IMAGE,
  bmp: IMAGE,
  ico: IMAGE,
  icns: IMAGE,
  svg: glyph("image", "#ffb13b"),
  pdf: badge("PDF", "#e5252a"),
  zip: glyph("archive", "#afb42b"),
  tar: glyph("archive", "#afb42b"),
  gz: glyph("archive", "#afb42b"),
  tgz: glyph("archive", "#afb42b"),
  xz: glyph("archive", "#afb42b"),
  "7z": glyph("archive", "#afb42b"),
  rar: glyph("archive", "#afb42b"),
  woff: badge("Aa", "#9e9e9e", true),
  woff2: badge("Aa", "#9e9e9e", true),
  ttf: badge("Aa", "#9e9e9e", true),
  otf: badge("Aa", "#9e9e9e", true),
  diff: badge("±", "#85b8ff", true),
  patch: badge("±", "#85b8ff", true),
};

/** The icon for a file name or path. `null` means the plain file icon. */
export function fileType(nameOrPath: string): FileType | null {
  const name = (nameOrPath.split("/").pop() ?? "").toLowerCase();
  const exact = NAMES[name];
  if (exact) return exact;
  for (const [pattern, type] of PATTERNS) {
    if (pattern.test(name)) return type;
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0 && !name.startsWith(".")) return null;
  return EXTENSIONS[name.slice(dot + 1)] ?? null;
}
