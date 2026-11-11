//! Agentic runs: Claude Code working on its own on a branch, in its own git worktree,
//! then a pre-PR review.
//!
//! A run is a `claude` session started by `claude.rs`, in the permission mode from
//! Settings. Some actions always ask, whatever the mode (`ALWAYS_ASK`). When Claude is
//! done, Rust runs the checks, asks Claude for a JSON explanation of every changed file,
//! and the run waits for the user's review. Pushing, opening a pull request and
//! discarding each need a native confirmation that the webview can't answer.

use crate::accounts::AccountsState;
use crate::claude::{
    Effort, EventSink, PlanItem, Session, SessionEvent, SpawnOptions, ensure_trusted, find_claude,
    keep_tail, spawn_session, supports_auto_mode,
};
use crate::error::CommandError;
use crate::files;
use crate::git::{self, FileDiff, Git};
use crate::project::ProjectState;
use crate::settings::{OnApprove, RunPermissions, Settings, SettingsState, write_atomic};
use crate::trust::TrustState;
use my_editor_core::path_guard::ProjectRoot;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MAX_TASK_BYTES: usize = 20_000;
const MAX_COMMENT_BYTES: usize = 5_000;
const MAX_COMMENTS: usize = 500;
const MAX_TITLE_CHARS: usize = 70;
const MAX_NOTE_CHARS: usize = 2_000;
/// Lines of a check's output kept for the review.
const CHECK_TAIL_LINES: usize = 30;
const CHECK_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Events kept per run for showing the conversation again.
const MAX_TRANSCRIPT_LINES: usize = 5_000;
/// How many times to ask again for an invalid or incomplete explanation.
const EXPLAIN_RETRIES: u32 = 2;

/// Asked about in every mode, even auto: pushing, installing packages, deleting files,
/// and network tools. The user's deny list is added to these.
const ALWAYS_ASK: &[&str] = &[
    "Bash(git push:*)",
    "Bash(rm:*)",
    "Bash(npm install:*)",
    "Bash(npm i:*)",
    "Bash(npm add:*)",
    "Bash(pnpm add:*)",
    "Bash(pnpm install:*)",
    "Bash(pnpm i:*)",
    "Bash(yarn add:*)",
    "Bash(yarn install:*)",
    "Bash(bun add:*)",
    "Bash(bun install:*)",
    "Bash(pip install:*)",
    "Bash(pip3 install:*)",
    "Bash(uv add:*)",
    "Bash(uv pip install:*)",
    "Bash(cargo add:*)",
    "Bash(cargo install:*)",
    "Bash(brew install:*)",
    "Bash(gem install:*)",
    "Bash(go get:*)",
    "Bash(curl:*)",
    "Bash(wget:*)",
    "WebFetch",
    "WebSearch",
];

/// Allowed without asking when `claude` has no auto mode: builds, tests and reading git.
const SAFE_COMMANDS: &[&str] = &[
    "Bash(cargo build:*)",
    "Bash(cargo check:*)",
    "Bash(cargo test:*)",
    "Bash(cargo clippy:*)",
    "Bash(cargo fmt:*)",
    "Bash(npm test:*)",
    "Bash(npm run:*)",
    "Bash(pnpm test:*)",
    "Bash(pnpm run:*)",
    "Bash(yarn test:*)",
    "Bash(pytest:*)",
    "Bash(go test:*)",
    "Bash(go build:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(ls:*)",
];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunState {
    Running,
    /// Checks and explanations are being made.
    Finishing,
    Review,
    /// Committed and pushed, or committed only. Terminal.
    Approved,
    /// Committed straight to the branch, with pre-PR review off.
    Applied,
    /// Hit a usage limit. The process is still there.
    Paused,
    /// The app closed or `claude` exited while working.
    Interrupted,
}

impl RunState {
    /// The transitions a run can make. Everything else is refused.
    // LEARN: `matches!` is `match` that returns whether the value fits one of the patterns.
    pub fn can_become(self, next: RunState) -> bool {
        use RunState::*;
        matches!(
            (self, next),
            (Running, Finishing | Paused | Interrupted)
                | (Paused, Running | Finishing | Interrupted)
                | (Finishing, Review | Applied | Interrupted)
                | (Review, Running | Approved)
                | (Interrupted, Running | Finishing)
        )
    }

    /// Whether a `claude` process should be working, so a restart interrupts it.
    fn is_active(self) -> bool {
        matches!(
            self,
            RunState::Running | RunState::Finishing | RunState::Paused
        )
    }

    /// States that can be discarded. A working run must be stopped first.
    fn can_discard(self) -> bool {
        matches!(
            self,
            RunState::Review | RunState::Interrupted | RunState::Applied | RunState::Paused
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommentState {
    /// Written, not sent to Claude yet.
    Pending,
    /// Sent to Claude with a request for changes.
    Sent,
    /// Claude replied after working on it.
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub path: String,
    pub line: u32,
    /// "new" for a line of the changed file, "old" for a removed line.
    pub side: String,
    pub body: String,
    pub revision: u32,
    pub state: CommentState,
    pub reply: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub heading: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNote {
    pub path: String,
    pub explanation: String,
    #[serde(default)]
    pub risk: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: String,
    pub reply: String,
}

/// What Claude writes about its work, from the JSON it's asked for.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Explanation {
    pub title: String,
    pub summary: Vec<Section>,
    pub files: Vec<FileNote>,
    #[serde(default)]
    pub replies: Vec<Reply>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub command: String,
    pub passed: bool,
    pub tail: String,
}

/// The worktree as it was when a revision went to review, as a git tree id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u32,
    pub tree: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
    pub paths: Vec<String>,
}

/// A run as stored in `runs.json`. Holds real paths, so it never goes to the webview.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRecord {
    id: String,
    title: String,
    task: String,
    account: String,
    /// The repository the run branched from.
    repo: PathBuf,
    project_name: String,
    base: String,
    base_commit: String,
    branch: String,
    /// Where Claude works: the run's worktree, or `repo` when worktrees are off.
    workdir: PathBuf,
    has_worktree: bool,
    session_id: Option<String>,
    state: RunState,
    /// Why the run is paused, interrupted or stopped, in words for the user.
    note: Option<String>,
    revision: u32,
    created_at: u64,
    started_at: u64,
    finished_at: Option<u64>,
    turns: u64,
    plan: Vec<PlanItem>,
    comments: Vec<Comment>,
    next_comment: u32,
    /// Path to the diff hash the user marked viewed.
    viewed: HashMap<String, String>,
    checks: Vec<CheckResult>,
    explanation: Option<Explanation>,
    snapshots: Vec<Snapshot>,
    stats: Stats,
    pr_url: Option<String>,
    /// The overall note sent with the last request for changes.
    review_note: Option<String>,
    /// The run's own mode. Runs from before it was chosen per run have none and use the
    /// setting.
    #[serde(default)]
    mode: Option<RunPermissions>,
    /// The model picked for the run; `None` is the account's default.
    #[serde(default)]
    model: Option<String>,
    /// The effort picked for the run; `None` is Claude Code's default. Set at each launch.
    #[serde(default)]
    effort: Option<Effort>,
}

/// An approval card waiting in a run's conversation.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermission {
    id: String,
    tool: String,
    summary: String,
    detail: String,
    outside: bool,
}

/// What the webview sees of a run. No real paths.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    id: String,
    title: String,
    task: String,
    account: String,
    project_name: String,
    base: String,
    branch: String,
    has_worktree: bool,
    state: RunState,
    note: Option<String>,
    revision: u32,
    created_at: u64,
    started_at: u64,
    finished_at: Option<u64>,
    turns: u64,
    plan: Vec<PlanItem>,
    comments: Vec<Comment>,
    viewed: HashMap<String, String>,
    checks: Vec<CheckResult>,
    explanation: Option<Explanation>,
    stats: Stats,
    pr_url: Option<String>,
    pr_number: Option<u64>,
    /// Whether a `claude` process is attached right now.
    live: bool,
    /// Messages sent that Claude hasn't read yet.
    queued: u32,
    permissions: Vec<PendingPermission>,
    /// Whether there's an earlier revision to compare with.
    has_previous: bool,
    mode: Option<RunPermissions>,
    model: Option<String>,
    effort: Option<Effort>,
}

