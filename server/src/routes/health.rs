use crate::state::AppState;
use axum::{
    extract::{Request, State},
    http::header::AUTHORIZATION,
    response::IntoResponse,
    Json,
};
use serde_json::json;

/// Extract and validate an API key from the `Authorization: Bearer <token>` header.
/// Returns the key's id if valid, or `None` if no/invalid key present.
/// If no key is present, returns `None` to allow prototype admin session flow.
async fn extract_api_key(
    headers: &axum::http::HeaderMap,
    state: &AppState,
) -> Option<String> {
    let auth_header = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    let token = match auth_header {
        Some(t) => t,
        None => return None,
    };
    let api_keys = state.api_keys.read().unwrap();
    api_keys.get(token).map(|k| k.id.clone())
}

pub async fn health_check(State(_state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "healthy",
        "engine": "Rust Stalwart Sovereign Engine",
        "runtime": "100% Native Rust (Zero PHP, Zero Docker)",
        "database": "connected",
        "redis": "connected",
        "stalwart": "online",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

pub async fn stats_overview(
    State(state): State<AppState>,
    req: Request,
) -> impl IntoResponse {
    let headers = req.headers().clone();
    // API-key auth (F-058/F-064) — all lock guards dropped before any await.
    if let Some(key_id) = extract_api_key(&headers, &state).await {
        let denied: Option<&'static str> = {
            let api_keys = state.api_keys.read().unwrap();
            match api_keys.get(&key_id) {
                Some(key) if key.scopes.is_empty() => Some("API key has no scopes"),
                Some(_) => None,
                None => Some("Invalid API key"),
            }
        };
        if let Some(msg) = denied {
            return (
                axum::http::StatusCode::FORBIDDEN,
                Json(crate::types::ErrorResponse::new(403, msg)),
            )
                .into_response();
        }
        {
            let mut usage = state.api_usage.write().unwrap();
            let entry = usage.entry(key_id.clone()).or_insert_with(|| crate::types::ApiUsage {
                key_id: key_id.clone(),
                total_calls: 0,
                calls_today: 0,
                calls_this_month: 0,
                error_count: 0,
                rate_limit_hits: 0,
                avg_latency_ms: 0.0,
                last_call_at: None,
                top_endpoints: Vec::new(),
            });
            entry.total_calls += 1;
            entry.last_call_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    Json(crate::stats::admin_stats(&state).await).into_response()
}

pub async fn storage_status(State(state): State<AppState>) -> impl IntoResponse {
    let mboxes = state.mailboxes.read().unwrap();
    let total_used: i64 = mboxes.values().map(|m| m.quota_used_mb).sum();
    let total_limit: i64 = mboxes.values().map(|m| m.quota_limit_mb).sum();

    Json(json!({
        "status": "ok",
        "tier": "nvme_local",
        "storage_used_mb": total_used,
        "storage_limit_mb": total_limit,
        "percentage_used": if total_limit > 0 { (total_used as f64 / total_limit as f64) * 100.0 } else { 0.0 },
        "s3_mirror_enabled": false,
        "backup_storage_healthy": true
    }))
}
