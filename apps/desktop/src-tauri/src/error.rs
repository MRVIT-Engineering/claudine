//! Errors that commands send to the webview.

use my_editor_core::path_guard::GuardError;
use serde::Serialize;
use std::io;

/// Every way a command can fail.
///
/// Serialized as `{ "kind": "notFound" }` and so on, so the UI can `switch` on `kind`.
/// Nothing here carries a path, because the webview has no need to learn real paths.
#[derive(Debug, PartialEq, Serialize)]
// LEARN: `rename_all` turns `NotFound` into "notFound" for TypeScript.
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandError {
    NoProject,
    InvalidPath,
    OutsideProject,
    Protected,
    NeedsConfirmation,
    ThroughSymlink,
    NotFound,
    /// No permission, or a symlink leading outside the project.
    AccessDenied,
    NotADirectory,
    IsADirectory,
    TooLarge,
    NotText,
    Io {
        detail: String,
    },
    /// A thread panicked while holding the project lock.
    Internal,
}

// LEARN: a `From` impl is what lets `?` turn a `GuardError` into a `CommandError` by itself.
impl From<GuardError> for CommandError {
    fn from(error: GuardError) -> CommandError {
        match error {
            GuardError::InvalidPath => CommandError::InvalidPath,
            GuardError::OutsideProject => CommandError::OutsideProject,
            GuardError::Protected => CommandError::Protected,
            GuardError::NeedsConfirmation => CommandError::NeedsConfirmation,
            GuardError::ThroughSymlink => CommandError::ThroughSymlink,
            GuardError::Io(kind) => CommandError::from(kind),
        }
    }
}

impl From<io::ErrorKind> for CommandError {
    fn from(kind: io::ErrorKind) -> CommandError {
        match kind {
            io::ErrorKind::NotFound => CommandError::NotFound,
            // cap-std reports an escape out of the project as `PermissionDenied`.
            io::ErrorKind::PermissionDenied => CommandError::AccessDenied,
            io::ErrorKind::NotADirectory => CommandError::NotADirectory,
            io::ErrorKind::IsADirectory => CommandError::IsADirectory,
            // `ErrorKind`'s text never includes a path, unlike `io::Error`'s.
            other => CommandError::Io {
                detail: other.to_string(),
            },
        }
    }
}

impl From<io::Error> for CommandError {
    fn from(error: io::Error) -> CommandError {
        CommandError::from(error.kind())
    }
}
