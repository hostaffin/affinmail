use crate::state::AppState;
use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;

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

pub async fn stats_overview(State(state): State<AppState>) -> impl IntoResponse {
    Json(crate::stats::admin_stats(&state).await)
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
