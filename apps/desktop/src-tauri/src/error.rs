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
    /// The file changed on disk since it was opened, so saving would overwrite that change.
    Conflict,
    Io {
        detail: String,
    },
    /// A thread panicked while holding the project lock.
    Internal,
    /// Claude Code isn't installed in any of the usual places.
    ClaudeNotFound,
    /// This Claude Code has no `claude auth` command, so accounts can't be managed.
    ClaudeTooOld,
    /// The user didn't trust the folder, so `claude` wasn't started.
    NotTrusted,
    /// No session or sign-in is running, or its process has exited.
    NoSession,
    /// A label, code or account id the command can't use.
    InvalidInput,
    TooManyAccounts,
    /// `claude auth logout` failed, so the account was kept.
    SignOutFailed,
    /// `git` isn't installed where Claudine can find it.
    GitNotFound,
    /// The open folder isn't inside a git repository, so runs can't make branches.
    NotARepository,
    /// A git or gh command failed. `detail` is its last error line, home shortened to `~`.
    Git {
        detail: String,
    },
    /// `gh` isn't installed, or isn't signed in, so no pull request can be opened.
    GhUnavailable,
    /// The run is in a state where this can't be done, such as approving while it runs.
    WrongState,
    /// The user cancelled a native confirmation dialog.
    Cancelled,
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