impl RunRecord {
    fn view(&self, live: Option<&Live>) -> RunView {
        RunView {
            id: self.id.clone(),
            title: self.title.clone(),
            task: self.task.clone(),
            account: self.account.clone(),
            project_name: self.project_name.clone(),
            base: self.base.clone(),
            branch: self.branch.clone(),
            has_worktree: self.has_worktree,
            state: self.state,
            note: self.note.clone(),
            revision: self.revision,
            created_at: self.created_at,
            started_at: self.started_at,
            finished_at: self.finished_at,
            turns: self.turns,
            plan: self.plan.clone(),
            comments: self.comments.clone(),
            viewed: self.viewed.clone(),
            checks: self.checks.clone(),
            explanation: self.explanation.clone(),
            stats: self.stats.clone(),
            pr_url: self.pr_url.clone(),
            pr_number: self.pr_url.as_deref().and_then(git::pr_number),
            live: live.is_some(),
            queued: live.map_or(0, |l| l.queued),
            permissions: live.map(|l| l.permissions.clone()).unwrap_or_default(),
            has_previous: self.snapshots.len() >= 2
                || self.snapshots.iter().any(|s| s.revision < self.revision),
            mode: self.mode,
            model: self.model.clone(),
            effort: self.effort,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    Working,
    /// Waiting for the explanation JSON. `attempt` counts the asks so far.
    Explaining {
        attempt: u32,
    },
}

/// A run's `claude` process and what Rust tracks while it works.
struct Live {
    session: Session,
    /// Which launch this is, so a replaced process's late events are ignored.
    generation: u64,
    queued: u32,
    phase: Phase,
    /// Claude's text in the current turn, for reading the explanation JSON.
    turn_text: String,
    permissions: Vec<PendingPermission>,
    /// Set by Stop, so the turn's end finishes the run.
    stopping: bool,
}

#[derive(Default)]
struct Store {
    runs: Vec<RunRecord>,
    live: HashMap<String, Live>,
}

/// What the webview hears about runs.
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunUpdate {
    /// The run's record or live state changed.
    // Boxed, so the small updates don't each take a whole run's size.
    Changed { run: Box<RunView> },
    /// A run was discarded.
    Removed { id: String },
    /// One conversation event.
    Event { run: String, event: SessionEvent },
    /// Claude touched files; the Changes tab should refresh.
    FilesChanged { run: String },
}

struct Inner {
    runs_file: PathBuf,
    runs_dir: PathBuf,
    worktrees: PathBuf,
    approved_checks: PathBuf,
    store: Mutex<Store>,
    listener: Mutex<Option<Channel<RunUpdate>>>,
    app: Mutex<Option<AppHandle>>,
    next_id: AtomicU64,
    /// The `claude` to run; `None` finds the user's install. Set by tests to a fake.
    claude_path: Option<PathBuf>,
}

/// Every run, shared by commands, the `claude` reader threads and the limit watcher.
pub struct RunsState(Arc<Inner>);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Cuts text to `max` characters, never through the middle of one.
fn cut(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

/// The run's title: the task's first line, at most 70 characters.
pub fn title_for(task: &str) -> String {
    let first = task.lines().find(|l| !l.trim().is_empty()).unwrap_or("Run");
    cut(first.trim(), MAX_TITLE_CHARS)
}

impl RunsState {
    /// Loads the runs saved in `data_dir`. Runs that were working when the app closed
    /// come back interrupted, since their `claude` is gone.
    pub fn load(data_dir: &Path) -> RunsState {
        let runs_dir = data_dir.join("runs");
        let runs_file = runs_dir.join("runs.json");
        let mut runs: Vec<RunRecord> = fs::read_to_string(&runs_file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        for run in &mut runs {
            if run.state.is_active() {
                run.state = RunState::Interrupted;
                run.note = Some("Claudine closed while this run was working.".to_string());
            }
        }
        RunsState(Arc::new(Inner {
            approved_checks: runs_dir.join("approved-checks.json"),
            runs_file,
            runs_dir,
            worktrees: data_dir.join("worktrees"),
            store: Mutex::new(Store {
                runs,
                live: HashMap::new(),
            }),
            listener: Mutex::new(None),
            app: Mutex::new(None),
            next_id: AtomicU64::new(0),
            claude_path: None,
        }))
    }

    /// Kept for native dialogs shown from background threads.
    pub fn set_app(&self, app: AppHandle) {
        if let Ok(mut slot) = self.0.app.lock() {
            *slot = Some(app);
        }
    }

    /// Checks every few seconds for runs past their time limit.
    pub fn watch_limits(&self, settings: Arc<dyn Fn() -> Settings + Send + Sync>) {
        let inner = Arc::clone(&self.0);
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(5));
                let minutes = settings().max_run_minutes;
                if minutes == 0 {
                    continue;
                }
                let limit = u64::from(minutes) * 60_000;
                let over: Vec<String> = match inner.store.lock() {
                    Ok(store) => store
                        .runs
                        .iter()
                        .filter(|r| r.state == RunState::Running)
                        .filter(|r| now().saturating_sub(r.started_at) > limit)
                        .map(|r| r.id.clone())
                        .collect(),
                    Err(_) => break,
                };
                for id in over {
                    let note = format!("Stopped after the {minutes}-minute limit.");
                    let _ = inner.stop(&id, Some(note));
                }
            }
        });
    }

    /// Stops the runs on `account`, when it's signed out or removed.
    pub fn stop_account(&self, account: &str) {
        let ids: Vec<String> = match self.0.store.lock() {
            Ok(store) => store
                .runs
                .iter()
                .filter(|r| r.account == account && store.live.contains_key(&r.id))
                .map(|r| r.id.clone())
                .collect(),
            Err(_) => return,
        };
        for id in ids {
            self.0
                .detach(&id, Some("Its account was signed out.".to_string()));
        }
    }
}

impl Inner {
    fn emit(&self, update: RunUpdate) {
        if let Ok(listener) = self.listener.lock()
            && let Some(channel) = listener.as_ref()
        {
            // Fails only if the webview is gone.
            let _ = channel.send(update);
        }
    }

    fn save(&self, store: &Store) {
        if let Ok(text) = serde_json::to_string_pretty(&store.runs) {
            let _ = write_atomic(&self.runs_file, &text);
        }
    }

    /// Saves, then tells the webview about the run.
    fn changed(&self, store: &Store, id: &str) {
        self.save(store);
        if let Some(run) = store.runs.iter().find(|r| r.id == id) {
            self.emit(RunUpdate::Changed {
                run: Box::new(run.view(store.live.get(id))),
            });
        }
    }

    fn transcript_file(&self, id: &str) -> PathBuf {
        self.runs_dir.join(id).join("events.jsonl")
    }

    fn record_event(&self, id: &str, event: &SessionEvent) {
        let Ok(line) = serde_json::to_string(event) else {
            return;
        };
        let path = self.transcript_file(id);
        if let Some(folder) = path.parent() {
            let _ = fs::create_dir_all(folder);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{line}");
        }
    }

    /// Shows the user's message in the run's conversation as soon as it's sent. Claude's
    /// echo of it only marks it read.
    fn user_said(&self, id: &str, text: &str) {
        let event = SessionEvent::UserMessage {
            text: text.to_string(),
        };
        self.record_event(id, &event);
        self.emit(RunUpdate::Event {
            run: id.to_string(),
            event,
        });
    }

    /// Adds a line to the conversation that Claudine itself says.
    fn notice(&self, id: &str, message: String) {
        let event = SessionEvent::Notice { message };
        self.record_event(id, &event);
        self.emit(RunUpdate::Event {
            run: id.to_string(),
            event,
        });
    }

    fn new_id(&self) -> String {
        let n = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("r{:x}{:02x}", now(), n % 256)
    }

    fn settings(&self) -> Settings {
        self.app
            .lock()
            .ok()
            .and_then(|app| app.as_ref().map(|a| a.state::<SettingsState>().current()))
            .unwrap_or_default()
    }

    /// Ends a run's process without finishing it, marking it interrupted.
    fn detach(&self, id: &str, note: Option<String>) {
        let Ok(mut store) = self.store.lock() else {
            return;
        };
        // Dropping the session kills its process.
        store.live.remove(id);
        if let Some(run) = store.runs.iter_mut().find(|r| r.id == id)
            && run.state.can_become(RunState::Interrupted)
        {
            run.state = RunState::Interrupted;
            run.note = note;
        }
        self.changed(&store, id);
    }

    /// Stops the current turn and moves the run on to its review.
    fn stop(self: &Arc<Self>, id: &str, note: Option<String>) -> Result<(), CommandError> {
        let mut store = self.store.lock().map_err(|_| CommandError::Internal)?;
        let state = run_of(&store, id)?.state;
        if !matches!(state, RunState::Running | RunState::Paused) {
            return Err(CommandError::WrongState);
        }
        if let Some(run) = store.runs.iter_mut().find(|r| r.id == id) {
            run.note = note;
        }
        let interrupted = match store.live.get_mut(id) {
            Some(live) => {
                live.stopping = true;
                live.session.interrupt().is_ok()
            }
            None => false,
        };
        self.changed(&store, id);
        drop(store);
        if !interrupted {
            self.begin_finishing(id);
            return Ok(());
        }
        // The interrupt ends the turn, which finishes the run. If `claude` doesn't answer,
        // finish anyway after a few seconds.
        let inner = Arc::clone(self);
        let id = id.to_string();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(8));
            let still = inner.store.lock().ok().is_some_and(|s| {
                s.runs
                    .iter()
                    .any(|r| r.id == id && matches!(r.state, RunState::Running | RunState::Paused))
            });
            if still {
                inner.begin_finishing(&id);
            }
        });
        Ok(())
    }
}

fn run_of<'a>(store: &'a Store, id: &str) -> Result<&'a RunRecord, CommandError> {
    store
        .runs
        .iter()
        .find(|r| r.id == id)
        .ok_or(CommandError::NotFound)
}

fn run_mut<'a>(store: &'a mut Store, id: &str) -> Result<&'a mut RunRecord, CommandError> {
    store
        .runs
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or(CommandError::NotFound)
}

/// The `ask` rules for a run: `ALWAYS_ASK` plus the user's deny list.
pub fn ask_rules(deny_list: &[String]) -> Vec<String> {
    let mut rules: Vec<String> = ALWAYS_ASK.iter().map(|r| r.to_string()).collect();
    for command in deny_list {
        rules.push(format!("Bash({command})"));
        rules.push(format!("Bash({command}:*)"));
    }
    rules
}

/// What Claude is told about working in a run, on top of Claude Code's own prompt.
fn run_prompt(branch: &str, base: &str, has_worktree: bool) -> String {
    let place = if has_worktree {
        "a git worktree made for this task"
    } else {
        "the project folder"
    };
    format!(
        "You are working on your own in Claudine, on the branch `{branch}` in {place}, \
         branched from `{base}`. Work through the task without stopping to ask. Keep a plan \
         with the TodoWrite tool and update it as you go. Don't commit, push or open pull \
         requests: the user reviews your changes in Claudine, which commits them after \
         approval. When the task is done, stop."
    )
}

/// Spawns `claude` for a run, continuing its session when it has one.
fn launch(
    inner: &Arc<Inner>,
    store: &mut Store,
    id: &str,
    config_dir: Option<&Path>,
) -> Result<(), CommandError> {
    if store.live.contains_key(id) {
        return Ok(());
    }
    let run = run_of(store, id)?.clone();
    let claude = inner
        .claude_path
        .clone()
        .or_else(find_claude)
        .ok_or(CommandError::ClaudeNotFound)?;
    let settings = inner.settings();
    let auto = supports_auto_mode(&claude);
    let wanted = run.mode.unwrap_or(settings.run_permissions);
    let mode = mode_flag(wanted, auto);
    // Without auto mode, safe commands are allowed up front so the run isn't stuck asking.
    let allowed_tools = if wanted == RunPermissions::Auto && !auto {
        SAFE_COMMANDS.iter().map(|c| c.to_string()).collect()
    } else {
        Vec::new()
    };
    let ask = serde_json::json!({ "permissions": { "ask": ask_rules(&settings.deny_list) } });
    let options = SpawnOptions {
        mode,
        resume: run.session_id.clone(),
        settings: Some(ask.to_string()),
        allowed_tools,
        replay: true,
        append_prompt: Some(run_prompt(&run.branch, &run.base, run.has_worktree)),
        effort: run.effort,
    };
    let generation = inner.next_id.fetch_add(1, Ordering::Relaxed);
    let sink_inner = Arc::clone(inner);
    let sink_id = id.to_string();
    let sink: EventSink = Arc::new(move |event| sink_inner.on_event(&sink_id, generation, event));
    let session = spawn_session(
        &claude,
        &run.workdir,
        &run.account,
        config_dir,
        &options,
        sink,
    )?;
    // A control message, never a CLI argument. `claude` reads it after `initialize`.
    if let Some(model) = &run.model {
        session.control(
            "model",
            serde_json::json!({ "subtype": "set_model", "model": model }),
        )?;
    }
    store.live.insert(
        id.to_string(),
        Live {
            session,
            generation,
            queued: 0,
            phase: Phase::Working,
            turn_text: String::new(),
            permissions: Vec::new(),
            stopping: false,
        },
    );
    Ok(())
}

