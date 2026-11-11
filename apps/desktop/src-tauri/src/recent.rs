//! Recent folders in the Dock menu. macOS keeps the list and draws the menu; Claudine only
//! reports each folder the user opens, and opens one when the user picks it.

use std::path::Path;
use tauri::AppHandle;

/// Adds `path` to the top of the Dock menu's recent folders. Does nothing outside macOS.
// LEARN: `#[cfg(...)]` keeps a whole item out of the build on other platforms, like `#[cfg(test)]`.
#[cfg(target_os = "macos")]
pub fn note(app: &AppHandle, path: &Path) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSDocumentController;
    use objc2_foundation::NSURL;

    let path = path.to_path_buf();
    // AppKit may only be used from the main thread. A failure only leaves the list unchanged.
    let _ = app.run_on_main_thread(move || {
        // LEARN: `MainThreadMarker` is a proof value: `new()` returns `Some` only on the main
        // thread, and AppKit methods that need that thread take one as an argument.
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(url) = NSURL::from_directory_path(&path) else {
            return;
        };
        NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&url);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn note(_app: &AppHandle, _path: &Path) {}
