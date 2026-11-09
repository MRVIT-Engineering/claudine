//! Claude accounts. Each account is its own Claude Code config folder.
//!
//! `claude` keeps its login, settings and history in one config folder: `~/.claude`, or
//! the folder in `CLAUDE_CONFIG_DIR`. On macOS the login itself is a Keychain entry
//! named after that folder, so a second folder is a second, separate login. Claudine
//! runs `claude auth login`, `status` and `logout` for a folder and never sees a token.
//!
//! The webview only ever sends an account id. Rust picks the folder,
//! `<app data>/accounts/<id>`, and only for ids in its own list.

use crate::claude::{SessionState, find_claude, keep_tail, spawn_error, wait_for_exit};
use crate::error::CommandError;
use crate::settings::write_atomic;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use tauri::State;
use tauri::ipc::Channel;

/// The user's own `~/.claude` login, the one `claude` uses in a terminal.
pub const DEFAULT_ID: &str = "default";
const COLORS: [&str; 5] = ["blue", "pink", "violet", "green", "amber"];
const MAX_LABEL_CHARS: usize = 40;
/// Ids are a slug of the label, plus `-2` and so on when it's taken.
const MAX_SLUG_CHARS: usize = 24;
const MAX_ID_CHARS: usize = 32;
const MAX_ACCOUNTS: usize = 20;
const MAX_CODE_BYTES: usize = 2_048;
const MAX_LINK_BYTES: usize = 4_096;
const MAX_STATUS_CHARS: usize = 200;
/// Each of these would sign every account in as the same user, whatever its folder.
const CREDENTIAL_VARS: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Account {
    id: String,
    label: String,
    color: String,
}

fn default_account() -> Account {
    Account {
        id: DEFAULT_ID.to_string(),
        label: "Default".to_string(),
        color: "violet".to_string(),
    }
}

/// The file's shape. Only labels and colors are kept: no emails, no tokens.
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountsFile {
    #[serde(default)]
    accounts: Vec<Account>,
    #[serde(default)]
    last_used: Option<String>,
}

impl AccountsFile {
    /// Drops what a broken or hand-edited file could add: bad or repeated ids, empty
    /// labels and unknown colors.
    fn sanitized(self) -> AccountsFile {
        let mut accounts: Vec<Account> = Vec::new();
        for account in self.accounts {
            let repeated = accounts.iter().any(|a| a.id == account.id);
            if !valid_id(&account.id) || repeated || accounts.len() == MAX_ACCOUNTS {
                continue;
            }
            let Some(label) = clean_label(&account.label) else {
                continue;
            };
            accounts.push(Account {
                id: account.id,
                label,
                color: clean_color(&account.color),
            });
        }
        let last_used = self
            .last_used
            .filter(|id| id == DEFAULT_ID || accounts.iter().any(|a| &a.id == id));
        AccountsFile {
            accounts,
            last_used,
        }
    }
}

/// What the webview gets: every account, and which one to preselect.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountList {
    /// The default account first, then the user's, in the order they were added.
    accounts: Vec<Account>,
    last_used: String,
}

/// Lowercase letters, digits and `-`, so an id can never name another folder.
fn valid_id(id: &str) -> bool {
    id != DEFAULT_ID
        && id.len() <= MAX_ID_CHARS
        && id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn clean_label(label: &str) -> Option<String> {
    let label: String = label
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LABEL_CHARS)
        .collect();
    let label = label.trim();
    (!label.is_empty()).then(|| label.to_string())
}

fn clean_color(color: &str) -> String {
    if COLORS.contains(&color) {
        color.to_string()
    } else {
        COLORS[0].to_string()
    }
}

