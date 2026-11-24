use crate::types::*;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct AppState {
    pub plans: Arc<RwLock<HashMap<String, Plan>>>,
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
    pub admin_token: String,
    pub jwt_secret: String,
}

impl AppState {
    pub fn new() -> Self {
        let now = chrono::Utc::now().to_rfc3339();

        let mut plans = HashMap::new();
        plans.insert(
            "plan_starter".to_string(),
            Plan {
                id: "plan_starter".to_string(),
                slug: "starter".to_string(),
                name: "Starter Business".to_string(),
                max_domains: 1,
                max_mailboxes: 5,
                storage_mb: 10240,
                max_attachment_size_mb: 25,
                hourly_rate_limit: 100,
                has_dedicated_ip: false,
                has_sieve_vacation: true,
                has_mcp_access: false,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );
        plans.insert(
            "plan_pro".to_string(),
            Plan {
                id: "plan_pro".to_string(),
                slug: "professional".to_string(),
                name: "Professional Business".to_string(),
                max_domains: 5,
                max_mailboxes: 25,
                storage_mb: 51200,
                max_attachment_size_mb: 50,
                hourly_rate_limit: 500,
                has_dedicated_ip: false,
                has_sieve_vacation: true,
                has_mcp_access: true,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );
        plans.insert(
            "plan_enterprise".to_string(),
            Plan {
                id: "plan_enterprise".to_string(),
                slug: "enterprise".to_string(),
                name: "Enterprise Sovereign".to_string(),
                max_domains: 25,
                max_mailboxes: 100,
                storage_mb: 204800,
                max_attachment_size_mb: 100,
                hourly_rate_limit: 2000,
                has_dedicated_ip: true,
                has_sieve_vacation: true,
                has_mcp_access: true,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
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
            admin_token,
            jwt_secret,
        }
    }
}
