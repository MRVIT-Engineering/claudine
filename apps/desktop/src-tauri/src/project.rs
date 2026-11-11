//! The project open in each window, and the commands that read it.

use crate::claude::SessionState;
use crate::error::CommandError;
use crate::files::{self, DirEntry, FileList, FileText};
use crate::git::{Blame, Git};
use crate::settings::SettingsState;
use my_editor_core::path_guard::ProjectRoot;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub struct Project {
    root: ProjectRoot,
    name: String,
    /// Canonical, for `claude`'s working folder and the trust list. Never sent to the
    /// webview, and never used to reach project files: those go through `root`.
    path: PathBuf,
}

/// The project open in each window, by window label. A window with no folder has no entry.
/// Commands can run on several threads at once.
// LEARN: `Mutex` lets one thread at a time use the value.
#[derive(Default)]
pub struct ProjectState(Mutex<HashMap<String, Project>>);

/// What the webview learns about a project: its folder's name, never its full path.
#[derive(Serialize)]
pub struct ProjectInfo {
    name: String,
}

fn info(project: &Project) -> ProjectInfo {
    ProjectInfo {
        name: project.name.clone(),
    }
}

impl ProjectState {
    /// The project open in `window`: its name and canonical folder, for starting `claude` there.
    pub fn name_and_path(&self, window: &str) -> Result<(String, PathBuf), CommandError> {
        let open = self.0.lock().map_err(|_| CommandError::Internal)?;
        let Some(project) = open.get(window) else {
            return Err(CommandError::NoProject);
        };
        Ok((project.name.clone(), project.path.clone()))
    }

    /// The window that has `path` open, if any.
    pub fn window_with(&self, path: &Path) -> Option<String> {
        let open = self.0.lock().ok()?;
        open.iter()
            .find(|(_, project)| project.path == path)
            .map(|(label, _)| label.clone())
    }

    /// Whether `window` has a folder open.
    pub fn has_project(&self, window: &str) -> bool {
        self.0.lock().is_ok_and(|open| open.contains_key(window))
    }

    /// Checks `raw` with the path guard of the project open in `window`.
    pub fn check_read_path(&self, window: &str, raw: &str) -> Result<PathBuf, CommandError> {
        let open = self.0.lock().map_err(|_| CommandError::Internal)?;
        let project = open.get(window).ok_or(CommandError::NoProject)?;
        Ok(project.root.read_path(raw)?.as_path().to_path_buf())
    }

    /// Reads a file of the project open in `window`, through the guard.
    pub fn read_file(&self, window: &str, raw: &str) -> Result<FileText, CommandError> {
        let open = self.0.lock().map_err(|_| CommandError::Internal)?;
        let project = open.get(window).ok_or(CommandError::NoProject)?;
        files::read_file(&project.root, raw)
    }

    /// Forgets the project of a window that closed.
    pub fn close(&self, window: &str) {
        if let Ok(mut open) = self.0.lock() {
            open.remove(window);
        }
    }
}

// LEARN: Tauri fills in `window` with the window that called; JavaScript can't pass or fake it.
#[tauri::command]
pub fn current_project(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
) -> Result<Option<ProjectInfo>, CommandError> {
    // `lock()` fails only if a thread panicked while holding it, leaving the data suspect.
    let open = state.0.lock().map_err(|_| CommandError::Internal)?;
    Ok(open.get(window.label()).map(info))
}

/// Shows the native folder picker, from Rust.
///
/// The webview can't pass a path here, so compromised JavaScript can't open `~/.ssh` as a
/// project. `async` runs this off the main thread, which the blocking picker requires.
#[tauri::command(async)]
pub fn open_project(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    sessions: State<'_, SessionState>,
) -> Result<Option<ProjectInfo>, CommandError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open Folder")
        .blocking_pick_folder();
    // LEARN: `let ... else` unwraps the `Option`, or runs the `else` block when it's `None`.
    let Some(picked) = picked else {
        return Ok(None);
    };
    // Desktop pickers return plain paths. The `None` case is a mobile-only URI.
    let Some(path) = picked.as_path() else {
        return Err(CommandError::InvalidPath);
    };

    // Resolves symlinks and `..`, so the trust list has one spelling per folder.
    let path = path.canonicalize()?;
    let opened = state.open_folder(&window, &path, folder_name(&path), &sessions)?;
    crate::recent::note(&app, &path);
    Ok(Some(opened))
}

