use serde_json::{json, Value};
use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct AdminClient {
    pub base_url: String,
    token: String,
    agent_id: String,
    audit_log: String,
    http_client: reqwest::Client,
}

pub struct AdminResponse {
    pub status: u16,
    pub body: Value,
}

impl AdminResponse {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Human readable error text including the API's own message.
    pub fn error_text(&self, action: &str) -> String {
        let msg = self
            .body
            .get("error")
            .or_else(|| self.body.get("message"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| self.body.to_string());
        format!("{} failed (HTTP {}): {}", action, self.status, msg)
    }
}

impl AdminClient {
    pub fn new() -> Self {
        let base_url = env::var("AFFINMAIL_ADMIN_API_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8090/api/v1".to_string());
        let token = env::var("AFFINMAIL_ADMIN_TOKEN")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| env::var("AFFINMAIL_API_TOKEN").ok().filter(|v| !v.trim().is_empty()))
            .unwrap_or_default();
        let agent_id = env::var("AFFINMAIL_AGENT_ID")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "affinmail-mcp".to_string());
        let audit_log = env::var("AFFINMAIL_AUDIT_LOG")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "/var/www/affinmail/logs/admin-agent-audit.log".to_string());

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
            agent_id,
            audit_log,
            http_client: reqwest::Client::new(),
        }
    }

    pub async fn get(&self, path: &str) -> Result<AdminResponse, String> {
        self.send(reqwest::Method::GET, path, None).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Result<AdminResponse, String> {
        self.send(reqwest::Method::POST, path, Some(body)).await
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<AdminResponse, String> {
        let url = format!("{}{}", self.base_url, path);
        let mut rb = self
            .http_client
            .request(method.clone(), &url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("X-Agent-ID", &self.agent_id)
            .header("Accept", "application/json");

        if let Some(b) = body {
            rb = rb.header("Content-Type", "application/json").json(&b);
        }

        let resp = match rb.send().await {
            Ok(r) => r,
            Err(e) => {
                self.audit(&method, path, 0);
                return Err(format!("admin API request to {} failed: {}", url, e));
            }
        };

        let status = resp.status().as_u16();
        self.audit(&method, path, status);

        let text = resp.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!(text));

        Ok(AdminResponse {
            status,
            body: parsed,
        })
    }

    /// Best-effort audit line: {ts,agent,method,path,status}
    fn audit(&self, method: &reqwest::Method, path: &str, status: u16) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let line = json!({
            "ts": ts,
            "agent": self.agent_id,
            "method": method.as_str(),
            "path": path,
            "status": status,
        });

        let path = std::path::Path::new(&self.audit_log);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{}", line);
        }
    }
}
