//! Library target so integration tests (tests/) can drive the real JMAP client
//! against a local mock server. The `affinmail-mcp-server` binary is a thin
//! stdio wrapper around these modules.

pub mod admin;
pub mod jmap;
pub mod tools;
pub mod types;
