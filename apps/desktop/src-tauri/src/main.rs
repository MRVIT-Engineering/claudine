// Stops Windows from opening a console next to the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Returns the app version from `Cargo.toml`.
#[tauri::command]
// LEARN: `&'static str` borrows text baked into the binary, so it's valid for the whole program.
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        // LEARN: `expect` crashes with this message on `Err`; there's nothing to recover to here.
        .expect("failed to run the app");
}
