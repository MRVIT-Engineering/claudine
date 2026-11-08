//! Which project folders the user has trusted to run `claude` in.
//!
//! `claude -p` skips Claude Code's own "do you trust this folder?" prompt, and a project
//! can hold settings, hooks and MCP servers in `.claude/` and `.mcp.json` that run
//! commands. So Rust asks once per folder, natively, before the first session there.

use crate::settings::write_atomic;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The file's shape: `{ "projects": ["/Users/me/code/app"] }`.
#[derive(Default, Serialize, Deserialize)]
struct TrustFile {
    projects: Vec<String>,
}

pub struct TrustState {
    path: PathBuf,
    projects: Mutex<Vec<String>>,
}

impl TrustState {
    /// Loads from the app's config folder. A missing or broken file trusts nothing, so
    /// the worst case is being asked again.
    pub fn load(path: PathBuf) -> TrustState {
        let projects = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<TrustFile>(&text).ok())
            .unwrap_or_default()
            .projects;
        TrustState {
            path,
            projects: Mutex::new(projects),
        }
    }

    /// `folder` must be canonical, so `a/../b` and symlinked spellings can't differ.
    pub fn is_trusted(&self, folder: &Path) -> bool {
        let key = folder.to_string_lossy();
        match self.projects.lock() {
            Ok(projects) => projects.iter().any(|p| *p == key),
            Err(_) => false,
        }
    }

    pub fn trust(&self, folder: &Path) -> io::Result<()> {
        let mut projects = self.projects.lock().map_err(|_| io::Error::other("lock"))?;
        let key = folder.to_string_lossy().into_owned();
        if !projects.contains(&key) {
            projects.push(key);
        }
        let file = TrustFile {
            projects: projects.clone(),
        };
        let text = serde_json::to_string_pretty(&file).map_err(io::Error::other)?;
        write_atomic(&self.path, &text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trust-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("trusted-projects.json")
    }

    #[test]
    fn nothing_is_trusted_without_a_file() {
        let state = TrustState::load(temp_file("missing"));
        assert!(!state.is_trusted(Path::new("/tmp/project")));
    }

    #[test]
    fn trust_is_saved_and_reloaded() {
        let file = temp_file("saved");
        let state = TrustState::load(file.clone());
        state.trust(Path::new("/tmp/project")).unwrap();
        state.trust(Path::new("/tmp/project")).unwrap();

        let reloaded = TrustState::load(file.clone());
        assert!(reloaded.is_trusted(Path::new("/tmp/project")));
        assert!(!reloaded.is_trusted(Path::new("/tmp/project/sub")));
        assert!(!reloaded.is_trusted(Path::new("/tmp")));
        let text = fs::read_to_string(&file).unwrap();
        assert_eq!(text.matches("/tmp/project").count(), 1);
    }

    #[test]
    fn a_broken_file_trusts_nothing() {
        let file = temp_file("broken");
        write_atomic(&file, "{ not json").unwrap();
        let state = TrustState::load(file);
        assert!(!state.is_trusted(Path::new("/tmp/project")));
    }
}
