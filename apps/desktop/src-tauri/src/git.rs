//! Runs the user's own `git` (and `gh`) for Agentic runs.
//!
//! Every command that changes anything runs inside a run's own worktree, or on the run's
//! own branch. The user's main checkout is only ever read, plus `git worktree add`, which
//! creates the run's branch and folder without touching the checked-out files.

use crate::error::CommandError;
use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// More changed files than this are left out of a diff.
const MAX_FILES: usize = 300;
/// Diff lines per file before the rest is cut.
const MAX_LINES_PER_FILE: usize = 3_000;
/// Characters per diff line before it's cut.
const MAX_LINE_CHARS: usize = 2_000;
/// Branch slugs are cut to this many characters.
const MAX_SLUG: usize = 28;

/// Finds an executable by name on `PATH`, then in the usual install folders.
/// Relative `PATH` entries are skipped, so a project can't supply its own `git`.
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for folder in std::env::split_paths(&path).filter(|folder| folder.is_absolute()) {
            candidates.push(folder.join(name));
        }
    }
    for folder in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        candidates.push(Path::new(folder).join(name));
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// A git error, with the user's home folder shortened to `~`.
fn git_error(output: &Output) -> CommandError {
    let text = String::from_utf8_lossy(&output.stderr);
    let mut detail = text
        .lines()
        .rfind(|line| !line.trim().is_empty())
        .unwrap_or("git failed")
        .to_string();
    if let Some(home) = std::env::var_os("HOME") {
        let home = home.to_string_lossy().into_owned();
        if !home.is_empty() {
            detail = detail.replace(&home, "~");
        }
    }
    CommandError::Git { detail }
}

/// The user's `git`, run with a clean environment for one repository.
pub struct Git {
    bin: PathBuf,
}

impl Git {
    pub fn find() -> Result<Git, CommandError> {
        find_tool("git")
            .map(|bin| Git { bin })
            .ok_or(CommandError::GitNotFound)
    }

    fn command(&self, dir: &Path, args: &[&str]) -> Command {
        let mut command = Command::new(&self.bin);
        command
            .current_dir(dir)
            // Paths with non-ASCII characters stay readable instead of octal escapes.
            .args(["-c", "core.quotePath=false"])
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .stdin(Stdio::null());
        command
    }

