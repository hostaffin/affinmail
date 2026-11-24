use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct AppState {    pub plans: Arc<RwLock<HashMap<String, Plan>>>,
    pub accounts: Arc<RwLock<HashMap<String, Account>>>,
    pub domains: Arc<RwLock<HashMap<String, Domain>>>,
    pub mailboxes: Arc<RwLock<HashMap<String, Mailbox>>>,
    pub aliases: Arc<RwLock<HashMap<String, Alias>>>,
    pub app_passwords: Arc<RwLock<HashMap<String, AppPassword>>>,
    pub mcp_tokens: Arc<RwLock<HashMap<String, McpToken>>>,
    pub mcp_audit: Arc<RwLock<Vec<McpAuditEntry>>>,
    pub ip_pools: Arc<RwLock<HashMap<String, IpPool>>>,
    pub queue: Arc<RwLock<HashMap<String, QueueMessage>>>,
    pub sso_tokens: Arc<RwLock<HashMap<String, (String, String, i64)>>>, // token -> (account_id, email, expires_at)
    pub server_nodes: Arc<RwLock<HashMap<String, ServerNode>>>,
    pub login_log: Arc<RwLock<Vec<LoginEvent>>>,
    pub admin_sessions: Arc<RwLock<HashMap<String, AdminSession>>>,
    pub impersonation_log: Arc<RwLock<Vec<ImpersonationLog>>>,
    /// F-027: import job history (in-memory — no DB grants for import tables).
    pub import_jobs: Arc<std::sync::Mutex<HashMap<String, crate::routes::import_mail::ImportJob>>>,
    pub notifications: Arc<RwLock<HashMap<String, Notification>>>,
    pub notif_rules: Arc<RwLock<NotificationRules>>,
    pub migrations: Arc<RwLock<HashMap<String, MigrationJob>>>,
    pub mta_versions: Arc<RwLock<Vec<MtaVersion>>>,
    pub admin_token: String,
    pub jwt_secret: String,
}

