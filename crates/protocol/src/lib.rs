//! Message types shared between the hook binary and the desktop app.

use serde::{Deserialize, Serialize};

/// Bumped whenever the wire format changes.
pub const PROTOCOL_VERSION: u32 = 1;

/// A message sent from the hook to the app.
// LEARN: `derive` generates trait impls at compile time; here, to and from JSON, plus `==` and `{:?}`.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
// LEARN: an enum is a discriminated union; this serializes `Ping` as `{"type":"Ping"}`.
#[serde(tag = "type")]
pub enum HookEvent {
    /// Placeholder until real events exist.
    Ping,
}

#[cfg(test)]
mod tests {
    use super::*;

    // LEARN: a test may return `Result`; if `?` hits an `Err`, the test fails with that error.
    #[test]
    fn hook_event_round_trips_through_json() -> Result<(), serde_json::Error> {
        // LEARN: `&` lends the value to `to_string`, so `event` is still ours for the assert below.
        let event = HookEvent::Ping;
        let json: String = serde_json::to_string(&event)?;
        assert_eq!(json, r#"{"type":"Ping"}"#);

        let parsed: HookEvent = serde_json::from_str(&json)?;
        assert_eq!(parsed, event);
        Ok(())
    }
}
