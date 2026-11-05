//! Path guard: keeps every file operation inside the open project.

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use std::ffi::OsStr;
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

/// Why the guard refused a path.
///
/// `Display` never includes a path, so these messages are safe to show in the webview.
#[derive(Debug, PartialEq)]
pub enum GuardError {
    /// The path is empty, or contains a NUL or a backslash.
    InvalidPath,
    /// The path is absolute or uses `..`.
    OutsideProject,
    /// Writing here could run code, so it's never allowed: `.git`.
    Protected,
    /// Writing here could run code, so it needs a native confirmation: `.claude`, `.mcp.json`.
    NeedsConfirmation,
    /// A write would go through a symlink.
    ThroughSymlink,
    /// The operating system refused. Only the kind is kept, because the full error can hold a path.
    Io(io::ErrorKind),
}

// LEARN: `impl Trait for Type` implements a trait separately from the type's definition.
impl fmt::Display for GuardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // LEARN: `match` must cover every variant, and `Io(kind)` unpacks the variant's data.
        match self {
            GuardError::InvalidPath => write!(f, "invalid path"),
            GuardError::OutsideProject => write!(f, "path is outside the project"),
            GuardError::Protected => write!(f, "this path can't be changed"),
            GuardError::NeedsConfirmation => write!(f, "changing this path needs confirmation"),
            GuardError::ThroughSymlink => write!(f, "can't write through a symlink"),
            GuardError::Io(kind) => write!(f, "file system error: {kind}"),
        }
    }
}

impl std::error::Error for GuardError {}

/// A project-relative path that passed the guard's checks.
///
/// Webview paths are always `/`-separated text, so non-UTF-8 names can't get this far.
// LEARN: the field is private, so code outside this module can only get a `RelPath` from the guard.
#[derive(Debug, PartialEq)]
pub struct RelPath(PathBuf);

impl RelPath {
    /// Stops traversal (`../../.ssh/id_rsa`) and absolute paths (`/etc/passwd`) before
    /// they reach the disk. It rejects every `..`, even harmless ones, to keep the rule simple.
    fn parse(raw: &str) -> Result<RelPath, GuardError> {
        // A backslash is a separator on Windows, and NUL truncates paths in C APIs.
        if raw.is_empty() || raw.contains('\0') || raw.contains('\\') {
            return Err(GuardError::InvalidPath);
        }

        // LEARN: `Path` borrows like `&str`; `PathBuf` is owned and can grow like `String`.
        let mut clean = PathBuf::new();
        for component in Path::new(raw).components() {
            match component {
                Component::Normal(name) => clean.push(name),
                // `components()` already drops most `.` segments and trailing slashes.
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(GuardError::OutsideProject);
                }
            }
        }

        // `.` and `./` have no name left in them, and would mean the project root itself.
        if clean.as_os_str().is_empty() {
            return Err(GuardError::InvalidPath);
        }
        Ok(RelPath(clean))
    }

    /// The checked path, relative to the project root.
    pub fn as_path(&self) -> &Path {
        &self.0
    }
}

/// The open project: a handle to its folder, not just its path.
///
/// Always use paths from [`ProjectRoot::read_path`] or [`ProjectRoot::write_path`] with
/// [`ProjectRoot::dir`]. `Dir` keeps every operation inside the project on its own, even if
/// a path changes after it was checked. An escape attempt then fails with `PermissionDenied`.
pub struct ProjectRoot {
    dir: Dir,
}

impl ProjectRoot {
    /// Opens a folder as a project. Only Rust may call this with a path the user picked.
    pub fn open(root: &Path) -> Result<ProjectRoot, GuardError> {
        // `ambient_authority()` marks the one place that may reach the whole file system.
        // LEARN: this closure converts the error type, and `?` then returns it to the caller.
        let dir = Dir::open_ambient_dir(root, ambient_authority())
            .map_err(|error| GuardError::Io(error.kind()))?;
        Ok(ProjectRoot { dir })
    }

