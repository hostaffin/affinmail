pub mod routes;
pub mod security_keys;
pub mod stats;
pub mod state;
pub mod totp;
pub mod types;

use axum::{
    routing::{delete, get, patch, post, put},
    Router,
};
use state::AppState;
use tower_http::cors::{Any, CorsLayer};

use crate::types::ErrorResponse;
use axum::{
    Json,
    http::{StatusCode, header::AUTHORIZATION},
    body::Body,
    response::IntoResponse,
};
use chrono::Utc;



pub fn create_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Health & Stats
        .route("/api/v1/health", get(routes::health::health_check))
        .route("/api/v1/stats", get(routes::health::stats_overview))
        .route("/api/v1/stats/export", get(stats::stats_export))
        .route("/api/v1/storage", get(routes::health::storage_status))
        // Auth
        .route("/api/v1/auth/login", post(routes::auth::admin_login))
        .route("/api/v1/auth/sso-token", post(routes::auth::sso_token))
        .route("/api/v1/auth/sso-exchange", post(routes::auth::sso_exchange))
        .route("/api/v1/auth/logout", post(routes::auth::admin_logout))
        // Provisioning API (/api/v1/provision/*)
        .route(
            "/api/v1/provision/plans",
            get(routes::provision::list_plans).post(routes::provision::create_plan),
        )
        .route(
            "/api/v1/provision/plans/{id}",
            get(routes::provision::get_plan)
                .put(routes::provision::update_plan)
                .delete(routes::provision::delete_plan),
        )
        .route(
            "/api/v1/provision/impersonations",
            get(routes::provision::list_impersonations),
        )
        .route(
            "/api/v1/provision/accounts",
            post(routes::provision::create_account),
        )
        .route(
            "/api/v1/provision/accounts/{id}",
            get(routes::provision::get_account).delete(routes::provision::delete_account),
        )
        .route(
            "/api/v1/provision/accounts/{id}/plan",
            put(routes::provision::update_account_plan),
        )
        .route(
            "/api/v1/provision/accounts/{id}/suspend",
            post(routes::provision::suspend_account),
        )
        .route(
            "/api/v1/provision/accounts/{id}/unsuspend",
            post(routes::provision::unsuspend_account),
        )
        .route(
            "/api/v1/provision/accounts/{id}/terminate",
            post(routes::provision::terminate_account),
        )
        .route(
            "/api/v1/provision/accounts/{id}/domains",
            get(routes::provision::list_account_domains)
                .post(routes::provision::add_account_domain),
        )
        .route(
            "/api/v1/provision/accounts/{id}/domains/{domain}",
            delete(routes::provision::remove_account_domain),
        )
        .route(
            "/api/v1/provision/accounts/{id}/usage",
            get(routes::provision::get_account_usage),
        )
        .route(
            "/api/v1/provision/accounts/{id}/quota",
            get(routes::provision::get_account_quota),
        )
        .route(
            "/api/v1/provision/sso/token",
            post(routes::provision::provision_sso_token),
        )
        // Client Self-Service API (/api/v1/client/*)
        .route(
            "/api/v1/client/dashboard",
            get(routes::client::client_dashboard),
        )
        .route(
            "/api/v1/client/domains/{domain}/mailboxes",
            get(routes::client::list_domain_mailboxes)
                .post(routes::client::create_domain_mailbox),
        )
        .route(
            "/api/v1/client/mailboxes/{id}",
            put(routes::client::update_mailbox).delete(routes::client::delete_mailbox),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/password",
            put(routes::client::change_mailbox_password),
        )
        .route(
            "/api/v1/client/domains/{domain}/aliases",
            get(routes::client::list_aliases).post(routes::client::create_alias),
        )
        .route(
            "/api/v1/client/aliases/{id}",
            delete(routes::client::delete_alias),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/forwarding",
            get(routes::client::get_forwarding).put(routes::client::update_forwarding),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/autoresponder",
            get(routes::client::get_autoresponder).put(routes::client::update_autoresponder),
        )
        .route(
            "/api/v1/client/domains/{domain}/dns-check",
            get(routes::client::check_domain_dns),
        )
        .route(
            "/api/v1/client/domains/{domain}/stats",
            get(routes::client::domain_stats),
        )
        .route(
            "/api/v1/client/domains/{domain}/autoconfig",
            get(routes::client::client_autoconfig),
        )
        .route(
            "/api/v1/client/domains/{domain}/autodiscover",
            get(routes::client::client_autodiscover),
        )
        .route(
            "/api/v1/client/domains/{domain}/mobileconfig",
            get(routes::client::client_mobileconfig),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/mcp/tokens",
            get(routes::client::list_mcp_tokens).post(routes::client::create_mcp_token),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/mcp/tokens/{tid}",
            delete(routes::client::revoke_mcp_token),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/mcp/activity",
            get(routes::client::list_mcp_activity),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/app-passwords",
            get(routes::client::list_app_passwords).post(routes::client::create_app_password),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/app-passwords/{pid}",
            delete(routes::client::delete_app_password),
        )
        // Module I — Security, Compliance & Reports (F-089..F-096)
        .route(
            "/api/v1/client/mailboxes/{id}/login-history",
            get(routes::client::mailbox_login_history),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/sessions",
            get(routes::client::list_client_sessions)
                .delete(routes::client::revoke_client_session)
                .post(routes::client::revoke_all_client_sessions),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/quarantine",
            get(routes::client::list_quarantine),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/quarantine/{mid}/release",
            post(routes::client::release_quarantine),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/quarantine/{mid}",
            delete(routes::client::delete_quarantine),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/whitelist",
            get(routes::client::list_user_whitelist)
                .post(routes::client::add_user_whitelist)
                .delete(routes::client::delete_user_whitelist),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/blacklist",
            get(routes::client::list_user_blacklist)
                .post(routes::client::add_user_blacklist)
                .delete(routes::client::delete_user_blacklist),
        )
        .route(
            "/api/v1/client/domains/{domain}/sent-report",
            get(routes::client::domain_sent_report),
        )
        .route(
            "/api/v1/client/audit-log",
            get(routes::client::client_audit_log),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/export",
            post(routes::client::create_export_job),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/export/{job_id}",
            get(routes::client::get_export_job),
        )
        // F-094 encryption
        .route(
            "/api/v1/client/mailboxes/{id}/encryption",
            get(routes::client::get_encryption).put(routes::client::put_encryption),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/encryption/generate-pgp",
            post(routes::client::generate_pgp_key),
        )
        // F-082: distribution lists
        .route(
            "/api/v1/client/domains/{domain}/lists",
            get(routes::client::list_distribution_lists)
                .post(routes::client::create_distribution_list),
        )
        .route(
            "/api/v1/client/lists/{id}",
            patch(routes::client::update_distribution_list)
                .delete(routes::client::delete_distribution_list),
        )
        // F-084: per-domain password policy
        .route(
            "/api/v1/client/domains/{domain}/password-policy",
            get(routes::client::get_password_policy).put(routes::client::put_password_policy),
        )
        // F-085: TOTP 2FA enrolment
        .route(
            "/api/v1/client/mailboxes/{id}/2fa",
            get(routes::client::get_2fa_status),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/2fa/setup",
            post(routes::client::setup_2fa),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/2fa/enable",
            post(routes::client::enable_2fa),
        )
        .route(
            "/api/v1/client/mailboxes/{id}/2fa/disable",
            post(routes::client::disable_2fa),
        )
        // Admin API (/api/v1/domains, mailboxes, queue, etc.)
        .route(
            "/api/v1/domains",
            get(routes::admin::list_domains).post(routes::admin::create_domain),
        )
        .route(
            "/api/v1/domains/{id}",
            get(routes::admin::get_domain).delete(routes::admin::delete_domain),
        )
        .route(
            "/api/v1/domains/{id}/dns",
            get(routes::admin::get_domain_dns),
        )
        .route(
            "/api/v1/domains/{id}/deliverability",
            get(routes::admin::get_domain_deliverability),
        )
        .route(
            "/api/v1/domains/{id}/catch-all",
            put(routes::admin::put_domain_catch_all),
        )
        .route(
            "/api/v1/domains/{id}/dkim-rotate",
            post(routes::admin::rotate_domain_dkim),
        )
        // F-033 domain send limits
        .route(
            "/api/v1/domains/{id}/send-limits",
            get(routes::admin::get_send_limits).put(routes::admin::put_send_limits),
        )
        // F-032 admin autoresponder override
        .route(
            "/api/v1/autoresponders",
            get(routes::client::list_autoresponders),
        )
        .route(
            "/api/v1/mailboxes/{id}/autoresponder/override",
            post(routes::client::override_autoresponder),
        )
        // Module D security (F-035..F-046)
        .route("/api/v1/security/dkim", get(routes::security::dkim_overview))
        .route("/api/v1/security/dkim/rotate", post(routes::security::dkim_rotate))
        .route("/api/v1/security/dmarc/{domain}", get(routes::security::dmarc_get))
        .route("/api/v1/security/dmarc-reports", get(routes::security::dmarc_reports))
        .route("/api/v1/security/mta-sts/{domain}", get(routes::security::mta_sts))
        .route("/api/v1/security/tls-rpt/{domain}", get(routes::security::tls_rpt))
        .route("/api/v1/security/arc", get(routes::security::arc_settings))
        .route("/api/v1/security/certificates", get(routes::security::certificates))
        .route("/api/v1/security/spam", get(routes::security::spam_settings))
        .route("/api/v1/security/bruteforce", get(routes::security::bruteforce))
        // F-027 mailbox import (mbox/eml upload → JMAP Email/import)
        .route(
            "/api/v1/import/mbox",
            post(routes::import_mail::import_mbox),
        )
        .route(
            "/api/v1/import/eml",
            post(routes::import_mail::import_eml),
        )
        .route(
            "/api/v1/import/imap",
            post(routes::import_mail::import_imap),
        )
        .route(
            "/api/v1/import/jobs",
            get(routes::import_mail::list_jobs),
        )
        .route(
            "/api/v1/import/jobs/{id}",
            get(routes::import_mail::get_job),
        )
        .route(
            "/api/v1/mailboxes",
            get(routes::admin::list_mailboxes).post(routes::admin::create_mailbox),
        )
        .route(
            "/api/v1/mailboxes/{id}",
            get(routes::admin::get_mailbox).delete(routes::admin::delete_mailbox),
        )
        .route(
            "/api/v1/mailboxes/{id}/quota",
            patch(routes::admin::patch_mailbox_quota),
        )
        .route(
            "/api/v1/mailboxes/{id}/status",
            put(routes::admin::put_mailbox_status),
        )
        .route(
            "/api/v1/aliases",
            get(routes::admin::list_aliases).post(routes::admin::create_alias),
        )
        .route(
            "/api/v1/aliases/{id}",
            delete(routes::client::delete_alias),
        )
        .route(
            "/api/v1/queue",
            get(routes::admin::list_queue),
        )
        .route(
            "/api/v1/queue/{id}",
            delete(routes::admin::delete_queue_message),
        )
        .route(
            "/api/v1/queue/{id}/retry",
            post(routes::admin::retry_queue_message),
        )
        .route("/api/v1/mail/track", get(routes::admin::mail_track))
        .route("/api/v1/system/logs", get(routes::admin::system_logs))
        .route(
            "/api/v1/ip-pools",
            get(routes::admin::list_ip_pools).post(routes::admin::create_ip_pool),
        )
        .route(
            "/api/v1/system/backup",
            post(routes::admin::trigger_backup),
        )
        .route(
            "/api/v1/backup",
            post(routes::admin::trigger_backup),
        )
        .route(
            "/api/v1/system/restart",
            post(routes::admin::restart_services),
        )
        // F-097 branding + F-099 backup & DR
        .route("/api/v1/admin/branding", get(routes::admin::get_branding).put(routes::admin::update_branding))
        .route("/api/v1/admin/branding/{client_id}", get(routes::admin::get_client_branding).put(routes::admin::update_client_branding))
        .route("/api/v1/admin/backups", get(routes::admin::list_backups).post(routes::admin::trigger_backup_admin))
        .route("/api/v1/admin/backups/{id}/restore-check", post(routes::admin::restore_check))
        // Infrastructure & panel extensions (Module A + B)
        .route(
            "/api/v1/servers",
            get(routes::infra::list_servers).post(routes::infra::create_server),
        )
        .route("/api/v1/servers/{id}/status", put(routes::infra::set_server_status))
        .route(
            "/api/v1/warmup",
            get(routes::infra::list_warmups),
        )
        .route("/api/v1/warmup/start", post(routes::infra::start_warmup))
        .route("/api/v1/warmup/{id}/pause", post(routes::infra::pause_warmup))
        .route("/api/v1/warmup/{id}/resume", post(routes::infra::resume_warmup))
        .route(
            "/api/v1/rotation",
            get(routes::infra::get_rotation).post(routes::infra::set_rotation),
        )
        .route("/api/v1/rotation/pick", post(routes::infra::pick_rotation))
        .route("/api/v1/ips", get(routes::infra::list_ips))
        .route(
            "/api/v1/ips/{ip}/rdns",
            get(routes::infra::get_rdns).put(routes::infra::put_rdns),
        )
        .route("/api/v1/blacklist", get(routes::infra::blacklist_status))
        .route(
            "/api/v1/ippools/assign",
            post(routes::admin::assign_ip_pool).put(routes::infra::assign_ip),
        )
        .route(
            "/api/v1/admin/logins",
            get(routes::infra::login_log).post(routes::infra::revoke_session),
        )
        .route("/api/v1/admin/logins/revoke", post(routes::infra::revoke_session))
        .route(
            "/api/v1/notifications",
            get(routes::infra::list_notifications),
        )
        .route("/api/v1/notifications/rules", put(routes::infra::set_rules))
        .route("/api/v1/notifications/read", post(routes::infra::mark_read))
        .route(
            "/api/v1/notifications/dismiss",
            post(routes::infra::dismiss_notification),
        )
        .route("/api/v1/ratelimits", get(routes::infra::rate_limits))
        .route(
            "/api/v1/mta/templates",
            get(routes::infra::list_templates),
        )
        .route(
            "/api/v1/mta/templates/apply",
            post(routes::infra::apply_template),
        )
        .route(
            "/api/v1/migrations",
            get(routes::infra::list_migrations).post(routes::infra::create_migration),
        )
        .route("/api/v1/admin/roles", get(routes::infra::roles))
        .route("/api/v1/api-keys", get(routes::api_keys::list_api_keys).post(routes::api_keys::create_api_key))
        .route("/api/v1/api-keys/{id}", delete(routes::api_keys::delete_api_key))
        .route("/api/v1/api-keys/{id}/rotate", post(routes::api_keys::rotate_api_key))
        .route("/api/v1/api-keys/{id}/usage", get(routes::api_keys::get_api_key_usage))
        .route("/api/v1/batch/mailboxes", post(routes::batch::batch_mailboxes))
        .route("/api/v1/batch/suspend", post(routes::batch::batch_suspend))
        .route("/api/v1/batch/dns-check", post(routes::batch::batch_dns_check))
        .route("/api/v1/jobs/{id}", get(routes::batch::get_batch_job))
        .layer(cors)
        .with_state(state)
}
