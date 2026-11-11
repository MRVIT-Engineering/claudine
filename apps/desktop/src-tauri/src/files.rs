//! Reading the project's folders and files. Every path goes through the path guard.

use crate::error::CommandError;
use cap_std::fs::OpenOptions;
use my_editor_core::path_guard::ProjectRoot;
use serde::Serialize;
use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Bigger files aren't opened, so a 2 GB log can't freeze the webview.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// `list_files` stops here, so a huge project can't flood the webview.
pub const MAX_LISTED_FILES: usize = 20_000;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    /// Relative to the project root, `/`-separated.
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
}

/// A file's text and its version: a hash of its bytes, sent back when saving so a change
/// made outside Claudine since then is caught instead of overwritten.
#[derive(Debug, PartialEq, Serialize)]
pub struct FileText {
    pub text: String,
    pub version: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct FileList {
    pub paths: Vec<String>,
    pub truncated: bool,
}

/// Lists one folder: `None` for the project root. Folders first, then by name, ignoring case.
/// Names in `hidden` are left out; they come from the user's settings.
// LEARN: `&[String]` borrows any run of strings, a whole `Vec` or part of one, without copying.
pub fn list_dir(
    root: &ProjectRoot,
    path: Option<&str>,
    hidden: &[String],
) -> Result<Vec<DirEntry>, CommandError> {
    let (entries, parent) = match path {
        None => (root.dir().entries()?, String::new()),
        Some(raw) => {
            let checked = root.read_path(raw)?;
            // Paths from the webview are text, so a checked path is always valid UTF-8.
            let parent = checked.as_path().to_string_lossy().into_owned();
            (root.dir().read_dir(checked.as_path())?, parent)
        }
    };

    let mut listed = Vec::new();
    for entry in entries {
        let entry = entry?;
        // A name that isn't valid UTF-8 couldn't be sent back to open it, so skip it.
        let Some(name) = entry.file_name().to_str().map(String::from) else {
            continue;
        };
        if hidden.contains(&name) {
            continue;
        }
        let child = if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}/{name}")
        };
        // `file_type` describes the entry itself, without following a symlink.
        let file_type = entry.file_type()?;
        let is_symlink = file_type.is_symlink();
        let is_dir = if is_symlink {
            // A symlink counts as a folder only if it leads to one inside the project.
            let target = root.read_path(&child)?;
            root.dir()
                .metadata(target.as_path())
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false)
        } else {
            file_type.is_dir()
        };
        listed.push(DirEntry {
            name,
            path: child,
            is_dir,
            is_symlink,
        });
    }

    // LEARN: the comparator returns an `Ordering`; `then_with` breaks ties with a second rule.
    listed.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(listed)
}

/// Reads a text file. Refuses folders, oversized files and anything that isn't UTF-8 text.
pub fn read_file(root: &ProjectRoot, raw: &str) -> Result<FileText, CommandError> {
    let path = root.read_path(raw)?;
    let bytes = read_bytes(root, path.as_path())?;
    // NUL bytes are valid UTF-8 but mean a binary file.
    if bytes.contains(&0) {
        return Err(CommandError::NotText);
    }
    let version = version_of(&bytes);
    // LEARN: `from_utf8` fails on bytes that aren't valid UTF-8, instead of replacing them.
    let text = String::from_utf8(bytes).map_err(|_| CommandError::NotText)?;
    Ok(FileText { text, version })
}

/// A file's bytes, up to [`MAX_FILE_BYTES`]. `path` must come from the guard.
fn read_bytes(root: &ProjectRoot, path: &std::path::Path) -> Result<Vec<u8>, CommandError> {
    let file = root.dir().open(path)?;
    if file.metadata()?.is_dir() {
        return Err(CommandError::IsADirectory);
    }
    // Reads one byte past the limit, so a file that grew after the check is still caught.
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    // LEARN: `as` converts between number types; Rust never mixes `usize` and `u64` by itself.
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(CommandError::TooLarge);
    }
    Ok(bytes)
}