/// Claude Code's name for a run's mode. Without auto mode, auto becomes accept edits.
fn mode_flag(mode: RunPermissions, auto_available: bool) -> &'static str {
    match mode {
        RunPermissions::Auto if auto_available => "auto",
        RunPermissions::Auto | RunPermissions::AcceptEdits => "acceptEdits",
        RunPermissions::Plan => "plan",
        RunPermissions::Ask => "default",
    }
}

/// Whether `model` looks like a model name or alias, such as `opus` or `claude-sonnet-5-5`.
/// `claude` refuses names it doesn't know; this keeps anything else out of the message.
fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 64
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '[' | ']'))
}

/// Whether a failed turn's message is a usage limit.
fn is_limit_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("limit reached")
        || lower.contains("hit your limit")
}

impl Inner {
    /// Every event from a run's `claude`, on its reader thread.
    fn on_event(self: &Arc<Self>, id: &str, generation: u64, event: SessionEvent) {
        // Quiet "allowed" usage events aren't worth keeping, and echoes only mark the
        // user's message read; it was shown when it was sent.
        let mut noisy = matches!(&event, SessionEvent::RateLimit { status, .. } if status == "allowed")
            || matches!(event, SessionEvent::UserEcho { .. });
        let mut finish = false;
        let mut explained: Option<String> = None;
        {
            let Ok(mut store) = self.store.lock() else {
                return;
            };
            // A process that was replaced or stopped has nothing more to say.
            if store.live.get(id).map(|l| l.generation) != Some(generation) {
                return;
            }
            // The explanation request and Claude's JSON answer stay out of the conversation.
            let explaining = store
                .live
                .get(id)
                .is_some_and(|l| matches!(l.phase, Phase::Explaining { .. }));
            if explaining
                && matches!(
                    event,
                    SessionEvent::Text { .. }
                        | SessionEvent::UserEcho { .. }
                        | SessionEvent::Tool { .. }
                        | SessionEvent::ToolResult { .. }
                )
            {
                noisy = true;
            }
            if !noisy {
                self.record_event(id, &event);
            }
            let max_turns = u64::from(self.settings().max_run_turns);
            let store = &mut *store;
            let Some(run) = store.runs.iter_mut().find(|r| r.id == id) else {
                return;
            };
            let live = store.live.get_mut(id);
            let mut dirty = false;
            match &event {
                SessionEvent::Ready { session_id, .. } if !session_id.is_empty() => {
                    run.session_id = Some(session_id.clone());
                    dirty = true;
                }
                SessionEvent::Plan { items } => {
                    run.plan = items.clone();
                    dirty = true;
                }
                SessionEvent::UserEcho { .. } => {
                    if let Some(live) = live {
                        live.queued = live.queued.saturating_sub(1);
                    }
                    dirty = true;
                }
                SessionEvent::Text { text } => {
                    if let Some(live) = live
                        && matches!(live.phase, Phase::Explaining { .. })
                    {
                        live.turn_text.push_str(text);
                        live.turn_text.push('\n');
                    }
                }
                SessionEvent::Tool { name, .. } => {
                    if matches!(
                        name.as_str(),
                        "Edit" | "Write" | "NotebookEdit" | "MultiEdit" | "Bash"
                    ) {
                        self.emit(RunUpdate::FilesChanged {
                            run: id.to_string(),
                        });
                    }
                }
                SessionEvent::ToolResult { .. } => {
                    self.emit(RunUpdate::FilesChanged {
                        run: id.to_string(),
                    });
                }
                SessionEvent::Permission {
                    id: request,
                    tool,
                    summary,
                    detail,
                    outside,
                    // Runs keep the plain card: their views are re-sent on every update.
                    proposal: _,
                } => {
                    if let Some(live) = live {
                        live.permissions.push(PendingPermission {
                            id: request.clone(),
                            tool: tool.clone(),
                            summary: summary.clone(),
                            detail: detail.clone(),
                            outside: *outside,
                        });
                    }
                    dirty = true;
                }
                SessionEvent::PermissionClosed { id: request } => {
                    if let Some(live) = live {
                        live.permissions.retain(|p| &p.id != request);
                    }
                    dirty = true;
                }
                SessionEvent::RateLimit { status, resets_at } if status == "rejected" => {
                    if run.state.can_become(RunState::Paused) {
                        run.state = RunState::Paused;
                        run.note = Some(limit_note(*resets_at));
                        dirty = true;
                    }
                }
                SessionEvent::TurnDone {
                    is_error,
                    message,
                    num_turns,
                    ..
                } => {
                    if let Some(turns) = num_turns {
                        run.turns = *turns;
                    }
                    let limited = *is_error && message.as_deref().is_some_and(is_limit_message);
                    if let Some(live) = live {
                        let explaining = matches!(live.phase, Phase::Explaining { .. });
                        if limited && run.state.can_become(RunState::Paused) {
                            run.state = RunState::Paused;
                            run.note = message.clone();
                        } else if explaining {
                            explained = Some(std::mem::take(&mut live.turn_text));
                        } else if run.state == RunState::Running
                            && (live.queued == 0 || live.stopping)
                        {
                            finish = true;
                        } else if run.state == RunState::Running
                            && max_turns > 0
                            && run.turns >= max_turns
                        {
                            run.note = Some(format!("Stopped at the {max_turns}-turn limit."));
                            finish = true;
                        }
                    }
                    dirty = true;
                }
                SessionEvent::Exited { .. } => {
                    store.live.remove(id);
                    if let Some(run) = store.runs.iter_mut().find(|r| r.id == id)
                        && matches!(run.state, RunState::Running | RunState::Paused)
                    {
                        run.state = RunState::Interrupted;
                        run.note = Some("Claude Code exited before finishing.".to_string());
                    }
                    dirty = true;
                }
                _ => {}
            }
            if dirty {
                self.changed(store, id);
            }
        }
        if !noisy {
            self.emit(RunUpdate::Event {
                run: id.to_string(),
                event,
            });
        }
        if finish {
            self.begin_finishing(id);
        }
        if let Some(text) = explained {
            self.on_explanation(id, &text);
        }
    }

    /// Moves the run to finishing and does the work on a thread, since checks can be slow.
    fn begin_finishing(self: &Arc<Self>, id: &str) {
        {
            let Ok(mut store) = self.store.lock() else {
                return;
            };
            let Ok(run) = run_mut(&mut store, id) else {
                return;
            };
            if !run.state.can_become(RunState::Finishing) {
                return;
            }
            run.state = RunState::Finishing;
            run.finished_at = Some(now());
            if let Some(live) = store.live.get_mut(id) {
                live.stopping = false;
                live.permissions.clear();
            }
            self.changed(&store, id);
        }
        let inner = Arc::clone(self);
        let id = id.to_string();
        thread::spawn(move || inner.finish(&id));
    }

    fn finish(self: &Arc<Self>, id: &str) {
        let settings = self.settings();
        let Some(run) = self
            .store
            .lock()
            .ok()
            .and_then(|s| run_of(&s, id).ok().cloned())
        else {
            return;
        };
        if !settings.pre_pr_review {
            self.apply(&run);
            return;
        }
        if settings.run_checks {
            let checks = self.run_checks(&run, &settings);
            if let Ok(mut store) = self.store.lock()
                && let Ok(record) = run_mut(&mut store, id)
            {
                record.checks = checks;
                self.changed(&store, id);
            }
        }
        if settings.explain_files {
            self.ask_for_explanation(id, 1, None);
        } else {
            self.to_review(id, None);
        }
    }

    /// Pre-PR review off: commit straight to the run's branch.
    fn apply(&self, run: &RunRecord) {
        let result =
            Git::find().and_then(|git| git.commit_all(&run.workdir, &run.title, &run.task));
        let Ok(mut store) = self.store.lock() else {
            return;
        };
        store.live.remove(&run.id);
        if let Ok(record) = run_mut(&mut store, &run.id) {
            match result {
                Ok(_) => {
                    record.state = RunState::Applied;
                    record.note = Some(format!("Committed to {}.", record.branch));
                }
                Err(error) => {
                    record.state = RunState::Interrupted;
                    record.note = Some(format!("Couldn't commit: {}", describe(&error)));
                }
            }
        }
        self.changed(&store, &run.id);
    }

    /// Runs the project's checks in the worktree and keeps the end of their output.
    fn run_checks(&self, run: &RunRecord, settings: &Settings) -> Vec<CheckResult> {
        let commands = if settings.check_commands.is_empty() {
            detect_checks(&run.workdir)
        } else if self.checks_confirmed(&settings.check_commands, &run.project_name) {
            settings.check_commands.clone()
        } else {
            self.notice(
                &run.id,
                "Checks skipped: they weren't confirmed.".to_string(),
            );
            return Vec::new();
        };
        if !commands.is_empty() {
            self.notice(&run.id, format!("Running checks: {}", commands.join(", ")));
        }
        commands
            .iter()
            .map(|command| run_check(&run.workdir, command))
            .collect()
    }