    /// The handle that file operations must go through.
    pub fn dir(&self) -> &Dir {
        &self.dir
    }

    /// Checks a path for reading.
    pub fn read_path(&self, raw: &str) -> Result<RelPath, GuardError> {
        RelPath::parse(raw)
    }

    /// Checks a path for writing, creating, renaming or deleting.
    ///
    /// Some limits remain. A symlink swapped in after this check can still redirect a write
    /// to `.git`, though `Dir` keeps it inside the project. A hard link to an outside file
    /// looks like a normal file, but creating one needs a process that can already reach it.
    pub fn write_path(&self, raw: &str) -> Result<RelPath, GuardError> {
        let path = RelPath::parse(raw)?;
        check_not_protected(path.as_path())?;
        self.check_no_symlinks(path.as_path())?;
        Ok(path)
    }

    /// Refuses a write through any symlink, even one that stays inside the project, because
    /// `gitlink/hooks/x` with `gitlink -> .git` would otherwise get past the name checks.
    fn check_no_symlinks(&self, path: &Path) -> Result<(), GuardError> {
        let mut current = PathBuf::new();
        for component in path.components() {
            current.push(component);
            match self.dir.symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(GuardError::ThroughSymlink);
                }
                Ok(_) => {}
                // LEARN: a match guard adds a condition; if it's false, the next arm is tried.
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(GuardError::Io(error.kind())),
            }
        }
        Ok(())
    }
}

/// Refuses paths where a write could end up running code, in any folder of the project.
fn check_not_protected(path: &Path) -> Result<(), GuardError> {
    let names: Vec<String> = path
        .components()
        .map(|component| comparable_name(component.as_os_str()))
        .collect();

    if names.iter().any(|name| name == ".git") {
        return Err(GuardError::Protected);
    }
    if names
        .iter()
        .any(|name| name == ".claude" || name == ".mcp.json")
    {
        return Err(GuardError::NeedsConfirmation);
    }
    Ok(())
}

/// Folds a name the way a case-insensitive disk might, so `.GIT` compares equal to `.git`.
fn comparable_name(name: &OsStr) -> String {
    // LEARN: iterator chains are lazy; nothing runs until `collect` builds the `String`.
    let visible: String = name
        .to_string_lossy()
        .chars()
        .filter(|character| !is_ignored_by_hfs(*character))
        .collect();
    // Upper then lower also folds characters that lowercase alone keeps, like `ſ` to `s`.
    visible.to_uppercase().to_lowercase()
}