impl AppState {
    pub fn new() -> Self {
        let now = chrono::Utc::now().to_rfc3339();

        let mut plans = HashMap::new();
        let mk_plan = |id: &str,
                       slug: &str,
                       name: &str,
                       description: &str,
                       max_domains: i32,
                       max_mailboxes: i32,
                       storage_mb: i64,
                       max_attachment: i32,
                       hourly: i32,
                       daily: i32,
                       dedicated: bool,
                       mcp: bool,
                       branding: bool,
                       dmarc: bool,
                       now: &str| {
            Plan {
                id: id.to_string(),
                slug: slug.to_string(),
                name: name.to_string(),
                description: description.to_string(),
                max_domains,
                max_mailboxes,
                storage_mb,
                max_aliases: max_mailboxes * 2,
                max_distribution_lists: if max_domains > 1 { 10 } else { 3 },
                max_send_per_hour: hourly,
                max_send_per_day: daily,
                max_attachment_size_mb: max_attachment,
                hourly_rate_limit: hourly,
                webmail_access: true,
                custom_branding: branding,
                dedicated_ip_count: if dedicated { 1 } else { 0 },
                has_dedicated_ip: dedicated,
                has_sieve_vacation: true,
                has_mcp_access: mcp,
                has_dmarc_reports: dmarc,
                external_id: None,
                created_at: now.to_string(),
                updated_at: now.to_string(),
            }
        };
        plans.insert(
            "plan_starter".to_string(),
            mk_plan(
                "plan_starter", "starter", "Starter Business",
                "One domain, five mailboxes, shared sending pool.",
                1, 5, 10240, 25, 100, 500, false, false, false, false, &now,
            ),
        );
        plans.insert(
            "plan_pro".to_string(),
            mk_plan(
                "plan_pro", "professional", "Professional Business",
                "Five domains, MCP access, DMARC report viewer.",
                5, 25, 51200, 50, 500, 2500, false, true, true, true, &now,
            ),
        );
        plans.insert(
            "plan_enterprise".to_string(),
            mk_plan(
                "plan_enterprise", "enterprise", "Enterprise Sovereign",
                "Dedicated IP, 25 domains, full feature set.",
                25, 100, 204800, 100, 2000, 10000, true, true, true, true, &now,
            ),
        );

        let mut accounts = HashMap::new();
        accounts.insert(
            "acct_demo".to_string(),
            Account {
                id: "acct_demo".to_string(),
                company_name: "Acme Global Corp".to_string(),
                admin_email: "admin@affinmail.local".to_string(),
                plan_id: "plan_enterprise".to_string(),
                status: "active".to_string(),
                external_id: Some("WHMCS-1001".to_string()),
                suspended_at: None,
                terminated_at: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );

        let mut domains = HashMap::new();
        domains.insert(
            "dom_1".to_string(),
            Domain {
                id: "dom_1".to_string(),
                account_id: Some("acct_demo".to_string()),
                domain_name: "affinmail.local".to_string(),
                status: "active".to_string(),
                hostaffin_service_id: Some("srv_99".to_string()),
                max_mailboxes: 100,
                max_attachment_size_mb: 100,
                disk_quota_mb: 204800,
                dkim_selector: "affinmail".to_string(),
                dkim_public_key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0DemoPublicKey...".to_string(),
                dkim_private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Demo...".to_string(),
                catch_all_mailbox_id: None,
                hourly_send_limit: 2000,
                daily_send_limit: 10000,
                send_limit_action: "defer".to_string(),
                suspend_reason: None,
                terminated_at: None,
                created_at: now.clone(),
            },
        );

        let mut mailboxes = HashMap::new();
        mailboxes.insert(
            "mb_1".to_string(),
            Mailbox {
                id: "mb_1".to_string(),
                domain_id: "dom_1".to_string(),
                domain_name: "affinmail.local".to_string(),
                email: "alex.mercer@affinmail.local".to_string(),
                display_name: "Alex Mercer".to_string(),
                quota_limit_mb: 10240,
                quota_used_mb: 2048,
                hourly_rate_limit: 500,
                is_active: true,
                is_suspended: false,
                forward_to: None,
                forward_keep_copy: true,
                vacation_enabled: false,
                vacation_subject: None,
                vacation_body: None,
                vacation_start: None,
                vacation_end: None,
                created_at: now.clone(),
            },
        );

        let mut aliases = HashMap::new();
        aliases.insert(
            "al_1".to_string(),
            Alias {
                id: "al_1".to_string(),
                domain_id: "dom_1".to_string(),
                source_email: "support@affinmail.local".to_string(),
                destination_email: "alex.mercer@affinmail.local".to_string(),
                is_list: false,
                destinations: vec!["alex.mercer@affinmail.local".to_string()],
                reply_to: None,
                who_can_post: None,
                max_message_size_kb: None,
                footer: None,
                created_at: now.clone(),
            },
        );

        let mut ip_pools = HashMap::new();
        ip_pools.insert(
            "pool_default".to_string(),
            IpPool {
                id: "pool_default".to_string(),
                pool_name: "Shared Clean Outbound Pool".to_string(),
                ip_addresses: vec!["198.51.100.10".to_string(), "198.51.100.11".to_string()],
                is_blacklisted: false,
                reputation_score: 9.8,
                created_at: now.clone(),
            },
        );

        let mut queue = HashMap::new();
        queue.insert(
            "msg_101".to_string(),
            QueueMessage {
                id: "msg_101".to_string(),
                sender: "alex.mercer@affinmail.local".to_string(),
                recipient: "client@external.com".to_string(),
                size_bytes: 42100,
                status: "active".to_string(),
                retry_count: 0,
                deferred_reason: None,
                created_at: now.clone(),
            },
        );

        let admin_token = std::env::var("ADMIN_TOKEN")
            .unwrap_or_else(|_| "aff_adm_secret_token_2026".to_string());
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "affinmail_jwt_super_secret_signing_key_2026".to_string());

        // The local node is real: health comes from the stats.rs probes.
        let mut server_nodes = HashMap::new();
        server_nodes.insert(
            "node_local".to_string(),
            ServerNode {
                id: "node_local".to_string(),
                hostname: hostname(),
                primary_ip: std::env::var("SERVER_IP").unwrap_or_else(|_| "127.0.0.1".to_string()),
                location: "primary-dc".to_string(),
                role: "all-in-one".to_string(),
                status: "active".to_string(),
                group_tag: "primary".to_string(),
                is_local: true,
                created_at: now.clone(),
            },
        );

        Self {
            plans: Arc::new(RwLock::new(plans)),
            accounts: Arc::new(RwLock::new(accounts)),
            domains: Arc::new(RwLock::new(domains)),
            mailboxes: Arc::new(RwLock::new(mailboxes)),
            aliases: Arc::new(RwLock::new(aliases)),
            app_passwords: Arc::new(RwLock::new(HashMap::new())),
            mcp_tokens: Arc::new(RwLock::new(HashMap::new())),
            mcp_audit: Arc::new(RwLock::new(Vec::new())),
            ip_pools: Arc::new(RwLock::new(ip_pools)),
            queue: Arc::new(RwLock::new(queue)),
            sso_tokens: Arc::new(RwLock::new(HashMap::new())),
            server_nodes: Arc::new(RwLock::new(server_nodes)),
            login_log: Arc::new(RwLock::new(Vec::new())),
            admin_sessions: Arc::new(RwLock::new(HashMap::new())),
            impersonation_log: Arc::new(RwLock::new(Vec::new())),
            import_jobs: crate::routes::import_mail::new_job_store(),
            notifications: Arc::new(RwLock::new(HashMap::new())),
            notif_rules: Arc::new(RwLock::new(NotificationRules::default())),
            migrations: Arc::new(RwLock::new(HashMap::new())),
            mta_versions: Arc::new(RwLock::new(Vec::new())),
            admin_token,
            jwt_secret,
        }
    }
}

/// Hostname of this machine (for the local node entry).
pub fn hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "localhost".to_string())
}

/// Thresholds that turn /api/v1/stats values into in-panel notifications (F-009).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationRules {
    /// Mail queue depth at which a warning notification fires.
    pub queue_warn: i64,
    /// Disk usage percent at which a warning notification fires.
    pub disk_warn_pct: i32,
    /// Minimum service uptime percent over 24h before a "service down" notification fires.
    pub uptime_warn_pct: f64,
    /// Days before the newest backup becomes "stale" enough to warn about.
    pub backup_stale_days: i64,
    pub email_to: String,
    pub webhook_url: String,
}

impl Default for NotificationRules {
    fn default() -> Self {
        Self {
            queue_warn: 500,
            disk_warn_pct: 80,
            uptime_warn_pct: 99.0,
            backup_stale_days: 2,
            email_to: "admin@affinmail.local".to_string(),
            webhook_url: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub kind: String,
    pub severity: String, // warning | critical | info
    pub title: String,
    pub detail: String,
    pub created_at: String,
    pub read_at: Option<String>,
}