/// A short fingerprint of a file's bytes. It detects changes, not attacks, so std's
/// hasher is enough; `DefaultHasher::new()` gives the same answer every time.
fn version_of(bytes: &[u8]) -> String {
    // LEARN: `Hash` types feed themselves into a `Hasher`; `finish` reads out the result.
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Numbers temp files, so two saves at once never share one.
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// Saves `text` over an existing file and returns its new version.
///
/// When `expected` is given and the file on disk no longer matches it, nothing is written
/// and the result is `Conflict`. `None` overwrites, after the user chose to.
///
/// The write is atomic: the text goes to a temp file in the same folder, which is flushed
/// to disk and then renamed over the file. A crash leaves the old file or the new one, never
/// half of each. The file keeps its permissions, so a script stays executable.
pub fn save_file(
    root: &ProjectRoot,
    raw: &str,
    text: &str,
    expected: Option<&str>,
) -> Result<String, CommandError> {
    // Refuses `.git`, `.claude/`, `.mcp.json` and any path through a symlink.
    let path = root.write_path(raw)?;
    let path = path.as_path();
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(CommandError::TooLarge);
    }
    // Only existing files: creating one is a separate action.
    let current = read_bytes(root, path)?;
    if let Some(expected) = expected
        && version_of(&current) != expected
    {
        return Err(CommandError::Conflict);
    }
    let permissions = root.dir().metadata(path)?.permissions();

    let name = path
        .file_name()
        .ok_or(CommandError::InvalidPath)?
        .to_string_lossy();
    let number = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temp_name = format!(".{name}.claudine-{}-{number}.tmp", std::process::id());
    let temp: PathBuf = match path.parent() {
        Some(parent) => parent.join(temp_name),
        None => PathBuf::from(temp_name),
    };

    // LEARN: `create_new` fails if the file exists, so this never writes over another file.
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let written = (|| -> Result<(), CommandError> {
        let mut file = root.dir().open_with(&temp, &options)?;
        file.write_all(text.as_bytes())?;
        file.set_permissions(permissions)?;
        // On disk before the rename, or a crash could leave an empty file in its place.
        file.sync_all()?;
        root.dir().rename(&temp, root.dir(), path)?;
        Ok(())
    })();
    if written.is_err() {
        let _ = root.dir().remove_file(&temp);
    }
    written?;
    Ok(version_of(text.as_bytes()))
}

