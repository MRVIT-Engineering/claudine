//! The open project, and the commands that read it.

use crate::error::CommandError;
use crate::files::{self, DirEntry, FileList};
use crate::settings::SettingsState;
use my_editor_core::path_guard::ProjectRoot;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

pub struct Project {
    root: ProjectRoot,
    name: String,
}

/// The project open in the app, if any. Commands can run on several threads at once.
// LEARN: `Mutex` lets one thread at a time use the value; `Option` because none may be open.
#[derive(Default)]
pub struct ProjectState(Mutex<Option<Project>>);

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

#[tauri::command]
pub fn current_project(
    state: State<'_, ProjectState>,
) -> Result<Option<ProjectInfo>, CommandError> {
    // `lock()` fails only if a thread panicked while holding it, leaving the data suspect.
    let current = state.0.lock().map_err(|_| CommandError::Internal)?;
    Ok(current.as_ref().map(info))
}

/// Shows the native folder picker, from Rust.
///
/// The webview can't pass a path here, so compromised JavaScript can't open `~/.ssh` as a
/// project. `async` runs this off the main thread, which the blocking picker requires.
#[tauri::command(async)]
pub fn open_project(
    app: AppHandle,
    state: State<'_, ProjectState>,
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

    let root = ProjectRoot::open(path)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| String::from("/"));
    let project = Project { root, name };
    let opened = info(&project);

    let mut current = state.0.lock().map_err(|_| CommandError::Internal)?;
    // `*` writes through the lock guard into the value it protects.
    *current = Some(project);
    Ok(Some(opened))
}

#[tauri::command(async)]
pub fn list_dir(
    state: State<'_, ProjectState>,
    settings: State<'_, SettingsState>,
    path: Option<String>,
) -> Result<Vec<DirEntry>, CommandError> {
    let hidden = settings.excluded_names();
    let current = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = current.as_ref() else {
        return Err(CommandError::NoProject);
    };
    files::list_dir(&project.root, path.as_deref(), &hidden)
}

#[tauri::command(async)]
pub fn read_file(state: State<'_, ProjectState>, path: String) -> Result<String, CommandError> {
    let current = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = current.as_ref() else {
        return Err(CommandError::NoProject);
    };
    files::read_file(&project.root, &path)
}

#[tauri::command(async)]
pub fn list_files(
    state: State<'_, ProjectState>,
    settings: State<'_, SettingsState>,
) -> Result<FileList, CommandError> {
    let hidden = settings.excluded_names();
    let current = state.0.lock().map_err(|_| CommandError::Internal)?;
    let Some(project) = current.as_ref() else {
        return Err(CommandError::NoProject);
    };
    files::list_files(&project.root, &hidden)
}
