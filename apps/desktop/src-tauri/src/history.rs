//! The Git panel: uncommitted changes, a file's history and recent commits, like GitLens.
//! Every git command here only reads. Paths go through the path guard, and commit ids must
//! be hex, so the webview can't pass git an option.

use crate::error::CommandError;
use crate::files::MAX_FILE_BYTES;
use crate::git::Git;
use crate::project::ProjectState;
use crate::proposal::Proposal;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{State, WebviewWindow};

/// The most commits one list shows.
const MAX_COMMITS: usize = 200;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: String,
    pub short: String,
    pub author: String,
    /// Whether the author's email is the user's own `user.email`.
    pub is_you: bool,
    /// Seconds since the Unix epoch.
    pub time: u64,
    pub subject: String,
}

/// A changed file: its path relative to the project, and git's one-letter status
/// (`M`odified, `A`dded, `D`eleted, `R`enamed, `?` untracked).
#[derive(Debug, PartialEq, Serialize)]
pub struct Change {
    pub path: String,
    pub status: String,
}

/// The open project's folder and git, or `None` when it isn't in a repository.
fn repo(
    window: &WebviewWindow,
    state: &ProjectState,
) -> Result<Option<(Git, PathBuf)>, CommandError> {
    let (_, folder) = state.name_and_path(window.label())?;
    let Ok(git) = Git::find() else {
        return Ok(None);
    };
    if git.repo_root(&folder).is_err() {
        return Ok(None);
    }
    Ok(Some((git, folder)))
}

/// A path the webview sent, checked by the guard, as git should see it from the folder.
fn checked_path(
    window: &WebviewWindow,
    state: &ProjectState,
    raw: &str,
) -> Result<String, CommandError> {
    let path = state.check_read_path(window.label(), raw)?;
    path.to_str()
        .map(str::to_string)
        .ok_or(CommandError::InvalidPath)
}

/// Whether `id` looks like a commit id: 4 to 40 hex digits, so it can't be an option.
fn valid_commit(id: &str) -> bool {
    (4..=40).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit())
}

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';

/// Reads `git log` written with [`LOG_FORMAT`].
fn parse_log(out: &str, me: &str) -> Vec<Commit> {
    out.split(RECORD)
        .filter_map(|record| {
            let mut fields = record.trim_start_matches('\n').split(FIELD);
            let id = fields.next()?.to_string();
            if id.is_empty() {
                return None;
            }
            let short = fields.next()?.to_string();
            let author = fields.next()?.to_string();
            let mail = fields.next()?;
            let time = fields.next()?.parse().unwrap_or(0);
            let subject = fields.next().unwrap_or("").to_string();
            Some(Commit {
                id,
                short,
                author,
                is_you: !me.is_empty() && mail.eq_ignore_ascii_case(me),
                time,
                subject,
            })
        })
        .collect()
}

const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e";

/// Reads `--name-status -z` output: a status, then one path, or two for renames and copies.
fn parse_name_status(out: &str) -> Vec<Change> {
    let mut parts = out.split('\0').filter(|p| !p.is_empty());
    let mut changes = Vec::new();
    while let Some(status) = parts.next() {
        let letter = status.chars().next().unwrap_or('M').to_string();
        let path = if letter == "R" || letter == "C" {
            parts.next();
            parts.next()
        } else {
            parts.next()
        };
        if let Some(path) = path {
            changes.push(Change {
                path: path.to_string(),
                status: letter,
            });
        }
    }
    changes
}

/// Recent commits: the whole folder's, or one file's (following renames) when `path` is set.
#[tauri::command(async)]
pub fn git_log(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    path: Option<String>,
) -> Result<Vec<Commit>, CommandError> {
    let Some((git, folder)) = repo(&window, &state)? else {
        return Ok(Vec::new());
    };
    let limit = format!("-n{MAX_COMMITS}");
    let checked = path
        .map(|raw| checked_path(&window, &state, &raw))
        .transpose()?;
    let mut args = vec!["log", LOG_FORMAT, &limit];
    match &checked {
        Some(file) => args.extend(["--follow", "--", file.as_str()]),
        // Only commits that touched this folder, when it's part of a bigger repository.
        None => args.extend(["--", "."]),
    }
    // A repository with no commits yet has no log.
    let Ok(out) = git.run(&folder, &args) else {
        return Ok(Vec::new());
    };
    let me = git
        .run(&folder, &["config", "user.email"])
        .unwrap_or_default();
    Ok(parse_log(&out, me.trim()))
}

