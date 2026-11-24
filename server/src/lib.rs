pub mod routes;
pub mod stats;
pub mod state;
pub mod types;

use axum::{
    routing::{delete, get, patch, post, put},
    Router,
};
use state::AppState;
use tower_http::cors::{Any, CorsLayer};

pub fn create_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Health & Stats
        .route("/api/v1/health", get(routes::health::health_check))
        .route("/api/v1/stats", get(routes::health::stats_overview))
        .route("/api/v1/storage", get(routes::health::storage_status))
        // Auth
        .route("/api/v1/auth/login", post(routes::auth::admin_login))
        .route("/api/v1/auth/sso-token", post(routes::auth::sso_token))
        .route("/api/v1/auth/sso-exchange", post(routes::auth::sso_exchange))
        .route("/api/v1/auth/logout", post(routes::auth::admin_logout))
        // Provisioning API (/api/v1/provision/*)
        .route("/api/v1/provision/plans", get(routes::provision::list_plans))
        .route("/api/v1/provision/plans/{id}", get(routes::provision::get_plan))
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
            get(routes::client::list_aliases).post(routes::client::create_alias),
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
            "/api/v1/ippools/assign",
            post(routes::admin::assign_ip_pool),
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
        .layer(cors)
        .with_state(state)
}