    /// Commands typed in Settings run only once the user confirms them in a native
    /// dialog, since the webview could otherwise set any shell command.
    fn checks_confirmed(&self, commands: &[String], project: &str) -> bool {
        let approved: Vec<Vec<String>> = fs::read_to_string(&self.approved_checks)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        if approved.iter().any(|list| list == commands) {
            return true;
        }
        let Some(app) = self.app.lock().ok().and_then(|a| a.clone()) else {
            return false;
        };
        let message = format!(
            "These commands from Settings will run in the run's worktree for “{project}”:\n\n{}",
            commands.join("\n")
        );
        let ok = app
            .dialog()
            .message(message)
            .title("Run these checks?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Run Checks".to_string(),
                "Skip".to_string(),
            ))
            .blocking_show();
        if ok {
            let mut approved = approved;
            approved.push(commands.to_vec());
            if let Ok(text) = serde_json::to_string(&approved) {
                let _ = write_atomic(&self.approved_checks, &text);
            }
        }
        ok
    }

    /// The paths changed in the run so far, for the explanation request.
    fn changed_paths(&self, run: &RunRecord) -> Vec<String> {
        self.diff_now(run)
            .map(|files| files.into_iter().map(|f| f.path).collect())
            .unwrap_or_default()
    }

    fn diff_now(&self, run: &RunRecord) -> Result<Vec<FileDiff>, CommandError> {
        let git = Git::find()?;
        let tree = self.current_tree(&git, run)?;
        git.diff(&run.repo, &run.base_commit, &tree)
    }

    /// The run's work as a git tree: a snapshot of the worktree, or its branch once the
    /// worktree is gone.
    fn current_tree(&self, git: &Git, run: &RunRecord) -> Result<String, CommandError> {
        if run.workdir.exists() && run.state != RunState::Approved {
            let index = self.runs_dir.join(&run.id).join("index.tmp");
            if let Some(folder) = index.parent() {
                fs::create_dir_all(folder)?;
            }
            git.snapshot(&run.workdir, &index)
        } else {
            Ok(format!("refs/heads/{}", run.branch))
        }
    }

    /// Sends the explanation request. `missing` asks only about those files.
    fn ask_for_explanation(self: &Arc<Self>, id: &str, attempt: u32, missing: Option<Vec<String>>) {
        let Ok(mut store) = self.store.lock() else {
            return;
        };
        let Ok(run) = run_of(&store, id).cloned() else {
            return;
        };
        if !store.live.contains_key(id) {
            let config_dir = self.config_dir(&run.account);
            if let Err(error) = launch(self, &mut store, id, config_dir.as_deref()) {
                drop(store);
                self.notice(
                    id,
                    format!("Couldn't ask for explanations: {}", describe(&error)),
                );
                self.to_review(id, None);
                return;
            }
        }
        let paths = match missing {
            Some(paths) => paths,
            None => self.changed_paths(&run),
        };
        let resolved: Vec<&Comment> = run
            .comments
            .iter()
            .filter(|c| c.state == CommentState::Sent)
            .collect();
        let message = explain_request(&paths, &resolved, attempt > 1);
        if attempt == 1 {
            self.notice(
                id,
                "Claude is writing an explanation for each file…".to_string(),
            );
        }
        let Some(live) = store.live.get_mut(id) else {
            return;
        };
        live.phase = Phase::Explaining { attempt };
        live.turn_text.clear();
        let sent = live.session.send_user(&message);
        drop(store);
        if sent.is_err() {
            self.to_review(id, None);
        }
    }

    fn config_dir(&self, account: &str) -> Option<PathBuf> {
        let app = self.app.lock().ok()?.clone()?;
        app.state::<AccountsState>()
            .config_dir(account)
            .ok()
            .flatten()
    }

    /// Claude's answer to the explanation request.
    fn on_explanation(self: &Arc<Self>, id: &str, text: &str) {
        let (attempt, run) = {
            let Ok(store) = self.store.lock() else {
                return;
            };
            let Some(live) = store.live.get(id) else {
                return;
            };
            let Phase::Explaining { attempt } = live.phase else {
                return;
            };
            let Ok(run) = run_of(&store, id).cloned() else {
                return;
            };
            (attempt, run)
        };
        let paths = self.changed_paths(&run);
        // A retry for missing files adds to what came before.
        let earlier = if attempt > 1 {
            run.explanation.clone()
        } else {
            None
        };
        match parse_explanation(text) {
            Ok(fresh) => {
                let merged = match earlier {
                    Some(old) => merge_explanations(old, fresh),
                    None => fresh,
                };
                let missing = missing_files(&merged, &paths);
                if let Ok(mut store) = self.store.lock()
                    && let Ok(record) = run_mut(&mut store, id)
                {
                    record.explanation = Some(merged);
                }
                if !missing.is_empty() && attempt <= EXPLAIN_RETRIES {
                    self.ask_for_explanation(id, attempt + 1, Some(missing));
                } else {
                    self.to_review(id, None);
                }
            }
            Err(problem) if attempt <= EXPLAIN_RETRIES => {
                self.notice(
                    id,
                    format!("The explanation wasn't valid ({problem}). Asking again."),
                );
                self.ask_for_explanation(id, attempt + 1, None);
            }
            Err(problem) => {
                self.to_review(
                    id,
                    Some(format!("Claude's explanation wasn't valid: {problem}")),
                );
            }
        }
    }

    /// Takes the revision's snapshot, resolves answered comments and waits for review.
    fn to_review(&self, id: &str, note: Option<String>) {
        let Ok(mut store) = self.store.lock() else {
            return;
        };
        let Ok(run) = run_of(&store, id).cloned() else {
            return;
        };
        let snapshot = Git::find().and_then(|git| self.current_tree(&git, &run));
        let stats = self.diff_now(&run).map(|files| stats_of(&files)).ok();
        // The process isn't needed while the user reviews; a new revision resumes it.
        store.live.remove(id);
        if let Ok(record) = run_mut(&mut store, id) {
            if let Ok(tree) = snapshot {
                record.snapshots.retain(|s| s.revision != record.revision);
                record.snapshots.push(Snapshot {
                    revision: record.revision,
                    tree,
                });
            }
            if let Some(stats) = stats {
                record.stats = stats;
            }
            let replies = record
                .explanation
                .as_ref()
                .map(|e| e.replies.clone())
                .unwrap_or_default();
            resolve_comments(&mut record.comments, &replies);
            if note.is_some() {
                record.note = note;
            }
            if record.state.can_become(RunState::Review) {
                record.state = RunState::Review;
            }
        }
        self.changed(&store, id);
    }
}

fn limit_note(resets_at: Option<u64>) -> String {
    match resets_at {
        Some(at) => format!("This account hit its usage limit. It resets at {at} (Unix time)."),
        None => "This account hit its usage limit.".to_string(),
    }
}

fn describe(error: &CommandError) -> String {
    match error {
        CommandError::Git { detail } => detail.clone(),
        other => format!("{other:?}"),
    }
}

fn stats_of(files: &[FileDiff]) -> Stats {
    Stats {
        files: files.len() as u32,
        additions: files.iter().map(|f| f.additions).sum(),
        deletions: files.iter().map(|f| f.deletions).sum(),
        paths: files.iter().map(|f| f.path.clone()).collect(),
    }
}

/// Checks found in the worktree: `cargo test`, the package manager's test script, `pytest`.
fn detect_checks(workdir: &Path) -> Vec<String> {
    let Ok(root) = ProjectRoot::open(workdir) else {
        return Vec::new();
    };
    let exists = |name: &str| files::read_file(&root, name).is_ok();
    let mut checks = Vec::new();
    if exists("Cargo.toml") {
        checks.push("cargo test".to_string());
    }
    if let Ok(text) = files::read_file(&root, "package.json").map(|f| f.text) {
        let test = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|json| json["scripts"]["test"].as_str().map(str::to_string));
        // `npm init` writes a test script that only fails.
        if test.is_some_and(|t| !t.contains("no test specified")) {
            let tool = if exists("pnpm-lock.yaml") {
                "pnpm"
            } else if exists("yarn.lock") {
                "yarn"
            } else if exists("bun.lock") || exists("bun.lockb") {
                "bun"
            } else {
                "npm"
            };
            checks.push(format!("{tool} test"));
        }
    }
    if exists("pytest.ini") || exists("conftest.py") {
        checks.push("pytest".to_string());
    } else if let Ok(text) = files::read_file(&root, "pyproject.toml").map(|f| f.text)
        && text.contains("pytest")
    {
        checks.push("pytest".to_string());
    }
    checks
}

/// Runs one check with `sh -c`, killing it after the timeout.
fn run_check(workdir: &Path, command: &str) -> CheckResult {
    let spawned = Command::new("/bin/sh")
        .args(["-c", &format!("{command} 2>&1")])
        .current_dir(workdir)
        .env_remove("CLAUDECODE")
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => {
            return CheckResult {
                command: command.to_string(),
                passed: false,
                tail: format!("Couldn't start: {error}"),
            };
        }
    };
    let tail = Arc::new(Mutex::new(String::new()));
    let reader = child.stdout.take().map(|stdout| {
        let tail = Arc::clone(&tail);
        thread::spawn(move || keep_tail(stdout, &tail))
    });
    let started = std::time::Instant::now();
    let passed = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if started.elapsed() > CHECK_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(_) => break false,
        }
    };
    if let Some(reader) = reader {
        let _ = reader.join();
    }
    let text = tail.lock().map(|t| t.clone()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(CHECK_TAIL_LINES);
    CheckResult {
        command: command.to_string(),
        passed,
        tail: lines[start..].join("\n"),
    }
}

/// The message asking Claude for the explanation JSON.
pub fn explain_request(paths: &[String], comments: &[&Comment], retry: bool) -> String {
    let mut message = String::new();
    if retry {
        message.push_str("That wasn't the JSON Claudine needs. ");
    }
    message.push_str(
        "Claudine: the work is ready for the user's review. Reply with only a JSON object, \
         no other text and no code fence, in this shape:\n\
         {\"title\": \"under 70 characters\", \
         \"summary\": [{\"heading\": \"What changed\", \"text\": \"...\"}, \
         {\"heading\": \"Why\", \"text\": \"...\"}, \
         {\"heading\": \"How it was tested\", \"text\": \"...\"}, \
         {\"heading\": \"Worth a look\", \"text\": \"...\"}], \
         \"files\": [{\"path\": \"src/...\", \"explanation\": \"1-3 sentences on what changed \
         in this file and why\", \"risk\": \"optional: anything the reviewer should double-check\"}]",
    );
    if !comments.is_empty() {
        message
            .push_str(", \"replies\": [{\"id\": \"c1\", \"reply\": \"one line on what you did\"}]");
    }
    message.push_str("}\n\nExplain every one of these changed files in `files`:\n");
    for path in paths {
        message.push_str(&format!("- {path}\n"));
    }
    if !comments.is_empty() {
        message.push_str("\nAnd reply to each of these review comments in `replies`:\n");
        for comment in comments {
            message.push_str(&format!(
                "- {}: {}:{} — {}\n",
                comment.id,
                comment.path,
                comment.line,
                one_line(&comment.body)
            ));
        }
    }
    message
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Reads the explanation JSON from Claude's reply and checks it.
pub fn parse_explanation(text: &str) -> Result<Explanation, String> {
    let start = text.find('{').ok_or("no JSON object")?;
    let end = text.rfind('}').ok_or("no JSON object")?;
    if end < start {
        return Err("no JSON object".to_string());
    }
    let mut parsed: Explanation =
        serde_json::from_str(&text[start..=end]).map_err(|e| format!("not valid JSON: {e}"))?;
    parsed.title = cut(parsed.title.trim(), MAX_TITLE_CHARS);
    if parsed.title.is_empty() {
        return Err("no title".to_string());
    }
    if parsed.summary.is_empty() {
        return Err("no summary".to_string());
    }
    for section in &mut parsed.summary {
        section.heading = cut(section.heading.trim(), 80);
        section.text = cut(section.text.trim(), MAX_NOTE_CHARS);
    }
    parsed.summary.truncate(10);
    parsed
        .files
        .retain(|f| !f.path.trim().is_empty() && !f.explanation.trim().is_empty());
    for file in &mut parsed.files {
        file.explanation = cut(file.explanation.trim(), MAX_NOTE_CHARS);
        file.risk = file
            .risk
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty() && !r.eq_ignore_ascii_case("none"))
            .map(|r| cut(r, MAX_NOTE_CHARS));
    }
    parsed.files.truncate(500);
    for reply in &mut parsed.replies {
        reply.reply = cut(reply.reply.trim(), 500);
    }
    Ok(parsed)
}

