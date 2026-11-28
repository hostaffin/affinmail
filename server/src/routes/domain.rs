//! :2083 domain panel API (post-migration batch 4, BATCH7-DESIGN.md).
//! Every handler resolves its objects against the caller's domain —
//! a session or API key for domain A gets 404s in domain B.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;
use crate::types::ErrorResponse;

type ApiErr = (StatusCode, Json<ErrorResponse>);
fn err(code: u16, msg: impl Into<String>) -> ApiErr {
    (
        StatusCode::from_u16(code).unwrap(),
        Json(ErrorResponse::new(code, msg.into())),
    )
}
fn db_err<E: std::fmt::Display>(e: E) -> ApiErr {
    err(500, format!("database error: {e}"))
}

pub struct DomainCtx {
    domain_id: i32,
    domain: String,
    email: String,
}

fn bearer(headers: &HeaderMap) -> String {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("")
        .to_string()
}

/// Resolve the caller's domain from a panel session, or (when
/// `allow_key`) from a domain API key.
async fn ctx(state: &AppState, headers: &HeaderMap, allow_key: bool) -> Result<DomainCtx, ApiErr> {
    let token = bearer(headers);
    if let Some(s) = state.domain_sessions.read().unwrap().get(&token) {
        return Ok(DomainCtx {
            domain_id: s.domain_id,
            domain: s.domain.clone(),
            email: s.email.clone(),
        });
    }
    if allow_key && token.starts_with("affkey_") {
        let client = crate::provision_db::connect_db().await.map_err(db_err)?;
        if let Some((domain_id, domain)) = crate::domain_panel::verify_api_key(&client, &token).await {
            return Ok(DomainCtx {
                domain_id,
                domain,
                email: "api-key".to_string(),
            });
        }
    }
    Err(err(401, "Authentication required"))
}

#[derive(Deserialize)]
pub struct LoginPayload {
    pub email: String,
    pub password: String,
}

/// POST /api/v1/domain/login — provisioning email + password.
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let (domain_id, domain) =
        crate::domain_panel::verify_owner(&client, payload.email.trim(), &payload.password)
            .await
            .ok_or_else(|| err(401, "Invalid domain credentials"))?;
    let token = format!("aff_dom_{}", uuid::Uuid::new_v4().simple());
    state.domain_sessions.write().unwrap().insert(
        token.clone(),
        crate::types::DomainSession {
            token: token.clone(),
            domain_id,
            domain: domain.clone(),
            email: payload.email.trim().to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    );
    Ok(Json(json!({
        "status": "success",
        "token": token,
        "domain": domain,
        "email": payload.email.trim(),
    })))
}

/// POST /api/v1/domain/logout
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    let token = bearer(&headers);
    state.domain_sessions.write().unwrap().remove(&token);
    Ok(Json(json!({ "status": "success" })))
}

/// GET /api/v1/domain/overview
pub async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, true).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let mailboxes = crate::provision_db::list_mailboxes(&client, Some(c.domain_id))
        .await
        .map_err(db_err)?;
    let aliases = crate::provision_db::list_aliases(&client, Some(c.domain_id))
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "domain": c.domain,
        "email": c.email,
        "mailboxes": mailboxes.len(),
        "aliases": aliases.len(),
    })))
}

fn mailbox_json(m: &crate::provision_db::Mailbox) -> serde_json::Value {
    json!({
        "id": format!("mb_{}", m.id),
        "email": m.email,
        "quota_mb": m.quota_mb,
        "active": m.active,
        "created_at": m.created_at.to_rfc3339(),
    })
}

/// GET /api/v1/domain/mailboxes
pub async fn list_mailboxes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, true).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let list = crate::provision_db::list_mailboxes(&client, Some(c.domain_id))
        .await
        .map_err(db_err)?;
    Ok(Json(json!({ "mailboxes": list.iter().map(mailbox_json).collect::<Vec<_>>() })))
}

#[derive(Deserialize)]
pub struct CreateMailboxPayload {
    pub email: String,
    pub password: String,
    pub quota_mb: Option<i32>,
}

/// POST /api/v1/domain/mailboxes — the address must be in the caller's domain.
pub async fn create_mailbox(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateMailboxPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let email = payload.email.trim().to_lowercase();
    if !email.ends_with(&format!("@{}", c.domain)) {
        return Err(err(403, "mailbox must be inside your domain"));
    }
    if payload.password.len() < 8 {
        return Err(err(400, "password must be at least 8 characters"));
    }
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let created = crate::provision_db::create_mailbox(
        &client,
        Some(c.domain_id),
        &email,
        &payload.password,
        payload.quota_mb.unwrap_or(5120),
    )
    .await
    .map_err(|e| {
        if e.to_string().contains("duplicate key") {
            err(409, "mailbox already exists")
        } else {
            db_err(e)
        }
    })?;
    Ok(Json(mailbox_json(&created)))
}