/// The name the UI shows for a folder: its last component.
pub fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| String::from("/"))
}

impl ProjectState {
    /// Makes `path` the project open in `window`. Only for folders Rust chose: the native
    /// picker's answer, or a run's own worktree.
    pub fn open_folder(
        &self,
        window: &WebviewWindow,
        path: &Path,
        name: String,
        sessions: &SessionState,
    ) -> Result<ProjectInfo, CommandError> {
        let path = path.canonicalize()?;
        let root = ProjectRoot::open(&path)?;
        let project = Project { root, name, path };
        let opened = info(&project);
        let mut open = self.0.lock().map_err(|_| CommandError::Internal)?;
        open.insert(window.label().to_string(), project);
        // A session keeps running in the folder it started in, so end it with the project.
        sessions.stop(window.label());
        // Tells the windows apart in the Window menu and the Dock. Cosmetic, so a failure is ignored.
        let _ = window.set_title(&format!("{} — Claudine", opened.name));
        Ok(opened)
    }
}

#[tauri::command(async)]
pub fn list_dir(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    settings: State<'_, SettingsState>,
    path: Option<String>,
) -> Result<Vec<DirEntry>, CommandError> {
    let hidden = settings.excluded_names();
    let open = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = open.get(window.label()) else {
        return Err(CommandError::NoProject);
    };
    files::list_dir(&project.root, path.as_deref(), &hidden)
}

#[tauri::command(async)]
pub fn read_file(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    path: String,
) -> Result<FileText, CommandError> {
    let open = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = open.get(window.label()) else {
        return Err(CommandError::NoProject);
    };
    files::read_file(&project.root, &path)
}

/// Saves an open file. `expected_version` is the version it was read or last saved at;
/// `None` overwrites whatever is on disk, once the user chose to.
#[tauri::command(async)]
pub fn save_file(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    path: String,
    text: String,
    expected_version: Option<String>,
) -> Result<String, CommandError> {
    let open = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = open.get(window.label()) else {
        return Err(CommandError::NoProject);
    };
    files::save_file(&project.root, &path, &text, expected_version.as_deref())
}

#[tauri::command(async)]
pub fn list_files(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    settings: State<'_, SettingsState>,
) -> Result<FileList, CommandError> {
    let hidden = settings.excluded_names();
    // Read-only git, before taking the lock. Outside a repository nothing is ignored.
    let (_, folder) = state.name_and_path(window.label())?;
    let ignored = Git::find()
        .and_then(|git| git.ignored(&folder))
        .unwrap_or_default();
    let open = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = open.get(window.label()) else {
        return Err(CommandError::NoProject);
    };
    files::list_files(&project.root, &hidden, &ignored)
}

/// Who last changed one line of an open file, for the editor's inline blame. `text` is the
/// buffer when it has unsaved edits, so line numbers match. Read-only git; `None` outside a
/// repository or for untracked files.
#[tauri::command(async)]
pub fn blame_line(
    window: WebviewWindow,
    state: State<'_, ProjectState>,
    path: String,
    line: u32,
    text: Option<String>,
) -> Result<Option<Blame>, CommandError> {
    if line == 0
        || text
            .as_ref()
            .is_some_and(|t| t.len() as u64 > files::MAX_FILE_BYTES)
    {
        return Err(CommandError::InvalidInput);
    }
    let (_, folder) = state.name_and_path(window.label())?;
    let checked = {
        let open = state.0.lock().map_err(|_| CommandError::Internal)?;
        let project = open.get(window.label()).ok_or(CommandError::NoProject)?;
        // The guard's check: relative, inside the project, no `..`.
        project.root.read_path(&path)?
    };
    let relative = checked
        .as_path()
        .to_str()
        .ok_or(CommandError::InvalidPath)?;
    let Ok(git) = Git::find() else {
        return Ok(None);
    };
    git.blame_line(&folder, relative, line, text.as_deref())
}