/// Every file in the project, for Go to file and project search, sorted by path. Paths in
/// `ignored` (gitignored files, and folders without a trailing `/`) are left out.
///
/// Folders that can't be read are skipped. Symlinked folders aren't followed, because two
/// links pointing at each other would loop forever.
pub fn list_files(
    root: &ProjectRoot,
    hidden: &[String],
    ignored: &HashSet<String>,
) -> Result<FileList, CommandError> {
    let mut paths = Vec::new();
    let mut pending: Vec<Option<String>> = vec![None];

    // LEARN: `while let` loops as long as the pattern matches, here until the stack is empty.
    while let Some(folder) = pending.pop() {
        let Ok(entries) = list_dir(root, folder.as_deref(), hidden) else {
            continue;
        };
        for entry in entries {
            // Gitignored files and folders, such as `dist/`, aren't worth finding.
            if ignored.contains(&entry.path) {
                continue;
            }
            if entry.is_dir {
                if !entry.is_symlink {
                    pending.push(Some(entry.path));
                }
            } else {
                paths.push(entry.path);
                if paths.len() >= MAX_LISTED_FILES {
                    paths.sort();
                    return Ok(FileList {
                        paths,
                        truncated: true,
                    });
                }
            }
        }
    }
    paths.sort();
    Ok(FileList {
        paths,
        truncated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    /// A temp `project/` folder, with a `secret` file beside it that must stay out of reach.
    struct TestProject {
        base: PathBuf,
    }

    impl TestProject {
        fn new() -> TestProject {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let name = format!("desktop-files-{}-{id}", std::process::id());
            let base = std::env::temp_dir().join(name);
            fs::create_dir_all(base.join("project")).unwrap();
            fs::write(base.join("secret"), "SECRET").unwrap();
            TestProject { base }
        }

        fn write(&self, path: &str, contents: &[u8]) {
            let full = self.base.join("project").join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, contents).unwrap();
        }

        fn root(&self) -> ProjectRoot {
            ProjectRoot::open(&self.base.join("project")).unwrap()
        }
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn hidden() -> Vec<String> {
        Settings::default().excluded_names
    }

    fn names(entries: &[DirEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.name.as_str()).collect()
    }

    #[test]
    fn lists_folders_first_then_files_ignoring_case() {
        let project = TestProject::new();
        project.write("b.rs", b"");
        project.write("A.md", b"");
        project.write("src/main.rs", b"");
        project.write("Docs/x.md", b"");
        let entries = list_dir(&project.root(), None, &hidden()).unwrap();
        assert_eq!(names(&entries), ["Docs", "src", "A.md", "b.rs"]);
        assert!(entries[0].is_dir && !entries[2].is_dir);
    }

    #[test]
    fn hides_only_the_names_it_is_given() {
        let project = TestProject::new();
        project.write("dist/app.js", b"");
        project.write("target/x", b"");
        let entries = list_dir(&project.root(), None, &[String::from("dist")]).unwrap();
        assert_eq!(names(&entries), ["target"]);
    }

    #[test]
    fn hides_noise_folders() {
        let project = TestProject::new();
        for path in [
            ".git/config",
            "node_modules/x/index.js",
            "target/debug/app",
            ".DS_Store",
        ] {
            project.write(path, b"");
        }
        project.write(".gitignore", b"");
        let entries = list_dir(&project.root(), None, &hidden()).unwrap();
        assert_eq!(names(&entries), [".gitignore"]);
    }

    #[test]
    fn lists_a_subfolder_with_full_relative_paths() {
        let project = TestProject::new();
        project.write("src/session/pool.rs", b"");
        let entries = list_dir(&project.root(), Some("./src/"), &hidden()).unwrap();
        assert_eq!(entries[0].path, "src/session");
        let inner = list_dir(&project.root(), Some(&entries[0].path), &hidden()).unwrap();
        assert_eq!(inner[0].path, "src/session/pool.rs");
    }

    #[test]
    fn listing_refuses_paths_outside_the_project() {
        let project = TestProject::new();
        let result = list_dir(&project.root(), Some(".."), &hidden());
        assert_eq!(result, Err(CommandError::OutsideProject));
    }

    #[test]
    fn listing_a_file_is_an_error() {
        let project = TestProject::new();
        project.write("a.rs", b"");
        let result = list_dir(&project.root(), Some("a.rs"), &hidden());
        assert_eq!(result, Err(CommandError::NotADirectory));
    }

    #[test]
    fn reads_utf8_text() {
        let project = TestProject::new();
        project.write(
            "src/main.rs",
            "fn main() { println!(\"héllo\"); }".as_bytes(),
        );
        let file = read_file(&project.root(), "src/main.rs").unwrap();
        assert_eq!(file.text, "fn main() { println!(\"héllo\"); }");
    }

    #[test]
    fn refuses_binary_and_invalid_utf8() {
        let project = TestProject::new();
        project.write("image.png", &[0x89, b'P', b'N', b'G', 0, 0]);
        project.write("latin1.txt", &[b'c', b'a', b'f', 0xe9]);
        assert_eq!(
            read_file(&project.root(), "image.png"),
            Err(CommandError::NotText)
        );
        assert_eq!(
            read_file(&project.root(), "latin1.txt"),
            Err(CommandError::NotText)
        );
    }

    #[test]
    fn refuses_files_over_the_size_limit() {
        let project = TestProject::new();
        let limit = MAX_FILE_BYTES as usize;
        project.write("at-limit.txt", &vec![b'a'; limit]);
        project.write("too-big.txt", &vec![b'a'; limit + 1]);
        assert_eq!(
            read_file(&project.root(), "at-limit.txt").map(|f| f.text.len()),
            Ok(limit)
        );
        assert_eq!(
            read_file(&project.root(), "too-big.txt"),
            Err(CommandError::TooLarge)
        );
    }

    #[test]
    fn reading_refuses_folders_missing_files_and_escapes() {
        let project = TestProject::new();
        project.write("src/a.rs", b"");
        let root = project.root();
        assert_eq!(read_file(&root, "src"), Err(CommandError::IsADirectory));
        assert_eq!(read_file(&root, "missing.rs"), Err(CommandError::NotFound));
        assert_eq!(
            read_file(&root, "../secret"),
            Err(CommandError::OutsideProject)
        );
    }

    #[test]
    fn lists_every_file_except_hidden_folders() {
        let project = TestProject::new();
        for path in [
            "README.md",
            "src/main.rs",
            "src/a/b/c.rs",
            "target/x",
            ".git/HEAD",
        ] {
            project.write(path, b"");
        }
        let list = list_files(&project.root(), &hidden(), &HashSet::new()).unwrap();
        assert_eq!(list.paths, ["README.md", "src/a/b/c.rs", "src/main.rs"]);
        assert!(!list.truncated);
    }

    #[cfg(unix)]
    mod symlinks {
        use super::*;
        use std::os::unix::fs::symlink;

        #[test]
        fn marks_symlinks_and_resolves_folders_inside() {
            let project = TestProject::new();
            project.write("src/a.rs", b"");
            symlink("src", project.base.join("project/src-link")).unwrap();
            let entries = list_dir(&project.root(), None, &hidden()).unwrap();
            let link = entries.iter().find(|e| e.name == "src-link").unwrap();
            assert!(link.is_symlink && link.is_dir);
        }

        #[test]
        fn a_symlink_out_of_the_project_is_listed_but_cannot_be_read() {
            let project = TestProject::new();
            symlink(
                project.base.join("secret"),
                project.base.join("project/leak"),
            )
            .unwrap();
            let root = project.root();
            let entries = list_dir(&root, None, &hidden()).unwrap();
            let leak = entries.iter().find(|e| e.name == "leak").unwrap();
            assert!(leak.is_symlink && !leak.is_dir);
            assert_eq!(read_file(&root, "leak"), Err(CommandError::AccessDenied));
        }

        #[test]
        fn does_not_follow_symlinked_folders_when_listing_everything() {
            let project = TestProject::new();
            project.write("src/a.rs", b"");
            // A link to its own parent would loop forever if followed.
            symlink("..", project.base.join("project/src/loop")).unwrap();
            // Finishing at all shows the link wasn't followed. It's a folder, so not listed.
            let list = list_files(&project.root(), &hidden(), &HashSet::new()).unwrap();
            assert_eq!(list.paths, ["src/a.rs"]);
        }
    }

    fn on_disk(project: &TestProject, path: &str) -> String {
        fs::read_to_string(project.base.join("project").join(path)).unwrap()
    }

    #[test]
    fn saving_replaces_the_file_and_returns_the_new_version() {
        let project = TestProject::new();
        project.write("src/a.rs", b"old");
        let root = project.root();
        let read = read_file(&root, "src/a.rs").unwrap();
        let version = save_file(&root, "src/a.rs", "new", Some(&read.version)).unwrap();
        assert_eq!(on_disk(&project, "src/a.rs"), "new");
        assert_eq!(version, read_file(&root, "src/a.rs").unwrap().version);
        // No temp file is left beside it.
        let names: Vec<_> = fs::read_dir(project.base.join("project/src"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["a.rs"]);
    }

    #[test]
    fn a_change_made_elsewhere_is_a_conflict_unless_overwriting() {
        let project = TestProject::new();
        project.write("a.txt", b"one");
        let root = project.root();
        let read = read_file(&root, "a.txt").unwrap();
        project.write("a.txt", b"changed elsewhere");
        assert_eq!(
            save_file(&root, "a.txt", "mine", Some(&read.version)),
            Err(CommandError::Conflict)
        );
        assert_eq!(on_disk(&project, "a.txt"), "changed elsewhere");
        save_file(&root, "a.txt", "mine", None).unwrap();
        assert_eq!(on_disk(&project, "a.txt"), "mine");
    }

    #[test]
    fn saving_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let project = TestProject::new();
        project.write("run.sh", b"echo hi");
        let full = project.base.join("project/run.sh");
        fs::set_permissions(&full, fs::Permissions::from_mode(0o755)).unwrap();
        save_file(&project.root(), "run.sh", "echo bye", None).unwrap();
        let mode = fs::metadata(&full).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
    }

    #[test]
    fn saving_refuses_new_files_protected_paths_symlinks_and_escapes() {
        let project = TestProject::new();
        project.write(".git/config", b"[core]");
        project.write("real.txt", b"real");
        std::os::unix::fs::symlink(
            project.base.join("project/real.txt"),
            project.base.join("project/link.txt"),
        )
        .unwrap();
        let root = project.root();
        assert_eq!(
            save_file(&root, "missing.txt", "x", None),
            Err(CommandError::NotFound)
        );
        assert_eq!(
            save_file(&root, ".git/config", "x", None),
            Err(CommandError::Protected)
        );
        assert_eq!(
            save_file(&root, "link.txt", "x", None),
            Err(CommandError::ThroughSymlink)
        );
        assert_eq!(
            save_file(&root, "../secret", "x", None),
            Err(CommandError::OutsideProject)
        );
        assert_eq!(on_disk(&project, "real.txt"), "real");
        assert_eq!(
            fs::read_to_string(project.base.join("secret")).unwrap(),
            "SECRET"
        );
    }
}