#[derive(Deserialize)]
pub struct PasswordPayload {
    pub password: String,
}

/// PUT /api/v1/domain/mailboxes/{id}/password — own-domain mailboxes only.
pub async fn set_mailbox_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PasswordPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let db_id = id
        .strip_prefix("mb_")
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| err(404, "Mailbox not found"))?;
    if payload.password.len() < 8 {
        return Err(err(400, "password must be at least 8 characters"));
    }
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let mailbox = crate::provision_db::get_mailbox(&client, db_id)
        .await
        .map_err(db_err)?
        .filter(|m| m.domain_id == Some(c.domain_id))
        .ok_or_else(|| err(404, "Mailbox not found"))?;
    crate::provision_db::set_mailbox_password(&client, mailbox.id, &payload.password)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({ "status": "success" })))
}

/// GET /api/v1/domain/aliases
pub async fn list_aliases(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, true).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let list = crate::provision_db::list_aliases(&client, Some(c.domain_id))
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "aliases": list.iter().map(|a| json!({
            "id": a.id, "source": a.source, "destination": a.destination, "active": a.active
        })).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
pub struct CreateAliasPayload {
    pub source: String,
    pub destination: String,
}

/// POST /api/v1/domain/aliases — the source must be in the caller's domain.
pub async fn create_alias(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAliasPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let source = payload.source.trim().to_lowercase();
    if !source.ends_with(&format!("@{}", c.domain)) {
        return Err(err(403, "alias source must be inside your domain"));
    }
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let created = crate::provision_db::create_alias(
        &client,
        Some(c.domain_id),
        &source,
        payload.destination.trim(),
    )
    .await
    .map_err(|e| {
        if e.to_string().contains("duplicate key") {
            err(409, "alias already exists")
        } else {
            db_err(e)
        }
    })?;
    Ok(Json(json!({
        "id": created.id, "source": created.source,
        "destination": created.destination, "active": created.active
    })))
}

/// DELETE /api/v1/domain/aliases/{id} — own-domain aliases only.
pub async fn delete_alias(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i32>,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let mine = crate::provision_db::list_aliases(&client, Some(c.domain_id))
        .await
        .map_err(db_err)?;
    if !mine.iter().any(|a| a.id == id) {
        return Err(err(404, "Alias not found"));
    }
    crate::provision_db::delete_alias(&client, id)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({ "status": "success" })))
}

/// GET /api/v1/domain/api-keys (session only — keys cannot manage keys)
pub async fn list_api_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let keys = crate::domain_panel::list_api_keys(&client, c.domain_id)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "api_keys": keys.iter().map(|(id, name, created, used)| json!({
            "id": id, "name": name, "created_at": created, "last_used_at": used
        })).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
pub struct CreateKeyPayload {
    pub name: Option<String>,
}

/// POST /api/v1/domain/api-keys — the raw key is returned exactly once.
pub async fn create_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateKeyPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    let (id, raw) = crate::domain_panel::create_api_key(
        &client,
        c.domain_id,
        payload.name.as_deref().unwrap_or(""),
    )
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "id": id, "key": raw, "note": "Store this key now — it is shown only once." })))
}

/// DELETE /api/v1/domain/api-keys/{id}
pub async fn delete_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i32>,
) -> Result<impl IntoResponse, ApiErr> {
    let c = ctx(&state, &headers, false).await?;
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    if !crate::domain_panel::delete_api_key(&client, c.domain_id, id)
        .await
        .map_err(db_err)?
    {
        return Err(err(404, "API key not found"));
    }
    Ok(Json(json!({ "status": "success" })))
}

#[derive(Deserialize)]
pub struct SetOwnerPayload {
    pub email: String,
    pub password: String,
}

/// POST /api/v1/admin/domains/{id}/owner — admin sets the :2083 login
/// for a domain (provisioning step). {id} is the mail_domains id.
pub async fn admin_set_owner(
    State(_state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<SetOwnerPayload>,
) -> Result<impl IntoResponse, ApiErr> {
    if payload.password.len() < 10 {
        return Err(err(400, "owner password must be at least 10 characters"));
    }
    let client = crate::provision_db::connect_db().await.map_err(db_err)?;
    if crate::provision_db::get_domain_by_id(&client, id)
        .await
        .map_err(db_err)?
        .is_none()
    {
        return Err(err(404, "Domain not found"));
    }
    crate::domain_panel::set_owner(&client, id, payload.email.trim(), &payload.password)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({ "status": "success" })))
}
