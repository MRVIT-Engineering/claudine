fn main() {
    // Listing commands here makes each one deny-by-default: the webview can only
    // call a command that a capability file grants.
    let manifest = tauri_build::AppManifest::new().commands(&["app_version"]);
    let attributes = tauri_build::Attributes::new().app_manifest(manifest);
    tauri_build::try_build(attributes).expect("tauri-build failed");
}