    fn output(&self, mut command: Command) -> Result<Output, CommandError> {
        command.output().map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => CommandError::GitNotFound,
            other => CommandError::from(other),
        })
    }

    /// Runs `git args` in `dir` and returns its stdout, or the error it printed.
    pub fn run(&self, dir: &Path, args: &[&str]) -> Result<String, CommandError> {
        self.run_with(dir, args, &[])
    }

    fn run_with(
        &self,
        dir: &Path,
        args: &[&str],
        env: &[(&str, &OsStr)],
    ) -> Result<String, CommandError> {
        let mut command = self.command(dir, args);
        for (key, value) in env {
            command.env(key, value);
        }
        let output = self.output(command)?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(git_error(&output))
        }
    }

    /// Whether `git args` exits with 0, for questions like "does this branch exist".
    fn succeeds(&self, dir: &Path, args: &[&str]) -> Result<bool, CommandError> {
        Ok(self.output(self.command(dir, args))?.status.success())
    }

    /// The top folder of the repository `dir` is in.
    pub fn repo_root(&self, dir: &Path) -> Result<PathBuf, CommandError> {
        let root = self
            .run(dir, &["rev-parse", "--show-toplevel"])
            .map_err(|_| CommandError::NotARepository)?;
        Ok(PathBuf::from(root.trim_end_matches(['\n', '\r'])))
    }

    /// Gitignored files and folders under `dir`, relative to it, `/`-separated. An ignored
    /// folder is listed once, without what's inside it.
    pub fn ignored(&self, dir: &Path) -> Result<HashSet<String>, CommandError> {
        let out = self.run(
            dir,
            &[
                "ls-files",
                "-z",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
            ],
        )?;
        Ok(out
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(|path| path.trim_end_matches('/').to_string())
            .collect())
    }

    /// Who last changed line `line` (1-based) of `path`, relative to `dir`. With `contents`,
    /// git blames that text instead of the file on disk, so an edited buffer's line numbers
    /// still match. Read-only. `None` when the file isn't tracked or the line doesn't exist.
    pub fn blame_line(
        &self,
        dir: &Path,
        path: &str,
        line: u32,
        contents: Option<&str>,
    ) -> Result<Option<Blame>, CommandError> {
        let range = format!("{line},{line}");
        let mut args = vec!["blame", "--porcelain", "-L", &range];
        if contents.is_some() {
            args.extend(["--contents", "-"]);
        }
        // `--` so a path can never be read as an option.
        args.extend(["--", path]);
        let mut command = self.command(dir, &args);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if contents.is_some() {
            command.stdin(Stdio::piped());
        }
        let mut child = command.spawn().map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => CommandError::GitNotFound,
            other => CommandError::from(other),
        })?;
        if let (Some(text), Some(mut stdin)) = (contents, child.stdin.take()) {
            // From its own thread, so a full pipe can't block both sides.
            let text = text.to_string();
            std::thread::spawn(move || {
                use std::io::Write;
                let _ = stdin.write_all(text.as_bytes());
            });
        }
        let output = child.wait_with_output()?;
        if !output.status.success() {
            return Ok(None);
        }
        let me = self.run(dir, &["config", "user.email"]).unwrap_or_default();
        Ok(parse_blame(
            &String::from_utf8_lossy(&output.stdout),
            me.trim(),
        ))
    }

    /// The checked-out branch, or `None` when HEAD is detached.
    pub fn current_branch(&self, dir: &Path) -> Result<Option<String>, CommandError> {
        if !self.succeeds(dir, &["symbolic-ref", "--quiet", "HEAD"])? {
            return Ok(None);
        }
        let name = self.run(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
        Ok(Some(name.trim().to_string()))
    }

    /// Local branch names, for the base branch picker.
    pub fn branches(&self, dir: &Path) -> Result<Vec<String>, CommandError> {
        let out = self.run(
            dir,
            &[
                "for-each-ref",
                "--format=%(refname:short)",
                "--sort=-committerdate",
                "refs/heads/",
            ],
        )?;
        Ok(out
            .lines()
            .map(str::to_string)
            .filter(|s| !s.is_empty())
            .take(200)
            .collect())
    }

    /// Whether `name` is a valid branch name, by git's own rules.
    pub fn valid_branch(&self, dir: &Path, name: &str) -> Result<bool, CommandError> {
        if name.starts_with('-') || name.len() > 200 {
            return Ok(false);
        }
        self.succeeds(dir, &["check-ref-format", "--branch", name])
    }

    pub fn branch_exists(&self, dir: &Path, name: &str) -> Result<bool, CommandError> {
        let reference = format!("refs/heads/{name}");
        self.succeeds(dir, &["show-ref", "--verify", "--quiet", &reference])
    }

    /// The commit a branch points at, as a full hash.
    pub fn commit_of(&self, dir: &Path, branch: &str) -> Result<String, CommandError> {
        let reference = format!("refs/heads/{branch}^{{commit}}");
        let out = self.run(dir, &["rev-parse", "--verify", "--quiet", &reference])?;
        Ok(out.trim().to_string())
    }

    /// A branch name under `prefix` that doesn't exist yet: `slug`, then `slug-2`, …
    pub fn unique_branch(
        &self,
        dir: &Path,
        prefix: &str,
        slug: &str,
    ) -> Result<String, CommandError> {
        for n in 1..1000 {
            let name = if n == 1 {
                format!("{prefix}{slug}")
            } else {
                format!("{prefix}{slug}-{n}")
            };
            if !self.valid_branch(dir, &name)? {
                return Err(CommandError::InvalidInput);
            }
            if !self.branch_exists(dir, &name)? {
                return Ok(name);
            }
        }
        Err(CommandError::InvalidInput)
    }

    /// Creates `branch` at `base` and checks it out in a new worktree at `path`.
    /// The main checkout's files and branch stay as they are.
    pub fn add_worktree(
        &self,
        repo: &Path,
        path: &Path,
        branch: &str,
        base: &str,
    ) -> Result<(), CommandError> {
        let path = path.to_string_lossy();
        self.run(repo, &["worktree", "add", "-b", branch, &path, base])?;
        Ok(())
    }

    /// Creates and checks out `branch` in the main checkout, keeping any changes there.
    /// Only for runs without a worktree; `switch -c` never discards work.
    pub fn switch_new_branch(&self, repo: &Path, branch: &str) -> Result<(), CommandError> {
        self.run(repo, &["switch", "-c", branch])?;
        Ok(())
    }

    /// Removes a run's worktree, with whatever is in it. Only ever called with a path
    /// inside the app's own worktrees folder.
    pub fn remove_worktree(&self, repo: &Path, path: &Path) -> Result<(), CommandError> {
        let shown = path.to_string_lossy();
        let removed = self.run(repo, &["worktree", "remove", "--force", &shown]);
        // A folder already deleted by hand leaves only an entry to prune.
        self.run(repo, &["worktree", "prune"])?;
        if removed.is_err() && path.exists() {
            return removed.map(|_| ());
        }
        Ok(())
    }

    /// Deletes a run's branch. Only ever called with the run's own branch name.
    pub fn delete_branch(&self, repo: &Path, branch: &str) -> Result<(), CommandError> {
        if self.branch_exists(repo, branch)? {
            self.run(repo, &["branch", "-D", branch])?;
        }
        Ok(())
    }

    /// Everything in the worktree as a git tree, untracked files included, through a
    /// temporary index. The worktree's own index, which Claude may be using, isn't touched.
    pub fn snapshot(&self, worktree: &Path, index_file: &Path) -> Result<String, CommandError> {
        let _ = std::fs::remove_file(index_file);
        let env = [("GIT_INDEX_FILE", index_file.as_os_str())];
        self.run_with(worktree, &["read-tree", "HEAD"], &env)?;
        self.run_with(worktree, &["add", "-A"], &env)?;
        let tree = self.run_with(worktree, &["write-tree"], &env)?;
        let _ = std::fs::remove_file(index_file);
        Ok(tree.trim().to_string())
    }

    /// The changes from `from` to `to`, commits or trees, file by file.
    pub fn diff(&self, dir: &Path, from: &str, to: &str) -> Result<Vec<FileDiff>, CommandError> {
        let numstat = self.run(
            dir,
            &[
                "diff",
                "--no-ext-diff",
                "--find-renames",
                "--numstat",
                "-z",
                from,
                to,
            ],
        )?;
        let patch = self.run(
            dir,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--find-renames",
                "--unified=3",
                from,
                to,
            ],
        )?;
        Ok(build_diff(&parse_numstat(&numstat), &patch))
    }

    /// Stages everything and commits it. Returns `false` when there was nothing to commit.
    pub fn commit_all(&self, dir: &Path, subject: &str, body: &str) -> Result<bool, CommandError> {
        self.run(dir, &["add", "-A"])?;
        if self.succeeds(dir, &["diff", "--cached", "--quiet"])? {
            return Ok(false);
        }
        let mut args = vec!["commit", "-m", subject];
        if !body.trim().is_empty() {
            args.extend(["-m", body]);
        }
        self.run(dir, &args)?;
        Ok(true)
    }

    /// Whether `branch` has commits that `base` doesn't.
    pub fn has_commits(&self, dir: &Path, base: &str, branch: &str) -> Result<bool, CommandError> {
        let range = format!("{base}..refs/heads/{branch}");
        let count = self.run(dir, &["rev-list", "--count", &range])?;
        Ok(count.trim() != "0")
    }

    /// Pushes the run's branch to `origin`. Network: only after the user approved.
    pub fn push(&self, dir: &Path, branch: &str) -> Result<(), CommandError> {
        if !self.succeeds(dir, &["remote", "get-url", "origin"])? {
            return Err(CommandError::Git {
                detail: "This repository has no remote named origin.".to_string(),
            });
        }
        let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
        self.run(dir, &["push", "--set-upstream", "origin", &refspec])?;
        Ok(())
    }
}

