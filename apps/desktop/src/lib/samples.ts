import type { Segment } from "../types";

/** The sample diff in Settings, which previews fonts and colors. */
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