/// "My Work" becomes `my-work`, or `my-work-2` if `taken` says that's in use.
fn new_id(label: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut slug = String::new();
    for c in label.chars() {
        if slug.len() == MAX_SLUG_CHARS {
            break;
        }
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    let base = if slug.is_empty() { "account" } else { slug };
    let mut id = base.to_string();
    let mut n = 2;
    while id == DEFAULT_ID || taken(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Only the user can open it. It will hold the account's settings and, on Linux, its
/// login.
#[cfg(unix)]
fn create_private_dir(path: &Path) -> io::Result<()> {
    // LEARN: an extension trait adds Unix-only methods, like `mode`, to a std type.
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
}

#[cfg(not(unix))]
fn create_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)
}

/// Points a `claude` command at an account's config folder. `None` is the default
/// account, which uses `claude`'s own folder.
pub fn use_account(command: &mut Command, config_dir: Option<&Path>) {
    match config_dir {
        Some(folder) => {
            command.env("CLAUDE_CONFIG_DIR", folder);
            for var in CREDENTIAL_VARS {
                command.env_remove(var);
            }
        }
        // Set when the app was started from a shell that chose a folder; "Default"
        // should always mean `~/.claude`.
        None => {
            command.env_remove("CLAUDE_CONFIG_DIR");
        }
    }
    // Set when the app itself was started from a Claude Code session.
    command.env_remove("CLAUDECODE");
}

/// A running `claude auth login`. Dropping it ends the process.
struct SignIn {
    account: String,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
}

impl Drop for SignIn {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub struct AccountsState {
    file: PathBuf,
    /// One config folder per account. Also the working folder for `claude auth`, so it
    /// never reads a project's `.claude/` settings.
    folders: PathBuf,
    data: Mutex<AccountsFile>,
    sign_in: Mutex<Option<SignIn>>,
}

impl AccountsState {
    /// Loads from the app's own folders. A missing or broken file means no accounts
    /// besides the default one.
    pub fn load(file: PathBuf, folders: PathBuf) -> AccountsState {
        let data = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<AccountsFile>(&text).ok())
            .unwrap_or_default()
            .sanitized();
        AccountsState {
            file,
            folders,
            data: Mutex::new(data),
            sign_in: Mutex::new(None),
        }
    }

    // LEARN: `'_` says the guard borrows from `self`, so it can't outlive this `AccountsState`.
    fn data(&self) -> Result<MutexGuard<'_, AccountsFile>, CommandError> {
        self.data.lock().map_err(|_| CommandError::Internal)
    }

    fn save(&self, data: &AccountsFile) -> Result<(), CommandError> {
        let text = serde_json::to_string_pretty(data).map_err(io::Error::other)?;
        Ok(write_atomic(&self.file, &text)?)
    }

    fn list(&self) -> Result<AccountList, CommandError> {
        let data = self.data()?;
        let mut accounts = vec![default_account()];
        accounts.extend(data.accounts.iter().cloned());
        let last_used = data.last_used.as_deref().unwrap_or(DEFAULT_ID).to_string();
        Ok(AccountList {
            accounts,
            last_used,
        })
    }

    /// The config folder for `id`, or `None` for the default account. Ids that aren't
    /// in the list are refused, so the webview can't name a folder.
    pub fn config_dir(&self, id: &str) -> Result<Option<PathBuf>, CommandError> {
        if id == DEFAULT_ID {
            return Ok(None);
        }
        let data = self.data()?;
        if data.accounts.iter().any(|a| a.id == id) {
            Ok(Some(self.folders.join(id)))
        } else {
            Err(CommandError::NotFound)
        }
    }

    /// Remembers the account a session started on, to preselect it next time.
    pub fn set_last_used(&self, id: &str) {
        let Ok(mut data) = self.data() else { return };
        if data.last_used.as_deref() != Some(id) {
            data.last_used = Some(id.to_string());
            let _ = self.save(&data);
        }
    }

    fn add(&self, label: &str, color: &str) -> Result<Account, CommandError> {
        let label = clean_label(label).ok_or(CommandError::InvalidInput)?;
        let mut data = self.data()?;
        if data.accounts.len() >= MAX_ACCOUNTS {
            return Err(CommandError::TooManyAccounts);
        }
        // A folder left behind by a failed removal may still hold a login: don't reuse it.
        let id = new_id(&label, |id| {
            data.accounts.iter().any(|a| a.id == id)
                || fs::symlink_metadata(self.folders.join(id)).is_ok()
        });
        create_private_dir(&self.folders.join(&id))?;
        let account = Account {
            id,
            label,
            color: clean_color(color),
        };
        data.accounts.push(account.clone());
        self.save(&data)?;
        Ok(account)
    }

    fn update(&self, id: &str, label: &str, color: &str) -> Result<Account, CommandError> {
        let label = clean_label(label).ok_or(CommandError::InvalidInput)?;
        let mut data = self.data()?;
        let Some(account) = data.accounts.iter_mut().find(|a| a.id == id) else {
            // Includes the default account, whose label and color are fixed.
            return Err(CommandError::NotFound);
        };
        account.label = label;
        account.color = clean_color(color);
        let updated = account.clone();
        self.save(&data)?;
        Ok(updated)
    }

    /// Takes the account off the list, then deletes its folder.
    fn remove(&self, id: &str) -> Result<(), CommandError> {
        let mut data = self.data()?;
        let before = data.accounts.len();
        data.accounts.retain(|a| a.id != id);
        if data.accounts.len() == before {
            return Err(CommandError::NotFound);
        }
        if data.last_used.as_deref() == Some(id) {
            data.last_used = None;
        }
        self.save(&data)?;
        match fs::remove_dir_all(self.folders.join(id)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Runs `claude auth <args>` for one account and waits for it.
    fn run_auth(
        &self,
        claude: &Path,
        config_dir: Option<&Path>,
        args: &[&str],
    ) -> Result<Output, CommandError> {
        create_private_dir(&self.folders)?;
        self.check_auth_command(claude)?;
        let mut command = Command::new(claude);
        command
            .arg("auth")
            .args(args)
            .current_dir(&self.folders)
            .stdin(Stdio::null());
        use_account(&mut command, config_dir);
        command.output().map_err(spawn_error)
    }

    /// Versions without `claude auth` (2.1.17 has none) read `auth status` as a prompt
    /// and start a whole session. `--help` never does, so ask it first.
    fn check_auth_command(&self, claude: &Path) -> Result<(), CommandError> {
        let mut command = Command::new(claude);
        command
            .args(["auth", "--help"])
            .current_dir(&self.folders)
            .stdin(Stdio::null());
        use_account(&mut command, None);
        let output = command.output().map_err(spawn_error)?;
        if is_auth_help(&String::from_utf8_lossy(&output.stdout)) {
            Ok(())
        } else {
            Err(CommandError::ClaudeTooOld)
        }
    }

    fn cancel_sign_in(&self, account: Option<&str>) {
        if let Ok(mut current) = self.sign_in.lock() {
            let matches = match account {
                Some(id) => current.as_ref().is_some_and(|s| s.account == id),
                None => true,
            };
            if matches {
                // Dropping the `SignIn` ends its process.
                *current = None;
            }
        }
    }
}

/// What `claude auth status --json` says, without the ids and folders it also prints.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    signed_in: bool,
    email: Option<String>,
    /// The subscription, such as "pro" or "max".
    plan: Option<String>,
    /// "claude.ai" for a subscription; other values mean API billing.
    method: Option<String>,
}

fn parse_status(text: &str) -> Option<AuthStatus> {
    let value: Value = serde_json::from_str(text).ok()?;
    let field = |key: &str| {
        value[key]
            .as_str()
            .filter(|text| !text.is_empty() && *text != "none")
            .map(|text| text.chars().take(MAX_STATUS_CHARS).collect::<String>())
    };
    Some(AuthStatus {
        signed_in: value["loggedIn"].as_bool()?,
        email: field("email"),
        plan: field("subscriptionType"),
        method: field("authMethod"),
    })
}

/// What the webview hears while signing in.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SignInEvent {
    /// The link `claude` opened in the browser, to copy if the browser didn't open.
    Link { url: String },
    Done {
        signed_in: bool,
        message: Option<String>,
    },
}