/// Changed files the explanation doesn't cover.
pub fn missing_files(explanation: &Explanation, paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| !explanation.files.iter().any(|f| &f.path == *p))
        .cloned()
        .collect()
}

/// A retry's answer adds files and replies to the first answer.
fn merge_explanations(mut old: Explanation, fresh: Explanation) -> Explanation {
    for file in fresh.files {
        old.files.retain(|f| f.path != file.path);
        old.files.push(file);
    }
    for reply in fresh.replies {
        old.replies.retain(|r| r.id != reply.id);
        old.replies.push(reply);
    }
    old
}

/// Marks sent comments resolved, with Claude's reply when it gave one.
fn resolve_comments(comments: &mut [Comment], replies: &[Reply]) {
    for comment in comments
        .iter_mut()
        .filter(|c| c.state == CommentState::Sent)
    {
        comment.state = CommentState::Resolved;
        comment.reply = replies
            .iter()
            .find(|r| r.id == comment.id)
            .map(|r| r.reply.clone());
    }
}

/// The message that asks for changes, from the pending comments and the overall note.
pub fn changes_request(revision: u32, comments: &[&Comment], note: &str) -> String {
    let mut message = format!("Review comments (revision {revision}):\n");
    for comment in comments {
        message.push_str(&format!(
            "- {}:{} — {}\n",
            comment.path,
            comment.line,
            one_line(&comment.body)
        ));
    }
    let note = note.trim();
    if !note.is_empty() {
        message.push_str(&format!("Overall: {}\n", one_line(note)));
    }
    message.push_str("Address each one, then stop.");
    message
}

/// The pull request's description: the summary, then each file's explanation.
fn pr_body(run: &RunRecord) -> String {
    let mut body = String::new();
    if let Some(explanation) = &run.explanation {
        for section in &explanation.summary {
            body.push_str(&format!("## {}\n\n{}\n\n", section.heading, section.text));
        }
        if !explanation.files.is_empty() {
            body.push_str("## Files\n\n");
            for file in &explanation.files {
                body.push_str(&format!("- `{}`: {}", file.path, file.explanation));
                if let Some(risk) = &file.risk {
                    body.push_str(&format!(" Worth a look: {risk}"));
                }
                body.push('\n');
            }
            body.push('\n');
        }
    } else {
        body.push_str(&format!("{}\n\n", run.task));
    }
    if !run.checks.is_empty() {
        body.push_str("## Checks\n\n");
        for check in &run.checks {
            let mark = if check.passed { "passed" } else { "failed" };
            body.push_str(&format!("- `{}`: {mark}\n", check.command));
        }
        body.push('\n');
    }
    body.push_str("Made with Claude Code in Claudine.\n");
    body
}

fn confirm(app: &AppHandle, title: &str, message: String, button: &str) -> bool {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            button.to_string(),
            "Cancel".to_string(),
        ))
        .blocking_show()
}

// ----- Commands -----

/// What a new run would look like, for the form's preview.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRunInfo {
    project_name: String,
    current_branch: Option<String>,
    branches: Vec<String>,
    branch_prefix: String,
    worktree: bool,
    review: bool,
    permissions: RunPermissions,
    auto_available: bool,
}

#[tauri::command(async)]
pub fn new_run_info(
    window: WebviewWindow,
    projects: State<'_, ProjectState>,
    settings: State<'_, SettingsState>,
) -> Result<NewRunInfo, CommandError> {
    let (name, folder) = projects.name_and_path(window.label())?;
    let git = Git::find()?;
    let repo = git.repo_root(&folder)?;
    let settings = settings.current();
    Ok(NewRunInfo {
        project_name: name,
        current_branch: git.current_branch(&repo)?,
        branches: git.branches(&repo)?,
        branch_prefix: settings.branch_prefix,
        worktree: settings.worktree_per_run,
        review: settings.pre_pr_review,
        permissions: settings.run_permissions,
        auto_available: find_claude().is_some_and(|c| supports_auto_mode(&c)),
    })
}

/// The mode and model the user picked for a run. `None` keeps the setting or the default.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    mode: Option<RunPermissions>,
    model: Option<String>,
    effort: Option<Effort>,
}

impl RunOptions {
    fn checked(self) -> Result<RunOptions, CommandError> {
        match &self.model {
            Some(model) if !valid_model(model) => Err(CommandError::InvalidInput),
            _ => Ok(self),
        }
    }
}

/// Makes the run's branch and worktree and starts Claude there with the task.
#[allow(clippy::too_many_arguments)]
fn create_run(
    inner: &Arc<Inner>,
    folder: &Path,
    project_name: String,
    account: &str,
    task: &str,
    base: &str,
    options: RunOptions,
    settings: &Settings,
    config_dir: Option<&Path>,
) -> Result<String, CommandError> {
    let git = Git::find()?;
    let repo = git.repo_root(folder)?;
    if !git.valid_branch(&repo, base)? || !git.branch_exists(&repo, base)? {
        return Err(CommandError::InvalidInput);
    }
    let base_commit = git.commit_of(&repo, base)?;
    let id = inner.new_id();
    let branch = git.unique_branch(&repo, &settings.branch_prefix, &git::slug(task))?;

    let workdir = if settings.worktree_per_run {
        fs::create_dir_all(&inner.worktrees)?;
        let path = inner.worktrees.join(&id);
        git.add_worktree(&repo, &path, &branch, &base_commit)?;
        path.canonicalize()?
    } else {
        let store = inner.store.lock().map_err(|_| CommandError::Internal)?;
        let busy = store
            .runs
            .iter()
            .any(|r| !r.has_worktree && r.repo == repo && r.state.is_active());
        if busy {
            return Err(CommandError::WrongState);
        }
        drop(store);
        git.switch_new_branch(&repo, &branch)?;
        repo.clone()
    };

    let started = now();
    let record = RunRecord {
        id: id.clone(),
        title: title_for(task),
        task: task.to_string(),
        account: account.to_string(),
        repo,
        project_name,
        base: base.to_string(),
        base_commit,
        branch,
        has_worktree: settings.worktree_per_run,
        workdir,
        session_id: None,
        state: RunState::Running,
        note: None,
        revision: 1,
        created_at: started,
        started_at: started,
        finished_at: None,
        turns: 0,
        plan: Vec::new(),
        comments: Vec::new(),
        next_comment: 1,
        viewed: HashMap::new(),
        checks: Vec::new(),
        explanation: None,
        snapshots: Vec::new(),
        stats: Stats::default(),
        pr_url: None,
        review_note: None,
        mode: Some(options.mode.unwrap_or(settings.run_permissions)),
        model: options.model,
        effort: options.effort,
    };
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    store.runs.push(record);
    if let Err(error) = launch(inner, &mut store, &id, config_dir) {
        // Nothing ran yet, so the branch and worktree made for it go too.
        if let Some(run) = store.runs.iter().find(|r| r.id == id)
            && run.has_worktree
        {
            let _ = git.remove_worktree(&run.repo, &run.workdir);
            let _ = git.delete_branch(&run.repo, &run.branch);
        }
        store.runs.retain(|r| r.id != id);
        inner.save(&store);
        return Err(error);
    }
    if let Some(live) = store.live.get_mut(&id) {
        live.queued += 1;
        live.session.send_user(task)?;
    }
    inner.user_said(&id, task);
    inner.changed(&store, &id);
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn start_run(
    app: AppHandle,
    window: WebviewWindow,
    projects: State<'_, ProjectState>,
    trust: State<'_, TrustState>,
    accounts: State<'_, AccountsState>,
    settings: State<'_, SettingsState>,
    runs: State<'_, RunsState>,
    account: String,
    task: String,
    base: String,
    options: RunOptions,
) -> Result<RunView, CommandError> {
    let task = task.trim().to_string();
    if task.is_empty() || task.len() > MAX_TASK_BYTES {
        return Err(CommandError::InvalidInput);
    }
    let options = options.checked()?;
    // Looked up by id: the webview never names a config folder.
    let config_dir = accounts.config_dir(&account)?;
    let folder = ensure_trusted(
        &app,
        &projects,
        window.label(),
        &trust,
        "Trust and Start Run",
    )?;
    let project_name = projects.name_and_path(window.label())?.0;
    let inner = &runs.0;
    let id = create_run(
        inner,
        &folder,
        project_name,
        &account,
        &task,
        &base,
        options,
        &settings.current(),
        config_dir.as_deref(),
    )?;
    accounts.set_last_used(&account);
    let store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_of(&store, &id)?;
    // Made from the trusted project, by Claudine, so it's trusted too.
    if run.has_worktree {
        trust.trust(&run.workdir)?;
    }
    Ok(run.view(store.live.get(&id)))
}

#[tauri::command]
pub fn list_runs(runs: State<'_, RunsState>) -> Result<Vec<RunView>, CommandError> {
    let store = runs.0.store.lock().map_err(|_| CommandError::Internal)?;
    Ok(store
        .runs
        .iter()
        .rev()
        .map(|r| r.view(store.live.get(&r.id)))
        .collect())
}

/// Starts sending run updates to the webview. A new call replaces the old listener.
#[tauri::command]
pub fn watch_runs(runs: State<'_, RunsState>, on_update: Channel<RunUpdate>) {
    if let Ok(mut listener) = runs.0.listener.lock() {
        *listener = Some(on_update);
    }
}

/// The run's conversation so far, as the events it recorded.
#[tauri::command(async)]
pub fn run_transcript(runs: State<'_, RunsState>, id: String) -> Result<Vec<Value>, CommandError> {
    {
        let store = runs.0.store.lock().map_err(|_| CommandError::Internal)?;
        run_of(&store, &id)?;
    }
    let text = fs::read_to_string(runs.0.transcript_file(&id)).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(MAX_TRANSCRIPT_LINES);
    Ok(lines[start..]
        .iter()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}

/// Changes a run's mode, model or effort. A running `claude` switches mode and model at
/// once, by control message; effort, and anything set while it's stopped, apply at the next
/// launch.
#[tauri::command(async)]
pub fn set_run_options(
    runs: State<'_, RunsState>,
    id: String,
    options: RunOptions,
) -> Result<(), CommandError> {
    let options = options.checked()?;
    let inner = &runs.0;
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let record = run_mut(&mut store, &id)?;
    // Nothing more runs once a run is approved or applied.
    if matches!(record.state, RunState::Approved | RunState::Applied) {
        return Err(CommandError::WrongState);
    }
    if let Some(mode) = options.mode {
        record.mode = Some(mode);
    }
    if let Some(model) = &options.model {
        record.model = Some(model.clone());
    }
    // `claude` takes effort only at start, so it applies from the run's next launch.
    if let Some(effort) = options.effort {
        record.effort = Some(effort);
    }
    if let Some(live) = store.live.get(&id) {
        if let Some(mode) = options.mode {
            let claude = inner.claude_path.clone().or_else(find_claude);
            let auto = claude.is_some_and(|c| supports_auto_mode(&c));
            live.session.control(
                "mode",
                serde_json::json!({ "subtype": "set_permission_mode", "mode": mode_flag(mode, auto) }),
            )?;
        }
        if let Some(model) = &options.model {
            live.session.control(
                "model",
                serde_json::json!({ "subtype": "set_model", "model": model }),
            )?;
        }
    }
    inner.save(&store);
    inner.changed(&store, &id);
    Ok(())
}

/// Sends a message to a run. While it works, Claude reads it at its next step. In review,
/// it starts a new revision.
#[tauri::command(async)]
pub fn send_run_message(
    runs: State<'_, RunsState>,
    id: String,
    text: String,
) -> Result<(), CommandError> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }
    if text.len() > MAX_TASK_BYTES {
        return Err(CommandError::TooLarge);
    }
    let inner = &runs.0;
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_of(&store, &id)?.clone();
    match run.state {
        RunState::Running | RunState::Paused => {}
        RunState::Review | RunState::Interrupted => {
            let record = run_mut(&mut store, &id)?;
            if record.state == RunState::Review {
                record.revision += 1;
            }
            record.state = RunState::Running;
            record.note = None;
            record.started_at = now();
            record.finished_at = None;
            let config_dir = inner.config_dir(&run.account);
            launch(inner, &mut store, &id, config_dir.as_deref())?;
        }
        _ => return Err(CommandError::WrongState),
    }
    if run.state == RunState::Paused
        && let Ok(record) = run_mut(&mut store, &id)
    {
        record.state = RunState::Running;
        record.note = None;
    }
    let live = store.live.get_mut(&id).ok_or(CommandError::NoSession)?;
    live.session.send_user(&text)?;
    live.queued += 1;
    inner.user_said(&id, &text);
    inner.changed(&store, &id);
    Ok(())
}

