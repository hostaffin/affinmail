use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub max_domains: i32,
    pub max_mailboxes: i32,
    pub storage_mb: i64,
    pub max_aliases: i32,
    pub max_distribution_lists: i32,
    pub max_send_per_hour: i32,
    pub max_send_per_day: i32,
    pub max_attachment_size_mb: i32,
    pub hourly_rate_limit: i32,
    pub webmail_access: bool,
    pub custom_branding: bool,
    pub dedicated_ip_count: i32,
    pub has_dedicated_ip: bool,
    pub has_sieve_vacation: bool,
    pub has_mcp_access: bool,
    pub has_dmarc_reports: bool,
    pub external_id: Option<String>,
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
    /// F-033: per-domain send limits (independent of plan defaults).
    pub hourly_send_limit: i32,
    pub daily_send_limit: i32,
    pub send_limit_action: String, // defer | reject
    /// F-030: suspension bookkeeping.
    pub suspend_reason: Option<String>,
    pub terminated_at: Option<String>,
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
    /// F-085: TOTP 2FA enrolment state.
    pub totp_secret: Option<String>,
    pub totp_enabled: bool,
    pub recovery_codes: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionList {
    pub id: String,
    pub domain: String,
    pub address: String,
    pub name: String,
    pub members: Vec<String>,
    /// members | anyone | moderated
    pub post_policy: String,
    pub created_at: String,
}

/// F-084: per-domain password policy. Defaults apply when unset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordPolicy {
    pub min_length: i64,
    pub require_upper: bool,
    pub require_number: bool,
    pub require_special: bool,
    /// 0 = never expires.
    pub expiry_days: i64,
}

impl Default for PasswordPolicy {
    fn default() -> Self {
        Self {
            min_length: 10,
            require_upper: false,
            require_number: false,
            require_special: false,
            expiry_days: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    pub id: String,
    pub domain_id: String,
    pub source_email: String,
    pub destination_email: String,
    /// F-028: distribution-list behaviour when is_list is true.
    pub is_list: bool,
    pub destinations: Vec<String>,
    pub reply_to: Option<String>,       // list | sender
    pub who_can_post: Option<String>,   // members | anyone | moderated
    pub max_message_size_kb: Option<i32>,
    pub footer: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerNode {
    pub id: String,
    pub hostname: String,
    pub primary_ip: String,
    pub location: String,
    pub role: String,
    pub status: String, // active, maintenance, draining, registered
    pub group_tag: String,
    pub is_local: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginEvent {
    pub ts: String,
    pub username: String,
    pub ip: String,
    pub user_agent: String,
    pub method: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSession {
    pub token: String,
    pub username: String,
    pub ip: String,
    pub created_at: String,
}

/// F-034: impersonation audit trail (one entry per SSO-as-client session).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpersonationLog {
    pub id: String,
    pub admin_username: String,
    pub account_id: String,
    pub account_email: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStep {
    pub name: String,
    pub status: String, // pending, blocked, done
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationJob {
    pub id: String,
    pub domain: String,
    pub source_node: String,
    pub target_node: String,
    pub status: String,
    pub note: String,
    pub steps: Vec<MigrationStep>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtaVersion {
    pub id: u32,
    pub node_id: String,
    pub template_id: String,
    pub file: String,
    pub size_bytes: u64,
    pub created_at: String,
}

/// F-058: API key management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub is_active: bool,
    pub last_used_at: Option<String>,
    pub ip_restriction: Option<String>,
}

/// F-089: Login history entry for a mailbox
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginHistoryEntry {
    pub ts: String,
    pub ip: String,
    pub protocol: String, // IMAP, POP3, Webmail, SMTP, MCP
    pub geo_country: Option<String>,
    pub geo_city: Option<String>,
    pub user_agent: String,
    pub success: bool,
}

/// F-090: Active client session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientSession {
    pub id: String,
    pub mailbox_id: String,
    pub protocol: String, // webmail, imap, mcp
    pub ip: String,
    pub user_agent: Option<String>,
    pub started_at: String,
    pub last_activity: String,
    pub idle_seconds: Option<i64>,
}

/// F-091: Quarantine message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantineMessage {
    pub id: String,
    pub mailbox_id: String,
    pub sender: String,
    pub subject: String,
    pub spam_score: f64,
    pub received_at: String,
    pub size_bytes: i64,
}

/// F-092: Whitelist/Blacklist entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListEntry {
    pub id: String,
    pub mailbox_id: Option<String>, // None = domain-level
    pub domain: Option<String>,
    pub entry_type: String, // "whitelist" | "blacklist"
    pub value: String, // email or domain (e.g. "user@domain.com" or "domain.com")
    pub created_at: String,
}

/// F-093: Sent mail report entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentReportEntry {
    pub mailbox_id: String,
    pub email: String,
    pub display_name: String,
    pub sent_today: i64,
    pub sent_this_week: i64,
    pub sent_this_month: i64,
    pub bounces_today: i64,
    pub bounce_rate_pct: f64,
    pub delivery_success_pct: f64,
}

/// F-094: PGP/S/MIME key management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgpKey {
    pub id: String,
    pub mailbox_id: String,
    pub key_type: String, // "pgp" | "smime"
    pub public_key: String, // armored public key or certificate
    pub private_key_encrypted: Option<String>, // browser-encrypted private key (never server plaintext)
    pub key_id: String, // PGP key ID or S/MIME cert fingerprint
    pub created_at: String,
    pub expires_at: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionSettings {
    pub mailbox_id: String,
    pub auto_encrypt: bool, // encrypt outgoing if recipient key known
    pub auto_sign: bool,    // sign outgoing
    pub require_encryption: bool, // reject if cannot encrypt
}

/// F-095: Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: String,
    pub actor: String, // admin username or client email
    pub action: String,
    pub target_type: String, // "mailbox", "alias", "domain", "settings", etc.
    pub target_id: String,
    pub details: Value,
    pub ip: String,
    pub created_at: String,
}

/// F-096: Export job
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportJob {
    pub id: String,
    pub mailbox_id: String,
    pub domain: Option<String>, // None = single mailbox, Some = whole domain
    pub status: String, // pending, running, completed, failed
    pub format: String, // "eml", "zip"
    pub file_path: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub expires_at: String,
}

/// F-097: Branding configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandingConfig {
    pub company_name: String,
    pub logo_svg: Option<String>,
    pub favicon_svg: Option<String>,
    pub primary_color: String,
    pub secondary_color: String,
    pub login_background: Option<String>,
    pub webmail_theme: String, // "default" | "custom"
    pub email_templates: serde_json::Value, // { welcome, password_reset, quota_warning, quarantine_digest }
    pub custom_css: Option<String>,
}

/// F-064: API usage per key
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiUsage {
    pub key_id: String,
    pub total_calls: u64,
    pub calls_today: u64,
    pub calls_this_month: u64,
    pub error_count: u64,
    pub rate_limit_hits: u64,
    pub avg_latency_ms: f64,
    pub last_call_at: Option<String>,
    pub top_endpoints: Vec<(String, u64)>,
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