/// `claude` prints its sign-in link as a terminal hyperlink, wrapped in escape codes.
fn find_link(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let link: String = line[start..]
        .chars()
        .take_while(|c| !c.is_whitespace() && !c.is_control())
        .collect();
    (link.len() <= MAX_LINK_BYTES).then_some(link)
}

/// Newer versions print `Usage: claude auth …`; older ones print the main help.
fn is_auth_help(help: &str) -> bool {
    help.trim_start().starts_with("Usage: claude auth")
}

/// A code from the sign-in page. No spaces or newlines, which would answer more than
/// one of `claude`'s prompts.
fn valid_code(code: &str) -> bool {
    !code.is_empty() && code.len() <= MAX_CODE_BYTES && code.chars().all(|c| c.is_ascii_graphic())
}

#[tauri::command]
pub fn list_accounts(accounts: State<'_, AccountsState>) -> Result<AccountList, CommandError> {
    accounts.list()
}

#[tauri::command]
pub fn add_account(
    accounts: State<'_, AccountsState>,
    label: String,
    color: String,
) -> Result<Account, CommandError> {
    accounts.add(&label, &color)
}

#[tauri::command]
pub fn update_account(
    accounts: State<'_, AccountsState>,
    account: String,
    label: String,
    color: String,
) -> Result<Account, CommandError> {
    accounts.update(&account, &label, &color)
}