#[tauri::command(async)]
pub fn answer_run_permission(
    runs: State<'_, RunsState>,
    id: String,
    request: String,
    allow: bool,
) -> Result<(), CommandError> {
    let inner = &runs.0;
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let live = store.live.get_mut(&id).ok_or(CommandError::NoSession)?;
    live.session.answer(&request, allow)?;
    live.permissions.retain(|p| p.id != request);
    inner.changed(&store, &id);
    Ok(())
}

/// Stops a run: ends Claude's turn and moves on to the review with what's there.
#[tauri::command(async)]
pub fn stop_run(runs: State<'_, RunsState>, id: String) -> Result<(), CommandError> {
    runs.0.stop(&id, Some("Stopped by you.".to_string()))
}

/// Continues an interrupted run in the same Claude Code session.
#[tauri::command(async)]
pub fn resume_run(runs: State<'_, RunsState>, id: String) -> Result<(), CommandError> {
    let inner = &runs.0;
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_of(&store, &id)?.clone();
    if !run.state.can_become(RunState::Running) || run.state == RunState::Review {
        return Err(CommandError::WrongState);
    }
    if !run.workdir.exists() {
        return Err(CommandError::NotFound);
    }
    let config_dir = inner.config_dir(&run.account);
    launch(inner, &mut store, &id, config_dir.as_deref())?;
    let record = run_mut(&mut store, &id)?;
    record.state = RunState::Running;
    record.note = None;
    record.started_at = now();
    let message = if run.session_id.is_some() {
        "Continue where you left off."
    } else {
        run.task.as_str()
    };
    let live = store.live.get_mut(&id).ok_or(CommandError::NoSession)?;
    live.session.send_user(message)?;
    live.queued += 1;
    inner.user_said(&id, message);
    inner.changed(&store, &id);
    Ok(())
}

/// An interrupted run's "Review what's there": finish it as it is.
#[tauri::command(async)]
pub fn review_run_now(runs: State<'_, RunsState>, id: String) -> Result<(), CommandError> {
    {
        let store = runs.0.store.lock().map_err(|_| CommandError::Internal)?;
        if run_of(&store, &id)?.state != RunState::Interrupted {
            return Err(CommandError::WrongState);
        }
    }
    runs.0.begin_finishing(&id);
    Ok(())
}

/// The run's changes against its base, and since the last review when there was one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunChanges {
    files: Vec<FileDiff>,
    since_last_review: Option<Vec<FileDiff>>,
}

#[tauri::command(async)]
pub fn run_changes(runs: State<'_, RunsState>, id: String) -> Result<RunChanges, CommandError> {
    changes(&runs.0, &id)
}

fn changes(inner: &Inner, id: &str) -> Result<RunChanges, CommandError> {
    let run = {
        let store = inner.store.lock().map_err(|_| CommandError::Internal)?;
        run_of(&store, id)?.clone()
    };
    let git = Git::find()?;
    let tree = inner.current_tree(&git, &run)?;
    let files = git.diff(&run.repo, &run.base_commit, &tree)?;
    // The latest snapshot from an earlier revision, against the work now.
    let previous = run
        .snapshots
        .iter()
        .filter(|s| s.revision < run.revision)
        .max_by_key(|s| s.revision)
        .or_else(|| {
            // In review, the current revision's snapshot is the last one; compare the one before.
            let mut sorted: Vec<&Snapshot> = run.snapshots.iter().collect();
            sorted.sort_by_key(|s| s.revision);
            sorted.iter().rev().nth(1).copied()
        });
    let since_last_review = match previous {
        Some(snapshot) => Some(git.diff(&run.repo, &snapshot.tree, &tree)?),
        None => None,
    };
    let stats = stats_of(&files);
    if let Ok(mut store) = inner.store.lock()
        && let Ok(record) = run_mut(&mut store, id)
        && record.stats != stats
    {
        record.stats = stats;
        inner.changed(&store, id);
    }
    Ok(RunChanges {
        files,
        since_last_review,
    })
}

#[tauri::command]
pub fn add_run_comment(
    runs: State<'_, RunsState>,
    id: String,
    path: String,
    line: u32,
    side: String,
    body: String,
) -> Result<(), CommandError> {
    add_comment(&runs.0, &id, path, line, side, body)
}

fn add_comment(
    inner: &Inner,
    id: &str,
    path: String,
    line: u32,
    side: String,
    body: String,
) -> Result<(), CommandError> {
    let body = body.trim().to_string();
    if body.is_empty() || body.len() > MAX_COMMENT_BYTES || path.len() > 1000 {
        return Err(CommandError::InvalidInput);
    }
    if side != "new" && side != "old" {
        return Err(CommandError::InvalidInput);
    }
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_mut(&mut store, id)?;
    if run.comments.len() >= MAX_COMMENTS {
        return Err(CommandError::InvalidInput);
    }
    let comment = Comment {
        id: format!("c{}", run.next_comment),
        path,
        line,
        side,
        body,
        revision: run.revision,
        state: CommentState::Pending,
        reply: None,
    };
    run.next_comment += 1;
    run.comments.push(comment);
    inner.changed(&store, id);
    Ok(())
}

#[tauri::command]
pub fn delete_run_comment(
    runs: State<'_, RunsState>,
    id: String,
    comment: String,
) -> Result<(), CommandError> {
    let inner = &runs.0;
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_mut(&mut store, &id)?;
    // Only comments not yet sent can be taken back.
    run.comments
        .retain(|c| !(c.id == comment && c.state == CommentState::Pending));
    inner.changed(&store, &id);
    Ok(())
}

/// Marks a file viewed at its current diff (`hash`), or not viewed.
#[tauri::command]
pub fn set_run_viewed(
    runs: State<'_, RunsState>,
    id: String,
    path: String,
    hash: Option<String>,
) -> Result<(), CommandError> {
    if path.len() > 1000 || hash.as_ref().is_some_and(|h| h.len() > 64) {
        return Err(CommandError::InvalidInput);
    }
    let inner = &runs.0;
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_mut(&mut store, &id)?;
    match hash {
        Some(hash) => {
            run.viewed.insert(path, hash);
        }
        None => {
            run.viewed.remove(&path);
        }
    }
    inner.changed(&store, &id);
    Ok(())
}

/// Sends the pending comments and the note to Claude, starting the next revision.
#[tauri::command(async)]
pub fn request_run_changes(
    runs: State<'_, RunsState>,
    id: String,
    note: String,
) -> Result<(), CommandError> {
    request_changes(&runs.0, &id, &note)
}

fn request_changes(inner: &Arc<Inner>, id: &str, note: &str) -> Result<(), CommandError> {
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    let run = run_of(&store, id)?.clone();
    if run.state != RunState::Review {
        return Err(CommandError::WrongState);
    }
    let pending: Vec<&Comment> = run
        .comments
        .iter()
        .filter(|c| c.state == CommentState::Pending)
        .collect();
    if pending.is_empty() && note.trim().is_empty() {
        return Err(CommandError::InvalidInput);
    }
    let message = changes_request(run.revision, &pending, note);
    let config_dir = inner.config_dir(&run.account);
    launch(inner, &mut store, id, config_dir.as_deref())?;
    let record = run_mut(&mut store, id)?;
    for comment in record
        .comments
        .iter_mut()
        .filter(|c| c.state == CommentState::Pending)
    {
        comment.state = CommentState::Sent;
    }
    record.review_note = Some(cut(note.trim(), MAX_NOTE_CHARS)).filter(|n| !n.is_empty());
    record.revision += 1;
    record.state = RunState::Running;
    record.note = None;
    record.started_at = now();
    record.finished_at = None;
    record.checks.clear();
    let live = store.live.get_mut(id).ok_or(CommandError::NoSession)?;
    live.session.send_user(&message)?;
    live.queued += 1;
    inner.user_said(id, &message);
    inner.changed(&store, id);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    installed: bool,
    signed_in: bool,
}

