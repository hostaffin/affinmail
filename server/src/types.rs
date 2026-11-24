use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub max_domains: i32,
    pub max_mailboxes: i32,
    pub storage_mb: i64,
    pub max_attachment_size_mb: i32,
    pub hourly_rate_limit: i32,
    pub has_dedicated_ip: bool,
    pub has_sieve_vacation: bool,
    pub has_mcp_access: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub company_name: String,
    pub admin_email: String,
    pub plan_id: String,
    pub status: String,
    pub external_id: Option<String>,
    pub suspended_at: Option<String>,
    pub terminated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Domain {
    pub id: String,
    pub account_id: Option<String>,
    pub domain_name: String,
    pub status: String,
    pub hostaffin_service_id: Option<String>,
    pub max_mailboxes: i32,
    pub max_attachment_size_mb: i32,
    pub disk_quota_mb: i64,
    pub dkim_selector: String,
    pub dkim_public_key: String,
    pub dkim_private_key: String,
    pub catch_all_mailbox_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mailbox {
    pub id: String,
    pub domain_id: String,
    pub domain_name: String,
    pub email: String,
    pub display_name: String,
    pub quota_limit_mb: i64,
    pub quota_used_mb: i64,
    pub hourly_rate_limit: i32,
    pub is_active: bool,
    pub is_suspended: bool,
    pub forward_to: Option<String>,
    pub forward_keep_copy: bool,
    pub vacation_enabled: bool,
    pub vacation_subject: Option<String>,
    pub vacation_body: Option<String>,
    pub vacation_start: Option<String>,
    pub vacation_end: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    pub id: String,
    pub domain_id: String,
    pub source_email: String,
    pub destination_email: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPassword {
    pub id: String,
    pub mailbox_id: String,
    pub label: String,
    pub password_hash: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToken {
    pub id: String,
    pub mailbox_id: String,
    pub token_hash: String,
    pub token_prefix: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpAuditEntry {
    pub id: String,
    pub mailbox_id: String,
    pub tool_name: String,
    pub status: String,
    pub client_info: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpPool {
    pub id: String,
    pub pool_name: String,
    pub ip_addresses: Vec<String>,
    pub is_blacklisted: bool,
    pub reputation_score: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueMessage {
    pub id: String,
    pub sender: String,
    pub recipient: String,
    pub size_bytes: u64,
    pub status: String, // active, deferred, hold
    pub retry_count: u32,
    pub deferred_reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiError {
    pub code: u16,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: ApiError,
}

impl ErrorResponse {
    pub fn new(code: u16, message: impl Into<String>) -> Self {
        Self {
            error: ApiError {
                code,
                message: message.into(),
                details: None,
            },
        }
    }
}