/// Signs the account out, so its Keychain entry is deleted, then removes its folder.
/// Stops its session first.
#[tauri::command(async)]
pub fn remove_account(
    accounts: State<'_, AccountsState>,
    sessions: State<'_, SessionState>,
    account: String,
) -> Result<(), CommandError> {
    let config_dir = accounts
        .config_dir(&account)?
        .ok_or(CommandError::InvalidInput)?;
    let claude = find_claude().ok_or(CommandError::ClaudeNotFound)?;
    sessions.stop_account(&account);
    accounts.cancel_sign_in(Some(&account));
    let output = accounts.run_auth(&claude, Some(&config_dir), &["logout"])?;
    if !output.status.success() {
        // Keep the account, so the user can try again rather than leave a login behind.
        return Err(CommandError::SignOutFailed);
    }
    accounts.remove(&account)
}

#[tauri::command(async)]
pub fn account_status(
    accounts: State<'_, AccountsState>,
    account: String,
) -> Result<AuthStatus, CommandError> {
    let config_dir = accounts.config_dir(&account)?;
    let claude = find_claude().ok_or(CommandError::ClaudeNotFound)?;
    let output = accounts.run_auth(&claude, config_dir.as_deref(), &["status", "--json"])?;
    // It exits with 1 when signed out, so the output is read either way.
    parse_status(&String::from_utf8_lossy(&output.stdout)).ok_or(CommandError::Io {
        detail: "Claude Code's sign-in status couldn't be read".to_string(),
    })
}

/// Starts `claude auth login`, which opens the browser. Events arrive on `on_event`
/// until it ends. Only one sign-in runs at a time.
#[tauri::command(async)]
pub fn sign_in(
    accounts: State<'_, AccountsState>,
    account: String,
    console: bool,
    on_event: Channel<SignInEvent>,
) -> Result<(), CommandError> {
    let config_dir = accounts.config_dir(&account)?;
    let claude = find_claude().ok_or(CommandError::ClaudeNotFound)?;
    accounts.cancel_sign_in(None);
    if let Some(folder) = &config_dir {
        create_private_dir(folder)?;
    }
    create_private_dir(&accounts.folders)?;
    accounts.check_auth_command(&claude)?;

    let mut command = Command::new(&claude);
    command.args(["auth", "login"]);
    if console {
        command.arg("--console");
    }
    command
        .current_dir(&accounts.folders)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    use_account(&mut command, config_dir.as_deref());
    let mut child = command.spawn().map_err(spawn_error)?;
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill();
        return Err(CommandError::Internal);
    };

    let child = Arc::new(Mutex::new(child));
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    let tail = Arc::clone(&stderr_tail);
    thread::spawn(move || keep_tail(stderr, &tail));

    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let mut sent_link = false;
        let mut last_line = String::new();
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if !sent_link && let Some(url) = find_link(&line) {
                sent_link = true;
                let _ = on_event.send(SignInEvent::Link { url });
            } else if !line.trim().is_empty() {
                last_line = line.trim().chars().take(MAX_STATUS_CHARS).collect();
            }
        }
        let signed_in = wait_for_exit(&waiter) == Some(0);
        let message = if signed_in {
            None
        } else {
            let stderr = stderr_tail
                .lock()
                .map(|t| t.trim().to_string())
                .unwrap_or_default();
            let text = if stderr.is_empty() { last_line } else { stderr };
            (!text.is_empty()).then_some(text)
        };
        let _ = on_event.send(SignInEvent::Done { signed_in, message });
    });

    let mut current = accounts
        .sign_in
        .lock()
        .map_err(|_| CommandError::Internal)?;
    *current = Some(SignIn {
        account,
        child,
        stdin: Arc::new(Mutex::new(stdin)),
    });
    Ok(())
}

