// Stops Windows from opening a console next to the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod files;
mod project;
mod settings;

use tauri::Manager;

/// Returns the app version from `Cargo.toml`.
#[tauri::command]
// LEARN: `&'static str` borrows text baked into the binary, so it's valid for the whole program.
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn main() {
    tauri::Builder::default()
        // Used only from Rust. The webview has no `dialog:*` permission.
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        // LEARN: `setup` returns `Result<(), Box<dyn Error>>`, so `?` works for any error type.
        .setup(|app| {
            // Per user: ~/Library/Application Support/<identifier>/ on macOS.
            let path = app.path().app_config_dir()?.join("settings.json");
            app.manage(settings::SettingsState::load(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            project::open_project,
            project::current_project,
            project::list_dir,
            project::read_file,
            project::list_files,
            settings::get_settings,
            settings::set_settings,
        ])
        .run(tauri::generate_context!())
        // LEARN: `expect` crashes with this message on `Err`; there's nothing to recover to here.
        .expect("failed to run the app");
}