/// A branch-name slug from the task: lowercase words joined by `-`, at most 28 characters.
pub fn slug(task: &str) -> String {
    let mut out = String::new();
    for c in task.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= MAX_SLUG {
            break;
        }
    }
    let trimmed = out.trim_matches('-');
    // Cut at a word boundary when the slug was cut short.
    let cut = if out.len() >= MAX_SLUG {
        trimmed
            .rfind('-')
            .filter(|&i| i >= 8)
            .map_or(trimmed, |i| &trimmed[..i])
    } else {
        trimmed
    };
    if cut.is_empty() {
        "run".to_string()
    } else {
        cut.to_string()
    }
}

/// `gh`, for opening pull requests. `None` when it isn't installed.
pub fn find_gh() -> Option<PathBuf> {
    find_tool("gh")
}

/// Whether `gh` is signed in to GitHub.
pub fn gh_signed_in(gh: &Path) -> bool {
    Command::new(gh)
        .args(["auth", "status"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// Opens a pull request with `gh` and returns its URL. Network: only after approval.
pub fn gh_pr_create(
    gh: &Path,
    dir: &Path,
    base: &str,
    branch: &str,
    title: &str,
    body: &str,
) -> Result<String, CommandError> {
    use std::io::Write;
    let mut child = Command::new(gh)
        .current_dir(dir)
        .args([
            "pr",
            "create",
            "--base",
            base,
            "--head",
            branch,
            "--title",
            title,
            "--body-file",
            "-",
        ])
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(CommandError::from)?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(body.as_bytes())?;
    }
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(git_error(&output));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .rev()
        .find(|line| line.starts_with("https://"))
        .map(|line| line.trim().to_string())
        .ok_or(CommandError::Git {
            detail: "gh didn't print the pull request's link.".to_string(),
        })
}

/// The number at the end of a pull request link.
pub fn pr_number(url: &str) -> Option<u64> {
    url.trim_end_matches('/').rsplit('/').next()?.parse().ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Add,
    Del,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// One changed file. Paths are relative to the repository.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<Hunk>,
    pub truncated: bool,
    /// Changes whenever the file's diff does, for "changed since you viewed".
    pub hash: String,
}

struct Stat {
    path: String,
    old_path: Option<String>,
    additions: Option<u32>,
    deletions: Option<u32>,
}

/// `git diff --numstat -z`: `adds\tdels\tpath\0`, or `adds\tdels\t\0old\0new\0` for a
/// rename. Binary files show `-` for both counts.
fn parse_numstat(text: &str) -> Vec<Stat> {
    let mut stats = Vec::new();
    let mut fields = text.split('\0');
    while let Some(head) = fields.next() {
        let mut parts = head.splitn(3, '\t');
        let (Some(adds), Some(dels), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (path, old_path) = if path.is_empty() {
            let old = fields.next().unwrap_or("").to_string();
            let new = fields.next().unwrap_or("").to_string();
            (new, Some(old))
        } else {
            (path.to_string(), None)
        };
        stats.push(Stat {
            path,
            old_path,
            additions: adds.parse().ok(),
            deletions: dels.parse().ok(),
        });
    }
    stats
}

/// Splits a unified patch into its per-file sections, each starting at `diff --git`.
fn sections(patch: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = Vec::new();
    let mut offset = 0;
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            starts.push(offset);
        }
        offset += line.len();
    }
    starts
        .iter()
        .enumerate()
        .map(|(i, &start)| {
            let end = starts.get(i + 1).copied().unwrap_or(patch.len());
            &patch[start..end]
        })
        .collect()
}

/// `@@ -12,7 +12,9 @@ fn x` gives (12, 12).
fn hunk_starts(header: &str) -> (u32, u32) {
    let mut old = 0;
    let mut new = 0;
    for part in header.split_whitespace().skip(1).take(2) {
        let number = part[1..].split(',').next().unwrap_or("0");
        let value = number.parse().unwrap_or(0);
        if part.starts_with('-') {
            old = value;
        } else if part.starts_with('+') {
            new = value;
        }
    }
    (old, new)
}

fn cut_line(text: &str) -> String {
    match text.char_indices().nth(MAX_LINE_CHARS) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
}

/// FNV-1a, enough to notice that a file's diff changed. Not a security hash.
fn fnv(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn file_diff(stat: &Stat, section: &str) -> FileDiff {
    let mut status = FileStatus::Modified;
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut truncated = false;
    let mut count = 0;
    let (mut old, mut new) = (0, 0);
    for line in section.lines() {
        if let Some(header) = line.strip_prefix("@@") {
            let header = format!("@@{header}");
            (old, new) = hunk_starts(&header);
            hunks.push(Hunk {
                header,
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = hunks.last_mut() else {
            if line.starts_with("new file mode") {
                status = FileStatus::Added;
            } else if line.starts_with("deleted file mode") {
                status = FileStatus::Deleted;
            } else if line.starts_with("rename from") {
                status = FileStatus::Renamed;
            }
            continue;
        };
        if count >= MAX_LINES_PER_FILE {
            truncated = true;
            continue;
        }
        let (kind, text) = match line.chars().next() {
            Some('+') => (LineKind::Add, &line[1..]),
            Some('-') => (LineKind::Del, &line[1..]),
            Some(' ') => (LineKind::Context, &line[1..]),
            // `\ No newline at end of file`, or an empty context line.
            Some('\\') => continue,
            _ => (LineKind::Context, ""),
        };
        let (old_no, new_no) = match kind {
            LineKind::Add => {
                new += 1;
                (None, Some(new - 1))
            }
            LineKind::Del => {
                old += 1;
                (Some(old - 1), None)
            }
            LineKind::Context => {
                old += 1;
                new += 1;
                (Some(old - 1), Some(new - 1))
            }
        };
        hunk.lines.push(DiffLine {
            kind,
            old: old_no,
            new: new_no,
            text: cut_line(text),
        });
        count += 1;
    }
    if stat.old_path.is_some() {
        status = FileStatus::Renamed;
    }
    let binary = stat.additions.is_none();
    FileDiff {
        path: stat.path.clone(),
        old_path: stat.old_path.clone(),
        status,
        binary,
        additions: stat.additions.unwrap_or(0),
        deletions: stat.deletions.unwrap_or(0),
        hunks,
        truncated,
        hash: fnv(section),
    }
}

/// Pairs numstat entries with patch sections. Both come from the same diff, in the same order.
fn build_diff(stats: &[Stat], patch: &str) -> Vec<FileDiff> {
    let parts = sections(patch);
    stats
        .iter()
        .take(MAX_FILES)
        .enumerate()
        .map(|(i, stat)| file_diff(stat, parts.get(i).copied().unwrap_or("")))
        .collect()
}

/// One line's last change, for the editor's inline blame.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    /// The short commit id; empty when the line isn't committed yet.
    pub commit: String,
    pub author: String,
    /// Whether the author's email is the user's own `user.email`.
    pub is_you: bool,
    /// Seconds since the Unix epoch.
    pub time: u64,
    pub summary: String,
}

/// Reads `git blame --porcelain` for one line. `me` is the user's email, to say "You".
fn parse_blame(out: &str, me: &str) -> Option<Blame> {
    let mut lines = out.lines();
    let commit = lines.next()?.split(' ').next()?.to_string();
    let mut blame = Blame {
        commit: String::new(),
        author: String::new(),
        is_you: false,
        time: 0,
        summary: String::new(),
    };
    for line in lines {
        // The line's own text comes last, after a tab.
        if line.starts_with('\t') {
            break;
        }
        if let Some(author) = line.strip_prefix("author ") {
            blame.author = author.to_string();
        } else if let Some(mail) = line.strip_prefix("author-mail ") {
            let mail = mail.trim_start_matches('<').trim_end_matches('>');
            blame.is_you = !me.is_empty() && mail.eq_ignore_ascii_case(me);
        } else if let Some(time) = line.strip_prefix("author-time ") {
            blame.time = time.parse().unwrap_or(0);
        } else if let Some(summary) = line.strip_prefix("summary ") {
            blame.summary = summary.to_string();
        }
    }
    // All zeros: changed in the working tree, not committed.
    if !commit.chars().all(|c| c == '0') {
        blame.commit = commit.chars().take(8).collect();
    }
    Some(blame)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::fs;

    /// A new repository in a temp folder, with one commit on `main`.
    pub fn temp_repo(name: &str) -> (Git, PathBuf) {
        let git = Git::find().expect("git is installed");
        let dir = std::env::temp_dir().join(format!(
            "claudine-git-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        git.run(&dir, &["init", "-q", "-b", "main"]).unwrap();
        git.run(&dir, &["config", "user.name", "Test"]).unwrap();
        git.run(&dir, &["config", "user.email", "test@example.com"])
            .unwrap();
        git.run(&dir, &["config", "commit.gpgsign", "false"])
            .unwrap();
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(dir.join("gone.txt"), "bye\n").unwrap();
        git.run(&dir, &["add", "-A"]).unwrap();
        git.run(&dir, &["commit", "-q", "-m", "init"]).unwrap();
        (git, dir)
    }

    #[test]
    fn slugs_are_short_lowercase_words() {
        assert_eq!(
            slug("Add tests for the split diff renderer"),
            "add-tests-for-the-split"
        );
        assert_eq!(slug("  Fix: login!! "), "fix-login");
        assert_eq!(slug("日本語"), "run");
        assert!(slug(&"word ".repeat(40)).len() <= MAX_SLUG);
        assert!(!slug("a-very-long-name-without-any-break-at-all-here").ends_with('-'));
    }

    #[test]
    fn worktrees_and_branches_are_created_and_removed() {
        let (git, repo) = temp_repo("worktree");
        let base = git.commit_of(&repo, "main").unwrap();
        let branch = git.unique_branch(&repo, "claudine/", "fix-it").unwrap();
        assert_eq!(branch, "claudine/fix-it");
        let tree = repo.with_extension("wt");
        git.add_worktree(&repo, &tree, &branch, &base).unwrap();
        assert!(tree.join("a.txt").exists());
        // The main checkout stays on its branch.
        assert_eq!(git.current_branch(&repo).unwrap().as_deref(), Some("main"));
        // The name is taken now, so the next one gets a number.
        assert_eq!(
            git.unique_branch(&repo, "claudine/", "fix-it").unwrap(),
            "claudine/fix-it-2"
        );

        git.remove_worktree(&repo, &tree).unwrap();
        git.delete_branch(&repo, &branch).unwrap();
        assert!(!tree.exists());
        assert!(!git.branch_exists(&repo, &branch).unwrap());
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn bad_branch_names_are_refused() {
        let (git, repo) = temp_repo("names");
        assert!(!git.valid_branch(&repo, "-x").unwrap());
        assert!(!git.valid_branch(&repo, "a..b").unwrap());
        assert!(git.valid_branch(&repo, "claudine/ok").unwrap());
        assert!(git.unique_branch(&repo, "bad..", "x").is_err());
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn snapshots_include_untracked_files_and_leave_the_index_alone() {
        let (git, repo) = temp_repo("snapshot");
        let base = git.commit_of(&repo, "main").unwrap();
        fs::write(repo.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        fs::write(repo.join("new.rs"), "fn main() {}\n").unwrap();
        fs::remove_file(repo.join("gone.txt")).unwrap();
        let index = repo.with_extension("index");
        let tree = git.snapshot(&repo, &index).unwrap();
        // Nothing was staged in the real index.
        assert_eq!(
            git.run(&repo, &["diff", "--cached", "--name-only"])
                .unwrap(),
            ""
        );

        let files = git.diff(&repo, &base, &tree).unwrap();
        let by_path = |p: &str| files.iter().find(|f| f.path == p).unwrap();
        let a = by_path("a.txt");
        assert_eq!(
            (a.status, a.additions, a.deletions),
            (FileStatus::Modified, 2, 1)
        );
        let lines = &a.hunks[0].lines;
        assert!(
            lines
                .iter()
                .any(|l| l.kind == LineKind::Del && l.text == "two" && l.old == Some(2))
        );
        assert!(
            lines
                .iter()
                .any(|l| l.kind == LineKind::Add && l.text == "four" && l.new == Some(4))
        );
        assert_eq!(by_path("new.rs").status, FileStatus::Added);
        assert_eq!(by_path("gone.txt").status, FileStatus::Deleted);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn changes_between_two_snapshots_show_only_the_new_work() {
        let (git, repo) = temp_repo("since");
        let index = repo.with_extension("index");
        fs::write(repo.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        let first = git.snapshot(&repo, &index).unwrap();
        fs::write(repo.join("b.txt"), "later\n").unwrap();
        let second = git.snapshot(&repo, &index).unwrap();
        let files = git.diff(&repo, &first, &second).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "b.txt");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn hashes_change_with_the_diff() {
        let (git, repo) = temp_repo("hash");
        let base = git.commit_of(&repo, "main").unwrap();
        let index = repo.with_extension("index");
        fs::write(repo.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        let first = git
            .diff(&repo, &base, &git.snapshot(&repo, &index).unwrap())
            .unwrap();
        fs::write(repo.join("a.txt"), "one\nTWO!\nthree\n").unwrap();
        let second = git
            .diff(&repo, &base, &git.snapshot(&repo, &index).unwrap())
            .unwrap();
        assert_ne!(first[0].hash, second[0].hash);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn commit_all_reports_whether_there_was_anything() {
        let (git, repo) = temp_repo("commit");
        assert!(!git.commit_all(&repo, "nothing", "").unwrap());
        fs::write(repo.join("c.txt"), "c\n").unwrap();
        assert!(git.commit_all(&repo, "Add c", "Because.").unwrap());
        let message = git.run(&repo, &["log", "-1", "--format=%s%n%b"]).unwrap();
        assert_eq!(message.trim(), "Add c\nBecause.");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn renames_and_binary_files_parse() {
        let stats = parse_numstat("1\t0\t\0old.rs\0new.rs\0-\t-\tlogo.png\0");
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].path, "new.rs");
        assert_eq!(stats[0].old_path.as_deref(), Some("old.rs"));
        assert_eq!(stats[1].additions, None);
        assert_eq!(hunk_starts("@@ -12,7 +14,9 @@ fn x"), (12, 14));
        assert_eq!(hunk_starts("@@ -0,0 +1 @@"), (0, 1));
        assert_eq!(pr_number("https://github.com/o/r/pull/42"), Some(42));
    }

    #[test]
    fn ignored_lists_gitignored_files_and_folders_once() {
        let (git, repo) = temp_repo("ignored");
        fs::write(repo.join(".gitignore"), "dist/\n*.log\n").unwrap();
        fs::create_dir_all(repo.join("dist/deep")).unwrap();
        fs::write(repo.join("dist/deep/a.js"), "x").unwrap();
        fs::write(repo.join("debug.log"), "x").unwrap();
        fs::write(repo.join("kept.txt"), "x").unwrap();
        let ignored = git.ignored(&repo).unwrap();
        assert!(ignored.contains("dist"));
        assert!(ignored.contains("debug.log"));
        assert!(!ignored.contains("kept.txt"));
        assert!(!ignored.iter().any(|p| p.starts_with("dist/")));
    }

    #[test]
    fn blame_names_the_commit_and_marks_uncommitted_lines() {
        let out = "1234567890abcdef1234567890abcdef12345678 3 3 1\n\
                   author Ada Lovelace\n\
                   author-mail <ada@example.com>\n\
                   author-time 1700000000\n\
                   summary Fix the engine\n\
                   \tlet x = 1;\n";
        let blame = parse_blame(out, "ADA@example.com").unwrap();
        assert_eq!(blame.commit, "12345678");
        assert_eq!(blame.author, "Ada Lovelace");
        assert!(blame.is_you);
        assert_eq!(blame.time, 1_700_000_000);
        assert_eq!(blame.summary, "Fix the engine");

        let out = "0000000000000000000000000000000000000000 1 1 1\n\
                   author Not Committed Yet\n\
                   summary Version of a.rs from a.rs\n";
        let blame = parse_blame(out, "").unwrap();
        assert_eq!(blame.commit, "");
        assert!(!blame.is_you);
        assert_eq!(parse_blame("", "me"), None);
    }

    #[test]
    fn blame_line_reads_a_committed_and_an_edited_buffer() {
        let (git, repo) = temp_repo("blame");
        fs::write(repo.join("b.txt"), "one\ntwo\n").unwrap();
        git.run(&repo, &["add", "b.txt"]).unwrap();
        git.run(
            &repo,
            &[
                "-c",
                "user.name=Ada",
                "-c",
                "user.email=ada@example.com",
                "commit",
                "-qm",
                "Add b",
            ],
        )
        .unwrap();
        let blame = git.blame_line(&repo, "b.txt", 2, None).unwrap().unwrap();
        assert_eq!(blame.author, "Ada");
        assert_eq!(blame.summary, "Add b");
        // A line added in the buffer isn't committed.
        let edited = git
            .blame_line(&repo, "b.txt", 1, Some("new\none\ntwo\n"))
            .unwrap()
            .unwrap();
        assert_eq!(edited.commit, "");
        assert_eq!(git.blame_line(&repo, "missing.txt", 1, None).unwrap(), None);
    }
}
