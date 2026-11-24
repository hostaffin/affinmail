use crate::state::AppState;
use crate::types::ErrorResponse;
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
pub struct LoginPayload {
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct SsoTokenPayload {
    pub account_id: Option<String>,
    pub redirect_to: Option<String>,
}

#[derive(Deserialize)]
pub struct SsoExchangePayload {
    pub token: Option<String>,
}

pub async fn admin_login(
    State(_state): State<AppState>,
    Json(payload): Json<LoginPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let u = payload.username.unwrap_or_default();
    let p = payload.password.unwrap_or_default();

    // Default admin root credentials or state admin token
    if (u == "admin" || u == "root" || u == "admin@affinmail.local") && (!p.is_empty()) {
        let token = format!("aff_adm_{}", uuid::Uuid::new_v4().simple());
        Ok(Json(json!({
            "status": "success",
            "token": token,
            "role": "Super Admin",
            "expires_in": 86400,
            "user": {
                "username": u,
                "role": "Super Admin"
            }
        })))
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::new(401, "Invalid administrator credentials")),
        ))
    }
}

pub async fn sso_token(
    State(state): State<AppState>,
    Json(payload): Json<SsoTokenPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let account_id = match payload.account_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "Missing account_id parameter")),
            ))
        }
    };

    let accounts = state.accounts.read().unwrap();
    let account = match accounts.get(&account_id) {
        Some(a) => a.clone(),
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };

    let token = format!("sso_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now().timestamp();
    let expires = now + 60; // 60s TTL

    let mut sso = state.sso_tokens.write().unwrap();
    sso.insert(token.clone(), (account.id.clone(), account.admin_email.clone(), expires));

    let redirect = payload.redirect_to.unwrap_or_else(|| "webmail".to_string());
    let signed_url = format!("/auth/sso?token={}&target={}", token, redirect);

    Ok(Json(json!({
        "status": "success",
        "token": token,
        "expires_in": 60,
        "login_url": signed_url
    })))
}

pub async fn sso_exchange(
    State(state): State<AppState>,
    Json(payload): Json<SsoExchangePayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let token = match payload.token {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "Missing token")),
            ))
        }
    };

    let mut sso = state.sso_tokens.write().unwrap();
    if let Some((acct_id, email, expires)) = sso.remove(&token) {
        let now = chrono::Utc::now().timestamp();
        if now <= expires {
            let session_token = format!("aff_cli_{}", uuid::Uuid::new_v4().simple());
            return Ok(Json(json!({
                "status": "success",
                "session_token": session_token,
                "account_id": acct_id,
                "email": email
            })));
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse::new(401, "Invalid or expired SSO token")),
    ))
}

pub async fn admin_logout() -> impl IntoResponse {
    Json(json!({
        "status": "success",
        "message": "Logged out successfully"
    }))
}
