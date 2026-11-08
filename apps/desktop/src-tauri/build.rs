fn main() {
    // Tauri embeds the icons at compile time but only watches tauri.conf.json, so a
    // changed icon would otherwise keep the old one in the binary.
    println!("cargo:rerun-if-changed=icons");
    // Listing commands here makes each one deny-by-default: the webview can only
    // call a command that a capability file grants.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "app_version",
        "open_project",
        "current_project",
        "list_dir",
        "read_file",
        "list_files",
        "get_settings",
        "set_settings",
        "claude_status",
        "start_session",
        "send_message",
        "answer_permission",
        "interrupt_session",
        "stop_session",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(manifest);
    tauri_build::try_build(attributes).expect("tauri-build failed");
}
