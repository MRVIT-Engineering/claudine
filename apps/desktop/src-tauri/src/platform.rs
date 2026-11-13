//! What differs between macOS, Linux and Windows: starting processes, finding programs,
//! the home folder and canonical paths. Everything else is the same on every OS.

use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Starts building a command for `program`, which must be an absolute path.
///
/// Every process Claudine starts goes through here. On Windows the app has no console, so
/// without `CREATE_NO_WINDOW` each `claude` or `git` would flash a console window.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The user's home folder: `HOME` on macOS and Linux, the profile folder on Windows.
pub fn home_dir() -> Option<PathBuf> {
    std::env::home_dir().filter(|home| home.is_absolute())
}

/// `name` as an executable file name: `git` on macOS and Linux, `git.exe` on Windows.
///
/// Only `.exe` on Windows, never `.cmd` or `.bat`: those run through `cmd.exe`, which
/// reads `&`, `|` and `%` in arguments as commands, and Claudine passes text from the
/// user and from Claude as arguments.
pub fn exe_name(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

/// Finds an executable by name on `PATH`, then in `extra` folders.
/// Relative `PATH` entries are skipped, so a project can't supply its own program.
pub fn find_program(name: &str, extra: &[PathBuf]) -> Option<PathBuf> {
    let file_name = exe_name(name);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for folder in std::env::split_paths(&path).filter(|folder| folder.is_absolute()) {
            candidates.push(folder.join(&file_name));
        }
    }
    for folder in extra.iter().filter(|folder| folder.is_absolute()) {
        candidates.push(folder.join(&file_name));
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

/// On Windows the `.exe` name is what makes a file runnable.
#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// Where programs are usually installed when they aren't on `PATH`. Apps started from the
/// Dock or the Start menu may get a shorter `PATH` than a terminal.
pub fn install_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if cfg!(windows) {
        if let Some(programs) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            folders.push(programs.join("Git").join("cmd"));
            folders.push(programs.join("GitHub CLI"));
        }
    } else {
        for folder in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            folders.push(PathBuf::from(folder));
        }
    }
    folders
}

/// Windows' own `cmd.exe`, from the system folder rather than `PATH` or `COMSPEC`.
#[cfg(windows)]
pub fn cmd_exe() -> PathBuf {
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    system_root.join("System32").join("cmd.exe")
}

/// A shell command for a check such as `cargo test`, with stderr merged into stdout.
#[cfg(unix)]
pub fn shell(script: &str) -> Command {
    let mut command = self::command("/bin/sh");
    command.args(["-c", &format!("{script} 2>&1")]);
    command
}

/// A shell command for a check such as `cargo test`, with stderr merged into stdout.
#[cfg(windows)]
pub fn shell(script: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = self::command(cmd_exe());
    // `/D` skips AutoRun commands from the registry. With `/S`, cmd drops the outer quotes
    // and runs the rest as written. `raw_arg`, because Rust's quoting isn't cmd's.
    command
        .args(["/D", "/S", "/C"])
        .raw_arg(format!("\"{script} 2>&1\""));
    command
}

/// Like `Path::canonicalize`, but without the `\\?\` that Windows puts in front.
///
/// Claude Code and git write `C:\code\app`, so a project root of `\\?\C:\code\app` would
/// match none of their paths. The prefix stays when removing it could change which file
/// the path names: a name Windows reads differently, or a path too long without it.
pub fn canonicalize(path: &Path) -> io::Result<PathBuf> {
    Ok(without_verbatim_prefix(path.canonicalize()?))
}

#[cfg(windows)]
fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    use my_editor_core::path_guard::is_windows_safe_name;
    use std::path::{Component, Prefix};

    /// Longer paths only work with the prefix.
    const MAX_PATH: usize = 260;

    let Some(text) = path.to_str() else {
        return path;
    };
    let Some(rest) = text.strip_prefix(r"\\?\") else {
        return path;
    };
    let simple = PathBuf::from(rest);
    // LEARN: a nested pattern checks the first component and the prefix kind in one step.
    let is_drive = matches!(
        simple.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))
    );
    let names_are_safe = simple.components().all(|component| match component {
        Component::Normal(name) => is_windows_safe_name(name),
        _ => true,
    });
    if is_drive && names_are_safe && rest.len() < MAX_PATH {
        simple
    } else {
        path
    }
}

#[cfg(not(windows))]
fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executables_get_the_platform_suffix() {
        if cfg!(windows) {
            assert_eq!(exe_name("git"), "git.exe");
        } else {
            assert_eq!(exe_name("git"), "git");
        }
    }

    #[test]
    fn git_is_found_as_an_absolute_path() {
        let git = find_program("git", &install_folders()).expect("git is installed");
        assert!(git.is_absolute());
    }

    #[test]
    fn a_shell_check_reports_success_and_output() {
        let output = shell("echo checked").output().unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("checked"));
        assert!(!shell("exit 3").status().unwrap().success());
    }

    #[test]
    fn canonical_paths_are_absolute_and_plain() {
        let canonical = canonicalize(&std::env::temp_dir()).unwrap();
        assert!(canonical.is_absolute());
        assert!(!canonical.to_string_lossy().starts_with(r"\\?\"));
    }

    #[cfg(windows)]
    #[test]
    fn the_verbatim_prefix_stays_when_removing_it_would_change_the_path() {
        for kept in [
            r"\\?\C:\code\app.",
            r"\\?\C:\code\NUL",
            r"\\?\UNC\server\share\app",
            r"\\?\Volume{0b1c}\app",
        ] {
            assert_eq!(
                without_verbatim_prefix(PathBuf::from(kept)),
                PathBuf::from(kept)
            );
        }
        let long = format!(r"\\?\C:\{}", "a".repeat(300));
        assert_eq!(
            without_verbatim_prefix(PathBuf::from(&long)),
            PathBuf::from(&long)
        );
        assert_eq!(
            without_verbatim_prefix(PathBuf::from(r"\\?\C:\code\app")),
            PathBuf::from(r"C:\code\app")
        );
    }
}
