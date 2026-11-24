use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct ScopeChecker {
    allowed_scopes: Vec<String>,
}

impl ScopeChecker {
    pub fn from_env() -> Self {
        let env_scopes = env::var("AFFINMAIL_MCP_SCOPES")
            .unwrap_or_else(|_| "mcp:read,mcp:write,mcp:send".to_string());
        Self::parse(&env_scopes)
    }

    pub fn parse(scopes_str: &str) -> Self {
        let allowed_scopes = scopes_str
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        Self { allowed_scopes }
    }

    pub fn with_scopes(scopes: &[&str]) -> Self {
        Self {
            allowed_scopes: scopes.iter().map(|s| s.trim().to_lowercase()).collect(),
        }
    }

    pub fn has_scope(&self, required: &str) -> bool {
        let req = required.to_lowercase();
        self.allowed_scopes.iter().any(|s| s == "*" || s == "all" || s == &req)
    }

    pub fn require_scope(&self, required: &str) -> Result<(), String> {
        if self.has_scope(required) {
            Ok(())
        } else {
            Err(format!(
                "Permission denied: operation requires scope '{}' (granted: {:?})",
                required, self.allowed_scopes
            ))
        }
    }
}

#[derive(Clone, Debug)]
pub struct AuditLogger {
    pub log_path: String,
    pub agent_id: String,
}

impl AuditLogger {
    pub fn new() -> Self {
        let log_path = env::var("AFFINMAIL_MCP_AUDIT_LOG")
            .or_else(|_| env::var("AFFINMAIL_AUDIT_LOG"))
            .unwrap_or_else(|_| "/var/www/affinmail/logs/mcp-audit.log".to_string());
        let agent_id = env::var("AFFINMAIL_AGENT_ID")
            .unwrap_or_else(|_| "affinmail-mcp".to_string());
        Self { log_path, agent_id }
    }

    pub fn with_path(log_path: impl Into<String>, agent_id: impl Into<String>) -> Self {
        Self {
            log_path: log_path.into(),
            agent_id: agent_id.into(),
        }
    }

    pub fn log_tool_call(&self, tool: &str, is_error: bool, detail: Option<&str>) {
        let now = SystemTime::now();
        let ts = now
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let iso_time = timestamp_to_utc_iso(ts);

        let line = serde_json::json!({
            "ts": ts,
            "timestamp": iso_time,
            "tool": tool,
            "status": if is_error { "error" } else { "success" },
            "agent": self.agent_id,
            "detail": detail,
        });

        let path = Path::new(&self.log_path);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{}", line);
        }
    }
}

/// Convert Unix seconds to an ISO 8601 UTC string (YYYY-MM-DDTHH:MM:SSZ).
pub fn timestamp_to_utc_iso(secs: u64) -> String {
    let sec = secs % 60;
    let min = (secs / 60) % 60;
    let hour = (secs / 3600) % 24;
    let days = (secs / 86400) as i64;

    // Euclidean affine algorithm for Gregorian date calculation
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, hour, min, sec)
}

/// Return the start of today in UTC as ISO 8601 (YYYY-MM-DDT00:00:00Z).
pub fn start_of_today_iso(secs: u64) -> String {
    let today_secs = (secs / 86400) * 86400;
    timestamp_to_utc_iso(today_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scope_checker() {
        let checker = ScopeChecker::with_scopes(&["mcp:read", "mcp:write"]);
        assert!(checker.has_scope("mcp:read"));
        assert!(checker.has_scope("mcp:write"));
        assert!(!checker.has_scope("mcp:send"));
        assert!(checker.require_scope("mcp:send").is_err());
        assert!(checker.require_scope("mcp:read").is_ok());

        let wildcard = ScopeChecker::with_scopes(&["*"]);
        assert!(wildcard.has_scope("mcp:send"));
    }

    #[test]
    fn test_timestamp_to_utc_iso() {
        assert_eq!(timestamp_to_utc_iso(0), "1970-01-01T00:00:00Z");
        // 2026-11-24 12:00:00 UTC = 1795521600 approx
        // Let's test a known timestamp: 1700000000 = 2023-11-14T22:13:20Z
        assert_eq!(timestamp_to_utc_iso(1700000000), "2023-11-14T22:13:20Z");
    }
}
