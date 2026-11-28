//! Production panel authentication (post-migration batch 3,
//! BATCH6-DESIGN.md). Panel admins live in PG `panel_admins` with bcrypt
//! hashes; login verifies against them — there is no in-code fallback.
//! The authorization middleware guards the whole API except a small
//! allowlist; machine access keeps using the static ADMIN_TOKEN.

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use tokio_postgres::Client;

use crate::state::AppState;
use crate::types::ErrorResponse;

pub async fn ensure_table(client: &Client) -> Result<(), String> {
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS panel_admins (
                id serial PRIMARY KEY,
                username text UNIQUE NOT NULL,
                password_hash text NOT NULL,
                role text NOT NULL DEFAULT 'Super Admin',
                created_at timestamptz NOT NULL DEFAULT now(),
                last_login_at timestamptz
            )",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Verify panel credentials; on success returns the admin's role and
/// stamps last_login_at.
pub async fn verify_login(client: &Client, username: &str, password: &str) -> Option<String> {
    ensure_table(client).await.ok()?;
    let row = client
        .query_opt(
            "SELECT password_hash, role FROM panel_admins WHERE username = $1",
            &[&username],
        )
        .await
        .ok()??;
    let hash: String = row.get(0);
    let role: String = row.get(1);
    if bcrypt::verify(password, &hash).unwrap_or(false) {
        let _ = client
            .execute(
                "UPDATE panel_admins SET last_login_at = now() WHERE username = $1",
                &[&username],
            )
            .await;
        Some(role)
    } else {
        None
    }
}

pub async fn create_admin(
    client: &Client,
    username: &str,
    password: &str,
    role: &str,
) -> Result<(), String> {
    ensure_table(client).await?;
    let hash = bcrypt::hash(password, 10).map_err(|e| e.to_string())?;
    client
        .execute(
            "INSERT INTO panel_admins (username, password_hash, role) VALUES ($1, $2, $3)",
            &[&username, &hash, &role],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn change_password(
    client: &Client,
    username: &str,
    current: &str,
    new_password: &str,
) -> Result<(), String> {
    if verify_login(client, username, current).await.is_none() {
        return Err("current password is incorrect".to_string());
    }
    let hash = bcrypt::hash(new_password, 10).map_err(|e| e.to_string())?;
    client
        .execute(
            "UPDATE panel_admins SET password_hash = $2 WHERE username = $1",
            &[&username, &hash],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_public(path: &str) -> bool {
    path == "/api/v1/health"
        || path == "/api/v1/auth/login"
        || path == "/api/v1/auth/sso-exchange"
        || path == "/api/v1/domain/login"
        || path.starts_with("/jmap")
}

/// Authorization guard for the panel API. Passes with the static
/// ADMIN_TOKEN (machine/driver access) or a live admin session token
/// issued by admin_login. Everything else gets a 401.
pub async fn auth_guard(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    if is_public(req.uri().path()) {
        return next.run(req).await;
    }
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let mut ok = !token.is_empty()
        && (token == state.admin_token
            || state.admin_sessions.read().unwrap().contains_key(token));
    // Batch 4: domain sessions and domain API keys pass ONLY on the
    // domain panel surface; handlers re-check the domain scope.
    if !ok && req.uri().path().starts_with("/api/v1/domain/") {
        if state.domain_sessions.read().unwrap().contains_key(token) {
            ok = true;
        } else if token.starts_with("affkey_") {
            if let Ok(client) = crate::provision_db::connect_db().await {
                ok = crate::domain_panel::verify_api_key(&client, token).await.is_some();
            }
        }
    }
    if ok {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::new(401, "Authentication required")),
        )
            .into_response()
    }
}

/// Username owning a session token (for change-password).
pub fn session_username(state: &AppState, headers: &HeaderMap) -> Option<String> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;
    state
        .admin_sessions
        .read()
        .unwrap()
        .get(token)
        .map(|s| s.username.clone())
}
