//! Security logic for my-editor. Every security decision is made here, in Rust,
//! because the webview is untrusted.

// LEARN: `#!` applies an attribute to the whole crate; `forbid` can't be overridden further down.
#![forbid(unsafe_code)]

pub mod audit;
// LEARN: `pub mod x;` pulls `src/x.rs` into the crate and exports it; undeclared files aren't compiled.
pub mod path_guard;
pub mod tripwire;

// LEARN: `cfg(test)` compiles this module only under `cargo test`, so it isn't in the shipped binary.
#[cfg(test)]
mod tests {
    #[test]
    fn test_harness_runs() {
        assert_eq!(1 + 1, 2);
    }
}
