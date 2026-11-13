//! What a file will look like after Claude's Write or Edit, so the user approves a real diff.

use crate::error::CommandError;
use crate::files;
use my_editor_core::path_guard::ProjectRoot;
use serde::Serialize;
use serde_json::Value;

/// Bigger files are shown as plain old and new text instead, to keep events small.
const MAX_PROPOSAL_BYTES: usize = 1_000_000;

/// A change Claude asks to make to one project file: its text now, and after the tool runs.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Proposal {
    /// Relative to the project, like every path the webview sees.
    pub path: String,
    pub before: String,
    pub after: String,
}

/// The proposal for a Write, Edit or MultiEdit of `path`, a project-relative path.
///
/// `None` when the file can't be read as text, is too big, or the edit doesn't match it:
/// the card then shows the plain old and new text. Reads go through the path guard.
pub fn propose(tool: &str, input: &Value, path: &str, root: &ProjectRoot) -> Option<Proposal> {
    let before = match files::read_file(root, path) {
        Ok(file) => file.text,
        // A Write may create the file.
        Err(CommandError::NotFound) if tool == "Write" => String::new(),
        Err(_) => return None,
    };
    let after = match tool {
        "Write" => input["content"].as_str()?.to_string(),
        "Edit" => apply(&before, input)?,
        // LEARN: `try_fold` stops at the first `None`, so one edit that misses drops the whole proposal.
        "MultiEdit" => input["edits"]
            .as_array()?
            .iter()
            .try_fold(before.clone(), |text, edit| apply(&text, edit))?,
        _ => return None,
    };
    if before.len() > MAX_PROPOSAL_BYTES || after.len() > MAX_PROPOSAL_BYTES {
        return None;
    }
    Some(Proposal {
        path: path.to_string(),
        before,
        after,
    })
}

/// One `old_string` to `new_string` replacement, as Claude Code's Edit applies it:
/// `old_string` must appear exactly once, unless `replace_all` is set.
fn apply(text: &str, edit: &Value) -> Option<String> {
    let old = edit["old_string"].as_str()?;
    let new = edit["new_string"].as_str()?;
    if old.is_empty() {
        return None;
    }
    if edit["replace_all"].as_bool().unwrap_or(false) {
        return text.contains(old).then(|| text.replace(old, new));
    }
    if text.matches(old).count() != 1 {
        return None;
    }
    Some(text.replacen(old, new, 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn project(files: &[(&str, &str)]) -> (std::path::PathBuf, ProjectRoot) {
        let dir = std::env::temp_dir().join(format!(
            "claudine-proposal-{}-{}",
            std::process::id(),
            files.len()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for (name, text) in files {
            fs::write(dir.join(name), text).unwrap();
        }
        let root = ProjectRoot::open(&dir).unwrap();
        (dir, root)
    }

    #[test]
    fn an_edit_replaces_its_one_match() {
        let edit = json!({ "old_string": "b", "new_string": "B" });
        assert_eq!(apply("a\nb\nc", &edit).as_deref(), Some("a\nB\nc"));
    }

    #[test]
    fn an_edit_that_matches_twice_or_never_has_no_proposal() {
        let edit = json!({ "old_string": "x", "new_string": "y" });
        assert_eq!(apply("x x", &edit), None);
        assert_eq!(apply("abc", &edit), None);
    }

    #[test]
    fn replace_all_replaces_every_match() {
        let edit = json!({ "old_string": "x", "new_string": "y", "replace_all": true });
        assert_eq!(apply("x x", &edit).as_deref(), Some("y y"));
    }

    #[test]
    fn edits_and_writes_read_the_file_through_the_guard() {
        let (dir, root) = project(&[("a.txt", "one\ntwo\n")]);
        let edit = json!({ "file_path": "ignored", "old_string": "two", "new_string": "2" });
        let proposal = propose("Edit", &edit, "a.txt", &root).unwrap();
        assert_eq!(proposal.before, "one\ntwo\n");
        assert_eq!(proposal.after, "one\n2\n");

        let write = json!({ "content": "new\n" });
        let created = propose("Write", &write, "b.txt", &root).unwrap();
        assert_eq!(
            (created.before.as_str(), created.after.as_str()),
            ("", "new\n")
        );

        assert_eq!(propose("Edit", &edit, "../a.txt", &root), None);
        // Windows can't delete a folder while the project still holds it open.
        drop(root);
        fs::remove_dir_all(dir).unwrap();
    }
}