/// The files a commit changed, inside the open folder.
#[tauri::command(async)]
pub fn git_commit_files(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    commit: String,
) -> Result<Vec<Change>, CommandError> {
    if !valid_commit(&commit) {
        return Err(CommandError::InvalidInput);
    }
    let Some((git, folder)) = repo(&window, &state)? else {
        return Ok(Vec::new());
    };
    let out = git.run(
        &folder,
        &[
            "show",
            "--name-status",
            "-z",
            "--format=",
            "--relative",
            &commit,
            "--",
        ],
    )?;
    Ok(parse_name_status(&out))
}

/// Uncommitted changes in the open folder, staged or not, and untracked files.
#[tauri::command(async)]
pub fn git_status(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
) -> Result<Vec<Change>, CommandError> {
    let Some((git, folder)) = repo(&window, &state)? else {
        return Ok(Vec::new());
    };
    // Paths relative to the folder, like the rest of the app.
    let out = git.run(
        &folder,
        &["diff", "HEAD", "--name-status", "-z", "--relative", "--"],
    );
    // No commits yet: everything is new, and shows as untracked below.
    let mut changes = out.map(|o| parse_name_status(&o)).unwrap_or_default();
    let untracked = git.run(
        &folder,
        &["ls-files", "-z", "--others", "--exclude-standard"],
    )?;
    changes.extend(
        untracked
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(|path| Change {
                path: path.to_string(),
                status: "?".to_string(),
            }),
    );
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(changes)
}

/// A file's text at a commit, or `""` when it didn't exist there.
fn file_at(git: &Git, folder: &std::path::Path, spec: &str) -> Result<String, CommandError> {
    let Ok(text) = git.run(folder, &["show", spec]) else {
        return Ok(String::new());
    };
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(CommandError::TooLarge);
    }
    if text.contains('\0') {
        return Err(CommandError::NotText);
    }
    Ok(text)
}

/// One file's change: in `commit` (its parent to it), or, without a commit, from the last
/// commit to the file on disk now.
#[tauri::command(async)]
pub fn git_diff(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    commit: Option<String>,
    path: String,
) -> Result<Proposal, CommandError> {
    if commit.as_deref().is_some_and(|c| !valid_commit(c)) {
        return Err(CommandError::InvalidInput);
    }
    let file = checked_path(&window, &state, &path)?;
    let Some((git, folder)) = repo(&window, &state)? else {
        return Err(CommandError::NotARepository);
    };
    // `./` makes the path relative to the folder, not the repository's top.
    let (before, after) = match &commit {
        Some(id) => (
            file_at(&git, &folder, &format!("{id}^:./{file}"))?,
            file_at(&git, &folder, &format!("{id}:./{file}"))?,
        ),
        None => {
            let now = match state.read_file(window.label(), &file) {
                Ok(read) => read.text,
                Err(CommandError::NotFound) => String::new(),
                Err(error) => return Err(error),
            };
            (file_at(&git, &folder, &format!("HEAD:./{file}"))?, now)
        }
    };
    Ok(Proposal {
        path,
        before,
        after,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_ids_are_hex_only() {
        assert!(valid_commit("1a2b3c4d"));
        assert!(valid_commit(&"f".repeat(40)));
        assert!(!valid_commit("abc"));
        assert!(!valid_commit("--output=/tmp/x"));
        assert!(!valid_commit("HEAD"));
        assert!(!valid_commit(&"a".repeat(41)));
    }

    #[test]
    fn log_and_name_status_are_parsed() {
        let out = format!(
            "aaaa{FIELD}aa{FIELD}Ada{FIELD}ada@x.com{FIELD}1700000000{FIELD}Fix it{RECORD}\n\
             bbbb{FIELD}bb{FIELD}Bob{FIELD}bob@x.com{FIELD}1600000000{FIELD}{RECORD}\n"
        );
        let log = parse_log(&out, "ADA@x.com");
        assert_eq!(log.len(), 2);
        assert!(log[0].is_you);
        assert_eq!(log[0].subject, "Fix it");
        assert_eq!(log[1].author, "Bob");
        assert!(!log[1].is_you);

        let changes = parse_name_status("M\0a.rs\0R100\0old.rs\0new.rs\0D\0gone.rs\0");
        let got: Vec<(&str, &str)> = changes
            .iter()
            .map(|c| (c.status.as_str(), c.path.as_str()))
            .collect();
        assert_eq!(got, [("M", "a.rs"), ("R", "new.rs"), ("D", "gone.rs")]);
    }
}