#[tauri::command(async)]
pub fn gh_status() -> GhStatus {
    match git::find_gh() {
        Some(gh) => GhStatus {
            installed: true,
            signed_in: git::gh_signed_in(&gh),
        },
        None => GhStatus {
            installed: false,
            signed_in: false,
        },
    }
}

/// Approves a reviewed run: commits in the worktree, then, unless `commit_only`, pushes
/// the branch and opens a pull request. Rust confirms with a native dialog first.
#[tauri::command(async)]
pub fn approve_run(
    app: AppHandle,
    runs: State<'_, RunsState>,
    settings: State<'_, SettingsState>,
    id: String,
    commit_only: bool,
) -> Result<RunView, CommandError> {
    let inner = &runs.0;
    let run = {
        let store = inner.store.lock().map_err(|_| CommandError::Internal)?;
        run_of(&store, &id)?.clone()
    };
    if run.state != RunState::Review {
        return Err(CommandError::WrongState);
    }
    let open_pr = !commit_only && settings.current().on_approve == OnApprove::Pr;
    let gh = if open_pr {
        let gh = git::find_gh().ok_or(CommandError::GhUnavailable)?;
        if !git::gh_signed_in(&gh) {
            return Err(CommandError::GhUnavailable);
        }
        Some(gh)
    } else {
        None
    };
    let title = run
        .explanation
        .as_ref()
        .map_or_else(|| run.title.clone(), |e| e.title.clone());
    let message = if open_pr {
        format!(
            "Commit Claude's changes, push {} to origin, and open a pull request into {}?\n\n“{title}”",
            run.branch, run.base
        )
    } else {
        format!("Commit Claude's changes to {}?\n\n“{title}”", run.branch)
    };
    let button = if open_pr {
        "Push and Open PR"
    } else {
        "Commit"
    };
    if !confirm(&app, "Approve this run?", message, button) {
        return Err(CommandError::Cancelled);
    }

    let git = Git::find()?;
    let body = pr_body(&run);
    let summary: String = run
        .explanation
        .as_ref()
        .map(|e| {
            e.summary
                .iter()
                .map(|s| format!("{}: {}", s.heading, s.text))
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_else(|| run.task.clone());
    let committed = git.commit_all(&run.workdir, &title, &summary)?;
    if !committed && !git.has_commits(&run.repo, &run.base_commit, &run.branch)? {
        return Err(CommandError::Git {
            detail: "There are no changes to commit.".to_string(),
        });
    }
    let mut pr_url = None;
    if let Some(gh) = gh {
        git.push(&run.workdir, &run.branch)?;
        pr_url = Some(git::gh_pr_create(
            &gh,
            &run.repo,
            &run.base,
            &run.branch,
            &title,
            &body,
        )?);
    }
    // The branch keeps the work. Removing the worktree frees the branch to be checked out.
    if run.has_worktree {
        let _ = git.remove_worktree(&run.repo, &run.workdir);
    }
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    store.live.remove(&id);
    let record = run_mut(&mut store, &id)?;
    record.state = RunState::Approved;
    record.note = Some(match &pr_url {
        Some(_) => format!("Pushed {} and opened a pull request.", record.branch),
        None => format!("Committed to {}.", record.branch),
    });
    record.pr_url = pr_url;
    inner.changed(&store, &id);
    let run = run_of(&store, &id)?;
    Ok(run.view(None))
}

/// Deletes a run's worktree and branch, after a native confirmation.
#[tauri::command(async)]
pub fn discard_run(
    app: AppHandle,
    runs: State<'_, RunsState>,
    id: String,
) -> Result<(), CommandError> {
    let inner = &runs.0;
    let run = {
        let store = inner.store.lock().map_err(|_| CommandError::Internal)?;
        run_of(&store, &id)?.clone()
    };
    if !run.state.can_discard() && run.state != RunState::Approved {
        return Err(CommandError::WrongState);
    }
    let what = if run.state == RunState::Approved {
        "Remove this run from the list? Its branch and any pull request stay.".to_string()
    } else if run.has_worktree {
        format!(
            "Delete the worktree and the branch {}? Claude's changes in it will be lost.",
            run.branch
        )
    } else {
        format!(
            "Remove this run? It worked in the project folder, so its changes and the branch {} stay there.",
            run.branch
        )
    };
    if !confirm(&app, "Discard this run?", what, "Discard") {
        return Err(CommandError::Cancelled);
    }
    discard(inner, &run)
}

/// Ends the run's process, deletes its worktree and branch, and forgets it.
fn discard(inner: &Inner, run: &RunRecord) -> Result<(), CommandError> {
    {
        let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
        store.live.remove(&run.id);
    }
    if run.has_worktree && run.state != RunState::Approved {
        let git = Git::find()?;
        // Only ever the run's own worktree folder, inside Claudine's data folder.
        let worktrees = inner
            .worktrees
            .canonicalize()
            .unwrap_or_else(|_| inner.worktrees.clone());
        if run.workdir.starts_with(&worktrees) {
            git.remove_worktree(&run.repo, &run.workdir)?;
        }
        git.delete_branch(&run.repo, &run.branch)?;
    }
    let mut store = inner.store.lock().map_err(|_| CommandError::Internal)?;
    store.runs.retain(|r| r.id != run.id);
    inner.save(&store);
    let _ = fs::remove_dir_all(inner.runs_dir.join(&run.id));
    inner.emit(RunUpdate::Removed { id: run.id.clone() });
    Ok(())
}

/// Opens the run's worktree as the project in Editor mode, in the window that asked.
#[tauri::command(async)]
pub fn open_run_in_editor(
    window: WebviewWindow,
    projects: State<'_, ProjectState>,
    sessions: State<'_, crate::claude::SessionState>,
    runs: State<'_, RunsState>,
    id: String,
) -> Result<crate::project::ProjectInfo, CommandError> {
    let run = {
        let store = runs.0.store.lock().map_err(|_| CommandError::Internal)?;
        run_of(&store, &id)?.clone()
    };
    if !run.workdir.exists() {
        return Err(CommandError::NotFound);
    }
    let name = format!("{} · {}", run.project_name, run.branch);
    projects.open_folder(&window, &run.workdir, name, &sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comment(id: &str, path: &str, line: u32, body: &str, state: CommentState) -> Comment {
        Comment {
            id: id.to_string(),
            path: path.to_string(),
            line,
            side: "new".to_string(),
            body: body.to_string(),
            revision: 1,
            state,
            reply: None,
        }
    }

    #[test]
    fn modes_map_to_claude_code_names_and_models_are_checked() {
        assert_eq!(mode_flag(RunPermissions::Auto, true), "auto");
        assert_eq!(mode_flag(RunPermissions::Auto, false), "acceptEdits");
        assert_eq!(mode_flag(RunPermissions::Plan, true), "plan");
        assert_eq!(mode_flag(RunPermissions::Ask, true), "default");
        assert!(valid_model("opus"));
        assert!(valid_model("claude-sonnet-5-5"));
        assert!(valid_model("opus[1m]"));
        assert!(!valid_model(""));
        assert!(!valid_model("opus --dangerously-skip-permissions"));
        assert!(!valid_model(&"a".repeat(65)));
    }

    #[test]
    fn runs_move_only_along_the_allowed_transitions() {
        use RunState::*;
        assert!(Running.can_become(Finishing));
        assert!(Running.can_become(Paused));
        assert!(Paused.can_become(Running));
        assert!(Finishing.can_become(Review));
        assert!(Finishing.can_become(Applied));
        assert!(Review.can_become(Running));
        assert!(Review.can_become(Approved));
        assert!(Interrupted.can_become(Running));
        assert!(Interrupted.can_become(Finishing));

        assert!(!Running.can_become(Review));
        assert!(!Running.can_become(Approved));
        assert!(!Review.can_become(Finishing));
        assert!(!Approved.can_become(Running));
        assert!(!Applied.can_become(Running));
        assert!(!Finishing.can_become(Approved));

        assert!(Review.can_discard());
        assert!(!Running.can_discard());
        assert!(!Finishing.can_discard());
    }

    #[test]
    fn working_runs_come_back_interrupted() {
        let dir = std::env::temp_dir().join(format!("claudine-runs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("runs")).unwrap();
        let record = serde_json::json!([{
            "id": "r1", "title": "t", "task": "t", "account": "default", "repo": "/tmp/x",
            "projectName": "x", "base": "main", "baseCommit": "abc", "branch": "claudine/t",
            "workdir": "/tmp/x", "hasWorktree": true, "sessionId": null, "state": "running",
            "note": null, "revision": 1, "createdAt": 1, "startedAt": 1, "finishedAt": null,
            "turns": 0, "plan": [], "comments": [], "nextComment": 1, "viewed": {}, "checks": [],
            "explanation": null, "snapshots": [], "stats": {"files": 0, "additions": 0,
            "deletions": 0, "paths": []}, "prUrl": null, "reviewNote": null
        }]);
        fs::write(dir.join("runs/runs.json"), record.to_string()).unwrap();
        let state = RunsState::load(&dir);
        let store = state.0.store.lock().unwrap();
        assert_eq!(store.runs[0].state, RunState::Interrupted);
        assert!(store.runs[0].note.is_some());
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_explanation_is_read_from_a_reply_with_extra_text() {
        let reply = r#"Here it is:
```json
{"title": "Add split diff tests", "summary": [{"heading": "What changed", "text": "Two tests."}],
 "files": [{"path": "tests/diff_spec.rs", "explanation": "Adds a test.", "risk": "none"},
           {"path": "src/a.rs", "explanation": "  "}]}
```"#;
        let parsed = parse_explanation(reply).unwrap();
        assert_eq!(parsed.title, "Add split diff tests");
        assert_eq!(parsed.files.len(), 1);
        // "none" isn't a risk.
        assert_eq!(parsed.files[0].risk, None);
        let paths = vec!["tests/diff_spec.rs".to_string(), "src/a.rs".to_string()];
        assert_eq!(missing_files(&parsed, &paths), vec!["src/a.rs".to_string()]);
    }

    #[test]
    fn invalid_explanations_are_refused_with_a_reason() {
        assert!(parse_explanation("Sorry, I can't.").is_err());
        assert!(parse_explanation(r#"{"title": "x"}"#).is_err());
        assert!(parse_explanation(r#"{"title": "", "summary": [], "files": []}"#).is_err());
        let no_summary = r#"{"title": "x", "summary": [], "files": []}"#;
        assert_eq!(parse_explanation(no_summary).unwrap_err(), "no summary");
    }

    #[test]
    fn a_retry_fills_in_the_missing_files() {
        let first = parse_explanation(
            r#"{"title": "t", "summary": [{"heading": "h", "text": "x"}],
                "files": [{"path": "a.rs", "explanation": "A."}]}"#,
        )
        .unwrap();
        let retry = parse_explanation(
            r#"{"title": "t", "summary": [{"heading": "h", "text": "x"}],
                "files": [{"path": "b.rs", "explanation": "B."}]}"#,
        )
        .unwrap();
        let merged = merge_explanations(first, retry);
        let paths = vec!["a.rs".to_string(), "b.rs".to_string()];
        assert!(missing_files(&merged, &paths).is_empty());
    }

    #[test]
    fn the_explanation_request_lists_files_and_comments() {
        let sent = comment("c2", "src/a.rs", 3, "Use a guard", CommentState::Sent);
        let message = explain_request(&["src/a.rs".to_string()], &[&sent], false);
        assert!(message.contains("- src/a.rs\n"));
        assert!(message.contains("- c2: src/a.rs:3 — Use a guard"));
        assert!(message.contains("\"replies\""));
        assert!(explain_request(&[], &[], true).starts_with("That wasn't"));
    }

    #[test]
    fn requesting_changes_lists_each_comment_then_the_note() {
        let a = comment(
            "c1",
            "src/session/pool.rs",
            14,
            "Lock per account,\nnot global",
            CommentState::Pending,
        );
        let b = comment(
            "c2",
            "tests/pool_spec.rs",
            3,
            "Name this test",
            CommentState::Pending,
        );
        let message = changes_request(1, &[&a, &b], " Looks close. ");
        assert_eq!(
            message,
            "Review comments (revision 1):\n\
             - src/session/pool.rs:14 — Lock per account, not global\n\
             - tests/pool_spec.rs:3 — Name this test\n\
             Overall: Looks close.\n\
             Address each one, then stop."
        );
        assert!(!changes_request(2, &[&a], "").contains("Overall"));
    }

    #[test]
    fn sent_comments_are_resolved_with_their_replies() {
        let mut comments = vec![
            comment("c1", "a.rs", 1, "x", CommentState::Sent),
            comment("c2", "a.rs", 2, "y", CommentState::Pending),
            comment("c3", "a.rs", 3, "z", CommentState::Sent),
        ];
        let replies = vec![Reply {
            id: "c1".to_string(),
            reply: "Done.".to_string(),
        }];
        resolve_comments(&mut comments, &replies);
        assert_eq!(comments[0].state, CommentState::Resolved);
        assert_eq!(comments[0].reply.as_deref(), Some("Done."));
        assert_eq!(comments[1].state, CommentState::Pending);
        assert_eq!(comments[2].state, CommentState::Resolved);
        assert_eq!(comments[2].reply, None);
    }

    #[test]
    fn ask_rules_cover_pushes_installs_and_the_deny_list() {
        let rules = ask_rules(&["terraform apply".to_string()]);
        assert!(rules.contains(&"Bash(git push:*)".to_string()));
        assert!(rules.contains(&"Bash(npm install:*)".to_string()));
        assert!(rules.contains(&"Bash(terraform apply:*)".to_string()));
        assert!(rules.contains(&"Bash(terraform apply)".to_string()));
    }

    #[test]
    fn titles_come_from_the_first_line() {
        assert_eq!(title_for("\n  Fix the pool\nmore detail"), "Fix the pool");
        assert_eq!(
            title_for(&"x".repeat(100)).chars().count(),
            MAX_TITLE_CHARS + 1
        );
    }

    #[test]
    fn checks_are_detected_from_the_project() {
        let (_, repo) = crate::git::tests::temp_repo("checks");
        fs::write(repo.join("Cargo.toml"), "[package]\n").unwrap();
        fs::write(
            repo.join("package.json"),
            r#"{"scripts": {"test": "vitest"}}"#,
        )
        .unwrap();
        fs::write(repo.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(detect_checks(&repo), vec!["cargo test", "pnpm test"]);
        let result = run_check(&repo, "echo hello && exit 3");
        assert!(!result.passed);
        assert_eq!(result.tail, "hello");
        let _ = fs::remove_dir_all(&repo);
    }

    /// A stand-in for `claude`. It counts the messages it gets in a file next to itself,
    /// so a resumed run carries on: 1 writes a file, 2 and 4 explain, 3 changes the file.
    const FAKE_CLAUDE: &str = r#"#!/bin/sh
if [ "$1" = "--help" ]; then echo '--permission-mode <mode> (choices: "default")'; exit 0; fi
dir=$(dirname "$0")
while IFS= read -r line; do
  case "$line" in *'"control_request"'*) continue ;; esac
  n=$(( $(cat "$dir/count" 2>/dev/null || echo 0) + 1 ))
  echo $n > "$dir/count"
  echo '{"type":"user","message":{"role":"user","content":"echo"}}'
  case $n in
    1)
      echo '{"type":"system","subtype":"init","model":"fake","session_id":"s-1"}'
      echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"Write hello","status":"completed"}]}}]}}'
      printf 'hello\n' > hello.txt
      echo '{"type":"result","is_error":false,"num_turns":1}' ;;
    3)
      printf 'HELLO\n' > hello.txt
      echo '{"type":"result","is_error":false,"num_turns":3}' ;;
    *)
      echo '{"type":"assistant","message":{"content":[{"type":"text","text":"{\"title\":\"Add hello\",\"summary\":[{\"heading\":\"What changed\",\"text\":\"Hello.\"}],\"files\":[{\"path\":\"hello.txt\",\"explanation\":\"Says hello.\"}],\"replies\":[{\"id\":\"c1\",\"reply\":\"Made it louder.\"}]}"}]}}'
      echo '{"type":"result","is_error":false,"num_turns":2}' ;;
  esac
