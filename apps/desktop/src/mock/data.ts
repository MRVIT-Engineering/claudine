// Everything in this file is placeholder data. Once the Rust backend exists,
// it replaces this file and the actions in state/store.ts.
import type { Account, Segment, Session, SourceFile, TreeNode } from "../types";

export const PROJECT_PATH = "~/code/claudine";
export const BRANCH = "main";

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: "work",
    label: "Work",
    email: "work@yourco.dev",
    color: "blue",
    signedIn: true,
  },
  {
    id: "personal",
    label: "Personal",
    email: "me@hey.dev",
    color: "pink",
    signedIn: true,
  },
  {
    id: "studio",
    label: "Studio",
    email: "dev@studio.co",
    color: "violet",
    signedIn: true,
  },
];

const POOL: Segment[] = [
  {
    kind: "context",
    lines: [
      "use std::sync::Arc;",
      "use tokio::sync::{Mutex, Semaphore};",
      "",
      "pub struct SessionPool {",
    ],
  },
  {
    kind: "hunk",
    id: "h1",
    title: "Wrap sessions so each account locks on its own",
    removed: ["    sessions: Vec<Session>,"],
    added: [
      "    sessions: Vec<Arc<Mutex<Session>>>,",
      "    limit: Arc<Semaphore>,",
    ],
  },
  {
    kind: "context",
    lines: [
      "}",
      "",
      "impl SessionPool {",
      "    pub fn new(accounts: &[Account]) -> Self {",
    ],
  },
  {
    kind: "hunk",
    id: "h2",
    title: "One permit per linked account",
    removed: [
      "        let sessions = accounts.iter()",
      "            .map(Session::new).collect();",
      "        Self { sessions }",
    ],
    added: [
      "        let n = accounts.len();",
      "        let sessions = accounts",
      "            .iter()",
      "            .map(|a| Arc::new(Mutex::new(a.into())))",
      "            .collect();",
      "        let limit = Arc::new(Semaphore::new(n));",
      "        Self { sessions, limit }",
    ],
  },
  {
    kind: "context",
    lines: [
      "    }",
      "",
      "    pub fn len(&self) -> usize {",
      "        self.sessions.len()",
      "    }",
      "}",
    ],
  },
];

const CONFIG: Segment[] = [
  {
    kind: "context",
    lines: [
      "use crate::error::Result;",
      "use std::{fs, path::Path};",
      "",
      "pub fn load(path: &Path) -> Result<Config> {",
    ],
  },
  {
    kind: "hunk",
    id: "h1",
    title: "Read config as TOML instead of JSON",
    removed: [
      '    let raw = fs::read("config.json")?;',
      "    let cfg = serde_json::from_slice(&raw)?;",
    ],
    added: [
      "    let raw = fs::read_to_string(path)?;",
      "    let cfg: Config = toml::from_str(&raw)?;",
      "    cfg.validate()?;",
      '    tracing::debug!(?cfg, "loaded config");',
    ],
  },
  { kind: "context", lines: ["    Ok(cfg)", "}"] },
];

const DIFF_SPEC_LINES = [
  "#[test]",
  "fn renders_hunk_header() {",
  "    let d = Diff::parse(FIXTURE);",
  "    assert_eq!(d.hunks.len(), 2);",
  '    assert_eq!(d.hunks[0].header(), "@@ -5,1 +5,2 @@");',
  "}",
  "",
  "#[test]",
  "fn pads_shorter_side_with_blank_rows() {",
  "    let d = Diff::parse(FIXTURE);",
  "    let rows = d.side_by_side();",
  "    assert_eq!(rows[0].left, Some(5));",
  "    assert_eq!(rows[1].left, None);",
  "}",
  "",
  'const FIXTURE: &str = include_str!("fixtures/pool.diff");',
  "",
  "// More cases are still being written.",
];

export const FILES: Record<string, SourceFile> = {
  "src/session/pool.rs": {
    path: "src/session/pool.rs",
    name: "pool.rs",
    segments: POOL,
    preview: [
      { type: "del", text: "    sessions: Vec<Session>," },
      { type: "add", text: "    sessions: Vec<Arc<Mutex<Session>>>," },
      { type: "add", text: "    limit: Arc<Semaphore>," },
      { type: "ctx", text: "}" },
    ],
  },
  "src/session/account.rs": {
    path: "src/session/account.rs",
    name: "account.rs",
    lines: [
      "use std::path::PathBuf;",
      "",
      "pub struct Account {",
      "    pub label: String,",
      "    pub config_dir: PathBuf,",
      "}",
    ],
  },
  "src/diff/render.rs": {
    path: "src/diff/render.rs",
    name: "render.rs",
    lines: [
      "use super::Diff;",
      "",
      "pub fn side_by_side(diff: &Diff) -> Vec<Row> {",
      "    diff.hunks.iter().flat_map(Hunk::rows).collect()",
      "}",
    ],
  },
  "src/config.rs": {
    path: "src/config.rs",
    name: "config.rs",
    segments: CONFIG,
    preview: [
      { type: "del", text: 'let raw = fs::read("config.json")?;' },
      { type: "del", text: "let cfg = serde_json::from_slice(&raw)?;" },
      { type: "add", text: "let raw = fs::read_to_string(path)?;" },
      { type: "add", text: "let cfg: Config = toml::from_str(&raw)?;" },
    ],
  },
  "src/main.rs": {
    path: "src/main.rs",
    name: "main.rs",
    lines: [
      "mod config;",
      "mod diff;",
      "mod session;",
      "",
      "fn main() {",
      '    println!("claudine");',
      "}",
    ],
  },
  "tests/diff_spec.rs": {
    path: "tests/diff_spec.rs",
    name: "diff_spec.rs",
    isNew: true,
    segments: [
      {
        kind: "hunk",
        id: "h1",
        title: "New test file",
        removed: [],
        added: DIFF_SPEC_LINES,
      },
    ],
    preview: DIFF_SPEC_LINES.slice(0, 4).map((text) => ({
      type: "add" as const,
      text,
    })),
  },
  "Cargo.toml": {
    path: "Cargo.toml",
    name: "Cargo.toml",
    lines: [
      "[package]",
      'name = "claudine"',
      'version = "0.1.0"',
      'edition = "2024"',
      "",
      "[dependencies]",
      'tokio = { version = "1", features = ["sync"] }',
    ],
  },
  "README.md": {
    path: "README.md",
    name: "README.md",
    lines: ["# claudine", "", "Sample project used as mock editor content."],
  },
};