/// Passes the code from the sign-in page, for when the browser couldn't reach Claudine.
#[tauri::command(async)]
pub fn submit_sign_in_code(
    accounts: State<'_, AccountsState>,
    code: String,
) -> Result<(), CommandError> {
    let code = code.trim();
    if !valid_code(code) {
        return Err(CommandError::InvalidInput);
    }
    let stdin = {
        let current = accounts
            .sign_in
            .lock()
            .map_err(|_| CommandError::Internal)?;
        let sign_in = current.as_ref().ok_or(CommandError::NoSession)?;
        Arc::clone(&sign_in.stdin)
    };
    let mut stdin = stdin.lock().map_err(|_| CommandError::Internal)?;
    stdin
        .write_all(format!("{code}\n").as_bytes())
        .and_then(|()| stdin.flush())
        .map_err(|error| match error.kind() {
            io::ErrorKind::BrokenPipe => CommandError::NoSession,
            other => CommandError::from(other),
        })
}

#[tauri::command]
pub fn cancel_sign_in(accounts: State<'_, AccountsState>) {
    accounts.cancel_sign_in(None);
}

/// Signs an added account out. The default account is shared with Claude Code in the
/// terminal, so it's signed out there, not here.
#[tauri::command(async)]
pub fn sign_out(
    accounts: State<'_, AccountsState>,
    sessions: State<'_, SessionState>,
    account: String,
) -> Result<(), CommandError> {
    let config_dir = accounts
        .config_dir(&account)?
        .ok_or(CommandError::InvalidInput)?;
    let claude = find_claude().ok_or(CommandError::ClaudeNotFound)?;
    sessions.stop_account(&account);
    let output = accounts.run_auth(&claude, Some(&config_dir), &["logout"])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(CommandError::SignOutFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state(name: &str) -> (AccountsState, PathBuf) {
        let dir = std::env::temp_dir().join(format!("accounts-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let state = AccountsState::load(dir.join("accounts.json"), dir.join("accounts"));
        (state, dir)
    }

    #[test]
    fn ids_are_slugs_that_never_repeat() {
        let none = |_: &str| false;
        assert_eq!(new_id("Work", none), "work");
        assert_eq!(new_id("  My Work, Ltd. ", none), "my-work-ltd");
        assert_eq!(new_id("日本", none), "account");
        assert_eq!(new_id("../../etc", none), "etc");
        assert_eq!(new_id("Default", none), "default-2");
        assert_eq!(
            new_id("Work", |id| id == "work" || id == "work-2"),
            "work-3"
        );
        let long = new_id(&"a".repeat(100), none);
        assert_eq!(long.len(), MAX_SLUG_CHARS);
        for id in ["work", "my-work-ltd", "account", "default-2", long.as_str()] {
            assert!(valid_id(id), "{id}");
        }
    }

    #[test]
    fn ids_that_could_name_another_folder_are_invalid() {
        for id in [
            "", "default", "..", "../x", "a/b", "-a", "Work", "a.b", "a b",
        ] {
            assert!(!valid_id(id), "{id:?}");
        }
    }

    #[test]
    fn a_hand_edited_file_is_cleaned_up() {
        let file: AccountsFile = serde_json::from_str(
            r#"{
                "accounts": [
                    { "id": "work", "label": " Work ", "color": "pink" },
                    { "id": "work", "label": "Again", "color": "pink" },
                    { "id": "../home", "label": "Escape", "color": "blue" },
                    { "id": "default", "label": "Mine", "color": "blue" },
                    { "id": "blank", "label": "   ", "color": "blue" },
                    { "id": "odd", "label": "Odd", "color": "url(evil)" }
                ],
                "lastUsed": "../home"
            }"#,
        )
        .unwrap();
        let clean = file.sanitized();
        let ids: Vec<&str> = clean.accounts.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, ["work", "odd"]);
        assert_eq!(clean.accounts[0].label, "Work");
        assert_eq!(clean.accounts[1].color, "blue");
        assert_eq!(clean.last_used, None);
    }

    #[test]
    fn accounts_are_saved_with_a_private_folder_each() {
        use std::os::unix::fs::PermissionsExt;
        let (state, dir) = temp_state("saved");
        let work = state.add("Work", "pink").unwrap();
        assert_eq!(work.id, "work");
        let folder = state.config_dir("work").unwrap().unwrap();
        assert_eq!(folder, dir.join("accounts/work"));
        let mode = fs::metadata(&folder).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);

        state.update("work", "Job", "green").unwrap();
        state.set_last_used("work");
        let reloaded = AccountsState::load(dir.join("accounts.json"), dir.join("accounts"));
        let list = reloaded.list().unwrap();
        assert_eq!(list.accounts[0], default_account());
        assert_eq!(list.accounts[1].label, "Job");
        assert_eq!(list.accounts[1].color, "green");
        assert_eq!(list.last_used, "work");
    }

    #[test]
    fn only_listed_ids_have_a_folder() {
        let (state, _dir) = temp_state("lookup");
        assert_eq!(state.config_dir(DEFAULT_ID), Ok(None));
        assert_eq!(state.config_dir("work"), Err(CommandError::NotFound));
        assert_eq!(state.config_dir("../.."), Err(CommandError::NotFound));
        assert_eq!(
            state.update(DEFAULT_ID, "Mine", "blue"),
            Err(CommandError::NotFound)
        );
        assert_eq!(state.add(" \n ", "blue"), Err(CommandError::InvalidInput));
    }

    #[test]
    fn removing_deletes_the_folder_and_a_leftover_folder_is_not_reused() {
        let (state, dir) = temp_state("remove");
        state.add("Work", "blue").unwrap();
        state.set_last_used("work");
        state.remove("work").unwrap();
        assert!(!dir.join("accounts/work").exists());
        assert_eq!(state.list().unwrap().last_used, DEFAULT_ID);
        assert_eq!(state.remove("work"), Err(CommandError::NotFound));

        // As if an earlier removal had failed after signing out.
        fs::create_dir_all(dir.join("accounts/work")).unwrap();
        assert_eq!(state.add("Work", "blue").unwrap().id, "work-2");
    }

    fn env_seen(config_dir: Option<&Path>) -> String {
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            r#"printf '%s|%s' "$CLAUDE_CONFIG_DIR" "$ANTHROPIC_API_KEY""#,
        ]);
        // As if the app had inherited both from the shell that started it.
        command
            .env("CLAUDE_CONFIG_DIR", "/elsewhere")
            .env("ANTHROPIC_API_KEY", "sk-shared");
        use_account(&mut command, config_dir);
        String::from_utf8(command.output().unwrap().stdout).unwrap()
    }

    #[test]
    fn an_account_gets_its_folder_and_no_shared_key() {
        assert_eq!(env_seen(Some(Path::new("/acct/work"))), "/acct/work|");
        assert_eq!(env_seen(None), "|sk-shared");
    }

    #[test]
    fn the_status_json_is_read() {
        // Shapes from `claude auth status --json` in 2.1.309, trimmed.
        let signed_in = r#"{ "loggedIn": true, "authMethod": "claude.ai",
            "email": "me@example.com", "subscriptionType": "pro",
            "configDirectory": "/Users/me/.claude" }"#;
        assert_eq!(
            parse_status(signed_in),
            Some(AuthStatus {
                signed_in: true,
                email: Some("me@example.com".to_string()),
                plan: Some("pro".to_string()),
                method: Some("claude.ai".to_string()),
            })
        );
        let signed_out = r#"{ "loggedIn": false, "authMethod": "none" }"#;
        assert_eq!(parse_status(signed_out), Some(AuthStatus::default()));
        assert_eq!(parse_status("Not logged in"), None);
        assert_eq!(parse_status("{}"), None);
    }

    #[test]
    fn the_sign_in_link_is_found_inside_its_escape_codes() {
        let line = "If the browser didn't open, visit: \u{1b}]8;;https://claude.com/cai/oauth/authorize?code=true&state=x\u{7}https://claude.com/cai/oauth/authorize?code=true&state=x\u{1b}]8;;\u{7}";
        assert_eq!(
            find_link(line).as_deref(),
            Some("https://claude.com/cai/oauth/authorize?code=true&state=x")
        );
        assert_eq!(find_link("Opening browser to sign in…"), None);
    }

    #[test]
    fn only_the_auth_commands_own_help_counts() {
        // From 2.1.309 and 2.1.17.
        assert!(is_auth_help(
            "Usage: claude auth [options] [command]\n\nManage authentication"
        ));
        assert!(!is_auth_help(
            "Usage: claude [options] [command] [prompt]\n\nClaude Code"
        ));
        assert!(!is_auth_help(""));
    }

    #[test]
    fn a_code_cannot_carry_a_second_answer() {
        assert!(valid_code("abc123#state-XYZ_"));
        for code in [
            "",
            "abc\ny",
            "abc def",
            "abc\u{1b}[A",
            &"a".repeat(MAX_CODE_BYTES + 1),
        ] {
            assert!(!valid_code(code), "{code:?}");
        }
    }
}