done
"#;

    fn wait_until(what: &str, inner: &Inner, id: &str, done: impl Fn(&RunRecord) -> bool) {
        let start = std::time::Instant::now();
        loop {
            {
                let store = inner.store.lock().unwrap();
                if done(run_of(&store, id).unwrap()) {
                    return;
                }
            }
            assert!(
                start.elapsed() < Duration::from_secs(20),
                "timed out: {what}"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn a_run_goes_from_task_to_review_and_through_a_revision() {
        use std::os::unix::fs::PermissionsExt;
        let (git, repo) = crate::git::tests::temp_repo("run");
        let data = repo.with_extension("data");
        fs::create_dir_all(&data).unwrap();
        let fake = data.join("fake-claude");
        fs::write(&fake, FAKE_CLAUDE).unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        let mut state = RunsState::load(&data);
        Arc::get_mut(&mut state.0).unwrap().claude_path = Some(fake);
        let inner = &state.0;

        let settings = Settings::default();
        let id = create_run(
            inner,
            &repo,
            "repo".to_string(),
            "default",
            "Say hello",
            "main",
            RunOptions::default(),
            &settings,
            None,
        )
        .unwrap();
        wait_until("first review", inner, &id, |r| r.state == RunState::Review);
        {
            let store = inner.store.lock().unwrap();
            let run = run_of(&store, &id).unwrap();
            assert_eq!(run.branch, "claudine/say-hello");
            assert_eq!(run.session_id.as_deref(), Some("s-1"));
            assert_eq!(run.plan.len(), 1);
            assert_eq!(run.explanation.as_ref().unwrap().title, "Add hello");
            assert_eq!(run.stats.files, 1);
            assert_eq!(run.snapshots.len(), 1);
            // The process isn't kept while the user reviews.
            assert!(!store.live.contains_key(&id));
        }
        // The main checkout didn't change.
        assert!(!repo.join("hello.txt").exists());
        let first = changes(inner, &id).unwrap();
        assert_eq!(first.files[0].path, "hello.txt");
        assert!(first.since_last_review.is_none());

        add_comment(
            inner,
            &id,
            "hello.txt".to_string(),
            1,
            "new".to_string(),
            "Louder".to_string(),
        )
        .unwrap();
        request_changes(inner, &id, "").unwrap();
        wait_until("second review", inner, &id, |r| {
            r.state == RunState::Review && r.revision == 2
        });
        let run = {
            let store = inner.store.lock().unwrap();
            run_of(&store, &id).unwrap().clone()
        };
        assert_eq!(run.comments[0].state, CommentState::Resolved);
        assert_eq!(run.comments[0].reply.as_deref(), Some("Made it louder."));
        let second = changes(inner, &id).unwrap();
        let since = second.since_last_review.unwrap();
        assert_eq!(since.len(), 1);
        assert_eq!((since[0].additions, since[0].deletions), (1, 1));

        discard(inner, &run).unwrap();
        assert!(!run.workdir.exists());
        assert!(!git.branch_exists(&repo, &run.branch).unwrap());
        assert!(inner.store.lock().unwrap().runs.is_empty());
        let _ = fs::remove_dir_all(&repo);
        let _ = fs::remove_dir_all(&data);
    }

    /// The same flow with the real `claude`, on the default account. It costs a little,
    /// so it only runs when asked: `cargo test -p my-editor-desktop real_claude -- --ignored`.
    #[test]
    #[ignore]
    fn real_claude_run_reaches_review_with_explanations() {
        let (_, repo) = crate::git::tests::temp_repo("real");
        let data = repo.with_extension("data");
        let state = RunsState::load(&data);
        let inner = &state.0;
        let task =
            "Create a file named hello.txt containing the single line: hi there. Nothing else.";
        let id = create_run(
            inner,
            &repo,
            "repo".to_string(),
            "default",
            task,
            "main",
            RunOptions::default(),
            &Settings::default(),
            None,
        )
        .unwrap();
        let start = std::time::Instant::now();
        loop {
            let state = inner.store.lock().unwrap().runs[0].state;
            if state == RunState::Review || state == RunState::Interrupted {
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(240),
                "timed out in {state:?}"
            );
            thread::sleep(Duration::from_millis(500));
        }
        let run = inner.store.lock().unwrap().runs[0].clone();
        println!("state {:?} note {:?}", run.state, run.note);
        println!("session {:?} plan {:?}", run.session_id, run.plan);
        println!("explanation {:#?}", run.explanation);
        println!("stats {:?}", run.stats);
        let transcript = fs::read_to_string(inner.transcript_file(&id)).unwrap_or_default();
        println!("transcript:\n{transcript}");
        assert_eq!(run.state, RunState::Review);
        assert_eq!(run.stats.paths, vec!["hello.txt".to_string()]);
        let explanation = run.explanation.as_ref().expect("an explanation");
        assert!(missing_files(explanation, &run.stats.paths).is_empty());
        discard(inner, &run).unwrap();
        let _ = fs::remove_dir_all(&repo);
        let _ = fs::remove_dir_all(&data);
    }
}
