//! Reading the project's folders and files. Every path goes through the path guard.

use crate::error::CommandError;
use my_editor_core::path_guard::ProjectRoot;
use serde::Serialize;
use std::io::Read;

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
pub fn read_file(root: &ProjectRoot, raw: &str) -> Result<String, CommandError> {
    let path = root.read_path(raw)?;
    let file = root.dir().open(path.as_path())?;
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
    // NUL bytes are valid UTF-8 but mean a binary file.
    if bytes.contains(&0) {
        return Err(CommandError::NotText);
    }
    // LEARN: `from_utf8` fails on bytes that aren't valid UTF-8, instead of replacing them.
    String::from_utf8(bytes).map_err(|_| CommandError::NotText)
}

/// Every file in the project, for Go to file and project search, sorted by path.
///
/// Folders that can't be read are skipped. Symlinked folders aren't followed, because two
/// links pointing at each other would loop forever.
pub fn list_files(root: &ProjectRoot, hidden: &[String]) -> Result<FileList, CommandError> {
    let mut paths = Vec::new();
    let mut pending: Vec<Option<String>> = vec![None];

    // LEARN: `while let` loops as long as the pattern matches, here until the stack is empty.
    while let Some(folder) = pending.pop() {
        let Ok(entries) = list_dir(root, folder.as_deref(), hidden) else {
            continue;
        };
        for entry in entries {
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
        let text = read_file(&project.root(), "src/main.rs").unwrap();
        assert_eq!(text, "fn main() { println!(\"héllo\"); }");
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
            read_file(&project.root(), "at-limit.txt").map(|t| t.len()),
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
        let list = list_files(&project.root(), &hidden()).unwrap();
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
            let list = list_files(&project.root(), &hidden()).unwrap();
            assert_eq!(list.paths, ["src/a.rs"]);
        }
    }
}