/// Invisible characters that older Mac disks (HFS+) ignore in names, so `.g\u{200c}it` opens
/// `.git`. This is the same trick behind git's CVE-2014-9390.
fn is_ignored_by_hfs(character: char) -> bool {
    matches!(
        character,
        '\u{200c}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{206a}'..='\u{206f}' | '\u{feff}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    /// A temp folder holding `project/` and, beside it, a `secret/key` that must stay out of reach.
    struct TestFolders {
        base: PathBuf,
    }

    impl TestFolders {
        fn new() -> TestFolders {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let name = format!("path-guard-{}-{id}", std::process::id());
            let base = std::env::temp_dir().join(name);
            fs::create_dir_all(base.join("project/src")).unwrap();
            fs::create_dir_all(base.join("secret")).unwrap();
            fs::write(base.join("project/src/a.txt"), "inside").unwrap();
            fs::write(base.join("secret/key"), "SECRET").unwrap();
            TestFolders { base }
        }

        fn project(&self) -> PathBuf {
            self.base.join("project")
        }

        fn secret(&self) -> PathBuf {
            self.base.join("secret/key")
        }

        fn open(&self) -> ProjectRoot {
            ProjectRoot::open(&self.project()).unwrap()
        }
    }

    // LEARN: `drop` runs when the value goes out of scope, even if the test panics.
    impl Drop for TestFolders {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn parsed(raw: &str) -> Result<PathBuf, GuardError> {
        RelPath::parse(raw).map(|path| path.as_path().to_path_buf())
    }

    #[test]
    fn accepts_normal_relative_paths() {
        assert_eq!(parsed("main.rs"), Ok(PathBuf::from("main.rs")));
        assert_eq!(
            parsed("src/session/pool.rs"),
            Ok(PathBuf::from("src/session/pool.rs"))
        );
        assert_eq!(parsed(".gitignore"), Ok(PathBuf::from(".gitignore")));
    }

    #[test]
    fn removes_dot_segments_and_trailing_slashes() {
        assert_eq!(parsed("./src/./a.rs"), Ok(PathBuf::from("src/a.rs")));
        assert_eq!(parsed("src/"), Ok(PathBuf::from("src")));
        assert_eq!(parsed("src//a.rs"), Ok(PathBuf::from("src/a.rs")));
    }

    #[test]
    fn rejects_traversal() {
        for raw in [
            "..",
            "../secret",
            "../../.ssh/id_rsa",
            "src/../../secret",
            "src/../a.rs",
        ] {
            assert_eq!(parsed(raw), Err(GuardError::OutsideProject), "{raw}");
        }
    }

    #[test]
    fn rejects_absolute_paths() {
        for raw in ["/", "/etc/passwd", "//etc/passwd"] {
            assert_eq!(parsed(raw), Err(GuardError::OutsideProject), "{raw}");
        }
    }

    #[test]
    fn rejects_paths_that_name_nothing_or_are_malformed() {
        for raw in ["", ".", "./", "a\0b", "..\\secret", "C:\\Windows"] {
            assert_eq!(parsed(raw), Err(GuardError::InvalidPath), "{raw:?}");
        }
    }

    #[test]
    fn opening_a_missing_folder_fails() {
        let folders = TestFolders::new();
        let result = ProjectRoot::open(&folders.base.join("missing"));
        assert_eq!(result.err(), Some(GuardError::Io(io::ErrorKind::NotFound)));
    }

    #[test]
    fn reads_a_file_inside_the_project() {
        let folders = TestFolders::new();
        let project = folders.open();
        let path = project.read_path("src/a.txt").unwrap();
        assert_eq!(
            project.dir().read_to_string(path.as_path()).unwrap(),
            "inside"
        );
    }

    #[test]
    fn read_path_rejects_traversal() {
        let folders = TestFolders::new();
        let project = folders.open();
        assert_eq!(
            project.read_path("../secret/key"),
            Err(GuardError::OutsideProject)
        );
    }

    #[test]
    fn error_messages_never_contain_a_path() {
        let folders = TestFolders::new();
        let error = ProjectRoot::open(&folders.base.join("missing"))
            .err()
            .unwrap();
        assert!(!error.to_string().contains("path-guard"));
    }

    #[test]
    fn write_path_allows_normal_and_new_files() {
        let folders = TestFolders::new();
        let project = folders.open();
        assert!(project.write_path("src/a.txt").is_ok());
        assert!(project.write_path("src/new/deep/file.txt").is_ok());
        assert!(project.write_path(".gitignore").is_ok());
        assert!(project.write_path("src/my.git/file").is_ok());
    }

    #[test]
    fn write_path_rejects_traversal() {
        let folders = TestFolders::new();
        let project = folders.open();
        assert_eq!(
            project.write_path("../secret/key"),
            Err(GuardError::OutsideProject)
        );
    }

    #[test]
    fn git_folder_can_never_be_written() {
        let folders = TestFolders::new();
        let project = folders.open();
        for raw in [
            ".git",
            ".git/hooks/pre-commit",
            ".git/config",
            "vendor/lib/.git/config",
        ] {
            assert_eq!(project.write_path(raw), Err(GuardError::Protected), "{raw}");
        }
    }

    #[test]
    fn git_folder_is_found_after_dot_segments_are_removed() {
        let folders = TestFolders::new();
        let project = folders.open();
        assert_eq!(
            project.write_path("./.git/./config"),
            Err(GuardError::Protected)
        );
    }

    #[test]
    fn git_folder_is_found_in_any_case() {
        let folders = TestFolders::new();
        let project = folders.open();
        for raw in [".GIT/hooks/x", ".Git/config", ".gIt"] {
            assert_eq!(project.write_path(raw), Err(GuardError::Protected), "{raw}");
        }
    }

    #[test]
    fn git_folder_is_found_with_invisible_characters() {
        let folders = TestFolders::new();
        let project = folders.open();
        for raw in [
            ".g\u{200c}it/config",
            "\u{feff}.git/config",
            ".gi\u{206f}t/config",
        ] {
            assert_eq!(
                project.write_path(raw),
                Err(GuardError::Protected),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn claude_config_needs_confirmation() {
        let folders = TestFolders::new();
        let project = folders.open();
        for raw in [
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".claude/hooks/run.sh",
            ".CLAUDE/settings.json",
            ".mcp.json",
            ".MCP.JSON",
            ".mcp.j\u{17f}on",
            "sub/.mcp.json",
        ] {
            assert_eq!(
                project.write_path(raw),
                Err(GuardError::NeedsConfirmation),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn write_path_fails_when_a_parent_is_a_file() {
        let folders = TestFolders::new();
        let project = folders.open();
        assert_eq!(
            project.write_path("src/a.txt/child"),
            Err(GuardError::Io(io::ErrorKind::NotADirectory))
        );
    }

    // Symlinks can be planted by anything writing in the project, including `claude`.
    #[cfg(unix)]
    mod symlink_attacks {
        use super::*;
        use std::os::unix::fs::symlink;
        use std::sync::Arc;
        use std::sync::atomic::AtomicBool;
        use std::thread;

        const DENIED: io::ErrorKind = io::ErrorKind::PermissionDenied;

        fn read_kind(project: &ProjectRoot, raw: &str) -> Result<String, io::ErrorKind> {
            let path = project.read_path(raw).unwrap();
            let result = project.dir().read_to_string(path.as_path());
            result.map_err(|error| error.kind())
        }

        #[test]
        fn cannot_read_through_a_file_symlink_pointing_outside() {
            let folders = TestFolders::new();
            symlink(folders.secret(), folders.project().join("link")).unwrap();
            let project = folders.open();
            assert_eq!(read_kind(&project, "link"), Err(DENIED));
        }

        #[test]
        fn cannot_read_through_a_relative_symlink_pointing_outside() {
            let folders = TestFolders::new();
            symlink("../../secret/key", folders.project().join("src/link")).unwrap();
            let project = folders.open();
            assert_eq!(read_kind(&project, "src/link"), Err(DENIED));
        }

        #[test]
        fn cannot_read_through_a_folder_symlink_pointing_outside() {
            let folders = TestFolders::new();
            symlink(folders.base.join("secret"), folders.project().join("link")).unwrap();
            let project = folders.open();
            assert_eq!(read_kind(&project, "link/key"), Err(DENIED));
            let listing = project.dir().read_dir("link");
            assert_eq!(listing.err().map(|error| error.kind()), Some(DENIED));
        }

        #[test]
        fn can_read_through_a_symlink_that_stays_inside() {
            let folders = TestFolders::new();
            symlink("src/a.txt", folders.project().join("link")).unwrap();
            let project = folders.open();
            assert_eq!(read_kind(&project, "link"), Ok(String::from("inside")));
        }

        #[test]
        fn cannot_create_a_file_through_a_folder_symlink() {
            let folders = TestFolders::new();
            let outside = folders.base.join("secret");
            symlink(&outside, folders.project().join("link")).unwrap();
            let project = folders.open();

            assert_eq!(
                project.write_path("link/new.txt"),
                Err(GuardError::ThroughSymlink)
            );

            // Even a caller that skips the guard is stopped by `Dir`.
            let write = project.dir().write("link/new.txt", "x");
            assert_eq!(write.err().map(|error| error.kind()), Some(DENIED));
            assert!(!outside.join("new.txt").exists());
        }

        #[test]
        fn cannot_overwrite_a_file_through_a_file_symlink() {
            let folders = TestFolders::new();
            symlink(folders.secret(), folders.project().join("link")).unwrap();
            let project = folders.open();

            assert_eq!(project.write_path("link"), Err(GuardError::ThroughSymlink));

            let write = project.dir().write("link", "PWNED");
            assert_eq!(write.err().map(|error| error.kind()), Some(DENIED));
            assert_eq!(fs::read_to_string(folders.secret()).unwrap(), "SECRET");
        }

        #[test]
        fn cannot_create_a_file_through_a_dangling_symlink() {
            let folders = TestFolders::new();
            let target = folders.base.join("secret/planted");
            symlink(&target, folders.project().join("link")).unwrap();
            let project = folders.open();

            assert_eq!(project.write_path("link"), Err(GuardError::ThroughSymlink));

            let write = project.dir().write("link", "x");
            assert_eq!(write.err().map(|error| error.kind()), Some(DENIED));
            assert!(!target.exists());
        }

        #[test]
        fn cannot_reach_git_through_a_symlink_with_a_harmless_name() {
            let folders = TestFolders::new();
            fs::create_dir_all(folders.project().join(".git/hooks")).unwrap();
            symlink(".git", folders.project().join("gitlink")).unwrap();
            let project = folders.open();
            assert_eq!(
                project.write_path("gitlink/hooks/pre-commit"),
                Err(GuardError::ThroughSymlink)
            );
        }

        #[test]
        fn cannot_rename_a_file_out_of_the_project() {
            let folders = TestFolders::new();
            let project = folders.open();
            let dir = project.dir();
            let rename = dir.rename("src/a.txt", dir, "../stolen.txt");
            assert_eq!(rename.err().map(|error| error.kind()), Some(DENIED));
            assert!(!folders.base.join("stolen.txt").exists());
        }

        /// Swaps a real file and an escaping symlink as fast as possible during reads. A guard
        /// that checks a path and then opens it leaks the secret here.
        #[test]
        fn racing_a_symlink_swap_never_leaks_the_secret() {
            const MAX_READS: u32 = 500_000;
            const ENOUGH_OF_EACH: u32 = 500;

            let folders = TestFolders::new();
            let target = folders.project().join("race");
            fs::write(&target, "inside").unwrap();

            let stop = Arc::new(AtomicBool::new(false));
            let stop_for_thread = Arc::clone(&stop);
            let secret = folders.secret();
            let swap_target = target.clone();

            // LEARN: `move` gives the closure ownership, so the data can't die before the thread.
            let swapper = thread::spawn(move || {
                let real_file = swap_target.with_extension("file");
                let link = swap_target.with_extension("link");
                // LEARN: `Arc` shares the flag across threads, and an atomic can change while shared.
                while !stop_for_thread.load(Ordering::Relaxed) {
                    fs::write(&real_file, "inside").unwrap();
                    fs::rename(&real_file, &swap_target).unwrap();
                    symlink(&secret, &link).unwrap();
                    fs::rename(&link, &swap_target).unwrap();
                }
            });

            let project = folders.open();
            let (mut inside, mut denied, mut leaks) = (0, 0, 0);
            for _ in 0..MAX_READS {
                match read_kind(&project, "race") {
                    Ok(text) if text == "SECRET" => leaks += 1,
                    Ok(_) => inside += 1,
                    Err(_) => denied += 1,
                }
                if inside >= ENOUGH_OF_EACH && denied >= ENOUGH_OF_EACH {
                    break;
                }
            }
            stop.store(true, Ordering::Relaxed);
            swapper.join().unwrap();

            assert_eq!(leaks, 0, "read the secret through a swapped symlink");
            assert!(
                inside > 0 && denied > 0,
                "the swap never raced: {inside}, {denied}"
            );
        }
    }
}
