use crate::state::AppState;
use crate::types::{ApiKey, ErrorResponse};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct CreateApiKeyPayload {
    pub name: String,
    pub scopes: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ApiKeyResponse {
    pub id: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub is_active: bool,
}

#[derive(Serialize, Deserialize)]
pub struct RotateApiKeyPayload {
    pub new_name: Option<String>,
    pub new_scopes: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize)]
pub struct ApiKeyUsageResponse {
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

#[derive(Serialize, Deserialize)]
pub struct ApiKeyDeleteResponse {
    pub deleted: String,
}

pub async fn list_api_keys(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let api_keys = state.api_keys.read().unwrap();
    let keys: Vec<ApiKeyResponse> = api_keys
        .values()
        .map(|key| ApiKeyResponse {
            id: key.id.clone(),
            name: key.name.clone(),
            scopes: key.scopes.clone(),
            created_at: key.created_at.clone(),
            expires_at: key.expires_at.clone(),
            is_active: key.is_active,
        })
        .collect();
    (StatusCode::OK, Json(keys))
}

pub async fn create_api_key(
    State(state): State<AppState>,
    Json(payload): Json<CreateApiKeyPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut api_keys = state.api_keys.write().unwrap();
    let key_id = format!("sk_{}", uuid::Uuid::new_v4().simple());
    
    let api_key = ApiKey {
        id: key_id.clone(),
        name: payload.name.clone(),
        scopes: payload.scopes.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        is_active: true,
        last_used_at: None,
        ip_restriction: None,
    };
    
    api_keys.insert(key_id.clone(), api_key.clone());
    
    Ok((StatusCode::CREATED, Json(ApiKeyResponse {
        id: key_id,
        name: payload.name,
        scopes: payload.scopes,
        created_at: api_key.created_at.clone(),
        expires_at: None,
        is_active: true,
    })))
}

pub async fn delete_api_key(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let api_keys = state.api_keys.read().unwrap();
    if api_keys.get(&id).is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "API key not found")),
        ));
    }

    let mut api_keys = state.api_keys.write().unwrap();
    api_keys.remove(&id);

    Ok((StatusCode::OK, Json(ApiKeyDeleteResponse { deleted: id })))
}

pub async fn rotate_api_key(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<RotateApiKeyPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let api_keys = state.api_keys.read().unwrap();
    if api_keys.get(&id).is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "API key not found")),
        ));
    }

    let mut api_keys = state.api_keys.write().unwrap();
    let key = api_keys.get_mut(&id).ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(ErrorResponse::new(404, "API key not found")))
    })?;

    if payload.new_name.is_some() || payload.new_scopes.is_some() {
        key.name = payload.new_name.clone().unwrap_or(key.name.clone());
        key.scopes = payload.new_scopes.clone().unwrap_or(key.scopes.clone());
        key.created_at = chrono::Utc::now().to_rfc3339();
        key.is_active = true;
        key.expires_at = None;
    } else {
        key.id = format!("sk_{}", uuid::Uuid::new_v4().simple());
        key.created_at = chrono::Utc::now().to_rfc3339();
    }

    Ok((StatusCode::OK, Json(ApiKeyResponse {
        id: key.id.clone(),
        name: key.name.clone(),
        scopes: key.scopes.clone(),
        created_at: key.created_at.clone(),
        expires_at: None,
        is_active: true,
    })))
}

pub async fn get_api_key_usage(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let api_usage = state.api_usage.read().unwrap();
    match api_usage.get(&id) {
        Some(usage) => Ok((StatusCode::OK, Json(ApiKeyUsageResponse {
            key_id: id.clone(),
            total_calls: usage.total_calls,
            calls_today: usage.calls_today,
            calls_this_month: usage.calls_this_month,
            error_count: usage.error_count,
            rate_limit_hits: usage.rate_limit_hits,
            avg_latency_ms: usage.avg_latency_ms,
            last_call_at: usage.last_call_at.clone(),
            top_endpoints: usage.top_endpoints.clone(),
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "API key not found")),
        )),
    }
}