export const TREE: TreeNode[] = [
  {
    name: "src",
    path: "src",
    children: [
      {
        name: "session",
        path: "src/session",
        children: [
          { name: "pool.rs", path: "src/session/pool.rs" },
          { name: "account.rs", path: "src/session/account.rs" },
        ],
      },
      {
        name: "diff",
        path: "src/diff",
        children: [{ name: "render.rs", path: "src/diff/render.rs" }],
      },
      { name: "config.rs", path: "src/config.rs" },
      { name: "main.rs", path: "src/main.rs" },
    ],
  },
  {
    name: "tests",
    path: "tests",
    children: [{ name: "diff_spec.rs", path: "tests/diff_spec.rs" }],
  },
  { name: "Cargo.toml", path: "Cargo.toml" },
  { name: "README.md", path: "README.md" },
];

export const INITIAL_COLLAPSED = ["src/diff"];

export function demoSessions(): Session[] {
  return [
    {
      id: "s-work",
      accountId: "work",
      task: "Make session pool safe for concurrent accounts",
      status: "review",
      file: "src/session/pool.rs",
      awaitingApproval: true,
      permission: null,
      mode: "ask",
      transcript: [
        {
          kind: "user",
          text: "The pool blocks when one account is busy. Make it safe to run all linked accounts at once.",
        },
        {
          kind: "text",
          text: "I'll check how sessions are stored first.",
          chatOnly: true,
        },
        { kind: "tool", verb: "read", target: "src/session/pool.rs" },
        { kind: "tool", verb: "read", target: "src/session/account.rs" },
        {
          kind: "think",
          text: "Vec<Session> blocks while one account is busy",
        },
        {
          kind: "text",
          text: "Sessions sit in a plain `Vec`, so one long task holds up every account. I'll wrap each session in its own lock and add a semaphore with one permit per account.",
          chatOnly: true,
        },
        {
          kind: "tool",
          verb: "edit",
          target: "src/session/pool.rs",
          detail: "2 hunks",
        },
        { kind: "status", text: "Ready for your review.", tone: "review" },
      ],
    },
    {
      id: "s-personal",
      accountId: "personal",
      task: "Write tests for the inline diff renderer",
      status: "running",
      file: "tests/diff_spec.rs",
      awaitingApproval: false,
      permission: null,
      mode: "ask",
      transcript: [
        {
          kind: "user",
          text: "Write tests for the inline diff renderer.",
        },
        { kind: "tool", verb: "read", target: "src/diff/render.rs" },
        { kind: "tool", verb: "write", target: "tests/diff_spec.rs" },
        { kind: "tool", verb: "bash", target: "cargo test diff::" },
        { kind: "output", text: "Compiling claudine v0.1.0" },
        { kind: "status", text: "running tests…", tone: "running" },
      ],
    },
    {
      id: "s-studio",
      accountId: "studio",
      task: "Move config loading to TOML",
      status: "waiting",
      file: "src/config.rs",
      awaitingApproval: false,
      permission: "cargo build --release",
      mode: "ask",
      transcript: [
        { kind: "user", text: "Move config loading to TOML." },
        { kind: "tool", verb: "edit", target: "src/config.rs" },
        {
          kind: "tool",
          verb: "edit",
          target: "Cargo.toml",
          detail: 'add toml = "0.8"',
        },
      ],
    },
  ];
}

export const SETTINGS_PREVIEW: Segment[] = [
  {
    kind: "context",
    lines: [
      "impl SessionPool {",
      "    pub fn new(accounts: &[Account]) -> Self {",
    ],
  },
  {
    kind: "hunk",
    id: "preview",
    title: "",
    removed: [
      "        let sessions = accounts.iter().map(Session::new).collect();",
    ],
    added: [
      "        let n = accounts.len();",
      "        let sessions = accounts.iter().collect();",
      "        let limit = Arc::new(Semaphore::new(n));",
    ],
  },
  {
    kind: "context",
    lines: [
      "        Self { sessions, limit }",
      "    }",
      "",
      "    pub fn is_empty(&self) -> bool {",
      "        self.sessions.len() == 0",
      "    }",
      "}",
    ],
  },
];
