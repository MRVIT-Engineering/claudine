// Stops Windows from opening a console next to the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod accounts;
mod claude;
mod error;
mod files;
mod git;
mod history;
mod images;
mod project;
mod proposal;
mod recent;
mod runs;
mod settings;
mod trust;

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};

const NEW_WINDOW: &str = "new-window";

/// Numbers the extra windows `project-1`, `project-2`, …, which `capabilities/main.json` matches.
// LEARN: a `static` lives for the whole program; an atomic lets any thread bump it without a lock.
static NEXT_WINDOW: AtomicUsize = AtomicUsize::new(1);

/// Returns the app version from `Cargo.toml`.
#[tauri::command]
// LEARN: `&'static str` borrows text baked into the binary, so it's valid for the whole program.
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Opens another window with no folder, where the user can open a different project.
fn new_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let label = format!("project-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Claudine")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1000.0, 640.0)
        .build()
}

/// Opens a folder the user chose outside the app: a recent folder in the Dock menu, a folder
/// dropped on the Dock icon, or Finder's Open With. macOS sends these, never the webview.
#[cfg(target_os = "macos")]
fn open_from_os(app: &AppHandle, urls: &[tauri::Url]) {
    for url in urls {
        // Only local folders. A file or a missing folder is skipped.
        let Ok(path) = url.to_file_path() else {
            continue;
        };
        let Ok(path) = path.canonicalize() else {
            continue;
        };
        if !path.is_dir() {
            continue;
        }
        if let Err(error) = open_in_a_window(app, &path) {
            eprintln!("couldn't open {}: {error:?}", path.display());
        }
    }
}

/// Shows `path` in the window that has it, else in a window with no folder, else in a new one.
#[cfg(target_os = "macos")]
fn open_in_a_window(app: &AppHandle, path: &std::path::Path) -> Result<(), error::CommandError> {
    let projects = app.state::<project::ProjectState>();
    if let Some(label) = projects.window_with(path)
        && let Some(window) = app.get_webview_window(&label)
    {
        let _ = window.set_focus();
        return Ok(());
    }
    // Reusing an empty window means a cold start from the Dock doesn't leave one behind.
    let empty = app
        .webview_windows()
        .into_values()
        .find(|window| !projects.has_project(window.label()));
    let (window, reused) = match empty {
        Some(window) => (window, true),
        None => (
            new_window(app).map_err(|_| error::CommandError::Internal)?,
            false,
        ),
    };
    let sessions = app.state::<claude::SessionState>();
    projects.open_folder(&window, path, project::folder_name(path), &sessions)?;
    recent::note(app, path);
    // A window already showing the empty screen asks Rust for its folder again when it
    // reloads. A new window asks when it first loads, after this.
    if reused {
        let _ = window.reload();
    }
    let _ = window.set_focus();
    Ok(())
}

/// The standard menu, with File › New Window (⇧⌘N) added.
fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let new_window = MenuItem::with_id(
        app,
        NEW_WINDOW,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item
            && submenu.text()? == "File"
        {
            submenu.prepend(&new_window)?;
            return Ok(menu);
        }
    }
    // Not every platform's default menu has a File menu.
    menu.append(&Submenu::with_items(app, "File", true, &[&new_window])?)?;
    Ok(menu)
}

fn main() {
    tauri::Builder::default()
        // Used only from Rust. The webview has no `dialog:*` permission.
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        .manage(claude::SessionState::default())
        .manage(claude::ModelsState::default())
        .menu(menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == NEW_WINDOW
                && let Err(error) = new_window(app)
            {
                eprintln!("couldn't open a new window: {error}");
            }
        })
        // A closed window's project goes, and its `claude` process with it.
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window
                    .state::<project::ProjectState>()
                    .close(window.label());
                window.state::<claude::SessionState>().stop(window.label());
            }
        })
        // LEARN: `setup` returns `Result<(), Box<dyn Error>>`, so `?` works for any error type.
        .setup(|app| {
            // Per user: ~/Library/Application Support/<identifier>/ on macOS.
            let path = app.path().app_config_dir()?.join("settings.json");
            app.manage(settings::SettingsState::load(path));
            let trusted = app.path().app_config_dir()?.join("trusted-projects.json");
            app.manage(trust::TrustState::load(trusted));
            let accounts = app.path().app_config_dir()?.join("accounts.json");
            let folders = app.path().app_data_dir()?.join("accounts");
            app.manage(accounts::AccountsState::load(accounts, folders));
            let runs = runs::RunsState::load(&app.path().app_data_dir()?);
            runs.set_app(app.handle().clone());
            let handle = app.handle().clone();
            runs.watch_limits(std::sync::Arc::new(move || {
                handle.state::<settings::SettingsState>().current()
            }));
            app.manage(runs);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            project::open_project,
            project::current_project,
            project::list_dir,
            project::read_file,
            project::save_file,
            project::blame_line,
            history::git_log,
            history::git_commit_files,
            history::git_status,
            history::git_diff,
            project::list_files,
            settings::get_settings,
            settings::set_settings,
            claude::claude_status,
            claude::start_session,
            claude::send_message,
            claude::answer_permission,
            claude::interrupt_session,
            claude::stop_session,
            claude::set_mode,
            claude::set_model,
            claude::set_effort,
            claude::list_models,
            accounts::list_accounts,
            accounts::add_account,
            accounts::update_account,
            accounts::remove_account,
            accounts::account_status,
            accounts::sign_in,
            accounts::submit_sign_in_code,
            accounts::cancel_sign_in,
            accounts::sign_out,
            runs::new_run_info,
            runs::start_run,
            runs::list_runs,
            runs::watch_runs,
            runs::run_transcript,
            runs::send_run_message,
            runs::answer_run_permission,
            runs::stop_run,
            runs::resume_run,
            runs::review_run_now,
            runs::run_changes,
            runs::add_run_comment,
            runs::delete_run_comment,
            runs::set_run_viewed,
            runs::request_run_changes,
            runs::gh_status,
            runs::approve_run,
            runs::discard_run,
            runs::open_run_in_editor,
            runs::set_run_options,
        ])
        .build(tauri::generate_context!())
        // LEARN: `expect` crashes with this message on `Err`; there's nothing to recover to here.
        .expect("failed to start the app")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                open_from_os(_app, &urls);
            }
        });
}
