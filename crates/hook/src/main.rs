//! Claude Code hook binary. It will become the PreToolUse/PostToolUse sidecar;
//! for now it reads stdin, ignores it, and exits.

// LEARN: importing the `Read` trait is what makes `.read_to_string()` callable below.
use std::io::{self, Read};

// LEARN: returning `Err` from `main` prints the error and exits non-zero instead of panicking.
fn main() -> io::Result<()> {
    let mut input = String::new();
    // LEARN: `&mut` lends write access; `input` needed `let mut` to allow it.
    io::stdin().read_to_string(&mut input)?;
    Ok(())
}
