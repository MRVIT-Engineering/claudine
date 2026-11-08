//! The user's settings, stored as JSON in their app config folder.
//!
//! Rust owns this file: the webview sends a whole `Settings` value, and Rust checks it
//! before saving, so a broken or hand-edited file can't put the app in a bad state.

use crate::error::CommandError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

pub const MIN_FONT_SIZE: u32 = 10;
pub const MAX_FONT_SIZE: u32 = 24;
pub const MAX_TAB_SIZE: u32 = 8;
const MAX_EXCLUDED: usize = 64;
/// Allowed widths, in pixels, for each resizable sidebar.
pub const SIDEBAR_WIDTHS: (u32, u32) = (160, 600);
pub const CHAT_WIDTHS: (u32, u32) = (260, 720);
pub const SETTINGS_NAV_WIDTHS: (u32, u32) = (160, 400);
const MAX_NAME_LENGTH: usize = 255;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Accent {
    Violet,
    Coral,
    Peach,
    Rust,
    Blue,
    Green,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorFont {
    Jetbrains,
    Sf,
    Menlo,
    Fira,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Whitespace {
    None,
    Trailing,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLayout {
    Side,
    Inline,
}

/// Every setting the app has. Field names match the TypeScript `Settings` type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// LEARN: `default` fills any field missing from the file with its value from `Default`.
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub accent: Accent,
    pub font_size: u32,
    pub editor_font: EditorFont,
    pub ligatures: bool,
    pub line_height: f64,
    pub tab_size: u32,
    pub insert_spaces: bool,
    pub wrap_lines: bool,
    pub line_numbers: bool,
    pub highlight_active_line: bool,
    pub whitespace: Whitespace,
    pub bracket_matching: bool,
    pub fold_gutter: bool,
    pub cursor_blinking: bool,
    pub scroll_past_end: bool,
    pub suggest_on_type: bool,
    pub close_brackets: bool,
    pub diff_layout: DiffLayout,
    /// File and folder names left out of the tree, Go to file and search.
    pub excluded_names: Vec<String>,
    pub sidebar_width: u32,
    pub chat_width: u32,
    pub settings_nav_width: u32,
    pub setup_done: bool,
}

// LEARN: `Default` is the trait for "the value to use when nothing else is given".
impl Default for Settings {
    fn default() -> Settings {
        Settings {
            theme: Theme::Dark,
            accent: Accent::Violet,
            font_size: 13,
            editor_font: EditorFont::Jetbrains,
            ligatures: true,
            line_height: 1.6,
            tab_size: 4,
            insert_spaces: true,
            wrap_lines: true,
            line_numbers: true,
            highlight_active_line: true,
            whitespace: Whitespace::None,
            bracket_matching: true,
            fold_gutter: true,
            cursor_blinking: true,
            scroll_past_end: false,
            suggest_on_type: true,
            close_brackets: true,
            diff_layout: DiffLayout::Side,
            excluded_names: [".git", ".DS_Store", "node_modules", "target"]
                .map(String::from)
                .to_vec(),
            sidebar_width: 240,
            chat_width: 320,
            settings_nav_width: 210,
            setup_done: false,
        }
    }
}

impl Settings {
    /// Brings every value into range, so no file or webview message can break the app.
    // LEARN: `self` by value: the caller hands the settings over and gets the fixed ones back.
    pub fn sanitized(mut self) -> Settings {
        self.font_size = self.font_size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
        self.tab_size = self.tab_size.clamp(1, MAX_TAB_SIZE);
        self.sidebar_width = self.sidebar_width.clamp(SIDEBAR_WIDTHS.0, SIDEBAR_WIDTHS.1);
        self.chat_width = self.chat_width.clamp(CHAT_WIDTHS.0, CHAT_WIDTHS.1);
        self.settings_nav_width = self
            .settings_nav_width
            .clamp(SETTINGS_NAV_WIDTHS.0, SETTINGS_NAV_WIDTHS.1);
        self.line_height = if self.line_height.is_finite() {
            self.line_height.clamp(1.0, 2.5)
        } else {
            Settings::default().line_height
        };

        // Names only, never paths, so an entry can't hide something outside one folder.
        let mut names: Vec<String> = Vec::new();
        for name in self.excluded_names {
            let name = name.trim().to_string();
            let usable = !name.is_empty()
                && name.len() <= MAX_NAME_LENGTH
                && !name.contains('/')
                && !name.contains('\\')
                && !name.contains('\0');
            if usable && !names.contains(&name) && names.len() < MAX_EXCLUDED {
                names.push(name);
            }
        }
        self.excluded_names = names;
        self
    }
}

/// Reads the settings file. A missing file gives the defaults. A file that can't be
/// parsed is moved aside to `settings.json.invalid`, so it isn't silently overwritten.
///
/// Returns the settings, and whether a usable file was there.
pub fn load(path: &Path) -> (Settings, bool) {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Settings>(&text) {
            Ok(settings) => (settings.sanitized(), true),
            Err(_) => {
                let _ = fs::rename(path, path.with_extension("json.invalid"));
                (Settings::default(), false)
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => (Settings::default(), false),
        // Unreadable but present: use defaults, and don't import over it.
        Err(_) => (Settings::default(), true),
    }
}

/// Writes the settings to a temp file, then renames it into place. A rename is atomic,
/// so a crash leaves either the old file or the new one, never half of one.
pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text)?;
    fs::rename(&temp, path)
}

struct Current {
    settings: Settings,
    /// Whether a settings file existed, so the UI knows to import its old settings once.
    existed: bool,
}

pub struct SettingsState {
    path: PathBuf,
    current: Mutex<Current>,
}

impl SettingsState {
    /// Loads from `path`, which is in the app's own config folder, chosen by Rust. It's
    /// never a project path, so it doesn't go through the path guard.
    pub fn load(path: PathBuf) -> SettingsState {
        let (settings, existed) = load(&path);
        SettingsState {
            path,
            current: Mutex::new(Current { settings, existed }),
        }
    }

    /// The names to leave out of listings, copied so the lock isn't held while listing.
    pub fn excluded_names(&self) -> Vec<String> {
        match self.current.lock() {
            // LEARN: `clone` copies the value, so it can be used after the lock is released.
            Ok(current) => current.settings.excluded_names.clone(),
            Err(_) => Settings::default().excluded_names,
        }
    }
}

#[derive(Serialize)]
pub struct LoadedSettings {
    settings: Settings,
    existed: bool,
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<LoadedSettings, CommandError> {
    let current = state.current.lock().map_err(|_| CommandError::Internal)?;
    Ok(LoadedSettings {
        settings: current.settings.clone(),
        existed: current.existed,
    })
}

/// Saves a whole settings value. Returns what was stored, after `sanitized`.
#[tauri::command(async)]
pub fn set_settings(
    state: State<'_, SettingsState>,
    settings: Settings,
) -> Result<Settings, CommandError> {
    let clean = settings.sanitized();
    let mut current = state.current.lock().map_err(|_| CommandError::Internal)?;
    save(&state.path, &clean)?;
    current.settings = clean.clone();
    current.existed = true;
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> TempDir {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("settings-{}-{id}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join("config/settings.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_missing_file_gives_defaults() {
        let dir = TempDir::new();
        assert_eq!(load(&dir.file()), (Settings::default(), false));
    }

    #[test]
    fn saving_then_loading_round_trips() {
        let dir = TempDir::new();
        let settings = Settings {
            theme: Theme::System,
            font_size: 16,
            excluded_names: vec![String::from("dist")],
            ..Settings::default()
        };
        save(&dir.file(), &settings).unwrap();
        assert_eq!(load(&dir.file()), (settings, true));
        assert!(!dir.file().with_extension("json.tmp").exists());
    }

    #[test]
    fn fields_missing_from_the_file_get_defaults() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.file().parent().unwrap()).unwrap();
        fs::write(dir.file(), r#"{ "fontSize": 18, "theme": "light" }"#).unwrap();
        let (settings, existed) = load(&dir.file());
        assert!(existed);
        assert_eq!(settings.font_size, 18);
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.tab_size, Settings::default().tab_size);
    }

    #[test]
    fn an_unreadable_file_is_kept_aside_and_defaults_are_used() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.file().parent().unwrap()).unwrap();
        fs::write(dir.file(), "{ not json").unwrap();
        assert_eq!(load(&dir.file()), (Settings::default(), false));
        let kept = fs::read_to_string(dir.file().with_extension("json.invalid")).unwrap();
        assert_eq!(kept, "{ not json");
    }

    #[test]
    fn an_unknown_value_makes_the_file_invalid() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.file().parent().unwrap()).unwrap();
        fs::write(dir.file(), r#"{ "theme": "neon" }"#).unwrap();
        assert_eq!(load(&dir.file()).0, Settings::default());
    }

    #[test]
    fn numbers_are_brought_into_range() {
        let settings = Settings {
            font_size: 400,
            tab_size: 0,
            line_height: f64::NAN,
            sidebar_width: 5,
            chat_width: 10_000,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.font_size, MAX_FONT_SIZE);
        assert_eq!(settings.tab_size, 1);
        assert_eq!(settings.line_height, Settings::default().line_height);
        assert_eq!(settings.sidebar_width, SIDEBAR_WIDTHS.0);
        assert_eq!(settings.chat_width, CHAT_WIDTHS.1);
    }

    #[test]
    fn excluded_names_are_cleaned_up() {
        let settings = Settings {
            excluded_names: [" dist ", "", "dist", "a/b", "..\\x", "ok\0", "build"]
                .map(String::from)
                .to_vec(),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.excluded_names, ["dist", "build"]);
    }

    #[test]
    fn excluded_names_are_capped() {
        let names = (0..100).map(|i| format!("name-{i}")).collect();
        let settings = Settings {
            excluded_names: names,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(settings.excluded_names.len(), MAX_EXCLUDED);
    }
}
