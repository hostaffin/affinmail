use crate::state::AppState;
use crate::types::{Domain, ErrorResponse, IpPool, Mailbox, QueueMessage};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
pub struct CreateDomainPayload {
    pub name: String,
    pub max_mailboxes: Option<i32>,
    pub max_attachment_size_mb: Option<i32>,
    pub disk_quota_mb: Option<i64>,
}

#[derive(Deserialize)]
pub struct CatchAllPayload {
    pub mailbox_id: Option<String>,
}

#[derive(Deserialize)]
pub struct AdminCreateMailboxPayload {
    pub domain_name: String,
    pub email: String,
    pub display_name: Option<String>,
    pub quota_limit_mb: Option<i64>,
}

#[derive(Deserialize)]
pub struct QuotaPatchPayload {
    pub quota_limit_mb: i64,
}

#[derive(Deserialize)]
pub struct StatusPutPayload {
    pub is_active: bool,
}

#[derive(Deserialize)]
pub struct CreateIpPoolPayload {
    pub name: String,
    pub ips: Vec<String>,
}

#[derive(Deserialize)]
pub struct AssignIpPayload {
    pub domain: String,
    pub ip_address: String,
}

// GET /api/v1/domains
pub async fn list_domains(State(state): State<AppState>) -> impl IntoResponse {
    let domains = state.domains.read().unwrap();
    let list: Vec<Domain> = domains.values().cloned().collect();
    Json(json!({ "domains": list, "count": list.len() }))
}

// POST /api/v1/domains
pub async fn create_domain(
    State(state): State<AppState>,
    Json(payload): Json<CreateDomainPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let name = payload.name.to_lowercase();
    let mut domains = state.domains.write().unwrap();
    if domains.values().any(|d| d.domain_name == name) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Domain already exists")),
        ));
    }

    let id = format!("dom_{}", uuid::Uuid::new_v4().simple());
    let dom = Domain {
        id: id.clone(),
        account_id: None,
        domain_name: name,
        status: "active".to_string(),
        hostaffin_service_id: None,
        max_mailboxes: payload.max_mailboxes.unwrap_or(25),
        max_attachment_size_mb: payload.max_attachment_size_mb.unwrap_or(50),
        disk_quota_mb: payload.disk_quota_mb.unwrap_or(51200),
        dkim_selector: "affinmail".to_string(),
        dkim_public_key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...".to_string(),
        dkim_private_key: "-----BEGIN RSA PRIVATE KEY-----...".to_string(),
        catch_all_mailbox_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    domains.insert(id, dom.clone());
    Ok((StatusCode::CREATED, Json(json!({ "domain": dom }))))
}

// GET /api/v1/domains/:id
pub async fn get_domain(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    let dom = domains
        .values()
        .find(|d| d.id == id || d.domain_name.eq_ignore_ascii_case(&id))
        .cloned();

    match dom {
        Some(d) => Ok(Json(json!({ "domain": d }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        )),
    }
}

// DELETE /api/v1/domains/:id
pub async fn delete_domain(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut domains = state.domains.write().unwrap();
    let key = domains
        .iter()
        .find(|(k, d)| **k == id || d.domain_name.eq_ignore_ascii_case(&id))
        .map(|(k, _)| k.clone());

    if let Some(k) = key {
        domains.remove(&k);
        Ok(Json(json!({ "deleted": id })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        ))
    }
}

// GET /api/v1/domains/:id/dns
pub async fn get_domain_dns(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    let dom = domains
        .values()
        .find(|d| d.id == id || d.domain_name.eq_ignore_ascii_case(&id))
        .cloned();

    match dom {
        Some(d) => Ok(Json(json!({
            "domain": d.domain_name,
            "records": [
                { "type": "MX", "host": "@", "value": format!("mail.{}", d.domain_name), "priority": 10 },
                { "type": "TXT", "host": "@", "value": "v=spf1 a mx ip4:198.51.100.10 ~all" },
                { "type": "TXT", "host": "affinmail._domainkey", "value": format!("v=DKIM1; k=rsa; p={}", d.dkim_public_key) },
                { "type": "TXT", "host": "_dmarc", "value": "v=DMARC1; p=quarantine" },
                { "type": "CNAME", "host": "autodiscover", "value": format!("mail.{}", d.domain_name) },
                { "type": "CNAME", "host": "autoconfig", "value": format!("mail.{}", d.domain_name) }
            ]
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        )),
    }
}

// GET /api/v1/domains/:id/deliverability
pub async fn get_domain_deliverability(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    let dom = domains
        .values()
        .find(|d| d.id == id || d.domain_name.eq_ignore_ascii_case(&id))
        .cloned();

    match dom {
        Some(d) => Ok(Json(json!({
            "domain": d.domain_name,
            "deliverability_score": 100,
            "checks": {
                "mx": { "status": "pass", "target": format!("mail.{}", d.domain_name) },
                "spf": { "status": "pass", "ip_match": true },
                "dkim": { "status": "pass", "selector": "affinmail" },
                "dmarc": { "status": "pass", "policy": "quarantine" }
            }
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        )),
    }
}

// PUT /api/v1/domains/:id/catch-all
pub async fn put_domain_catch_all(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CatchAllPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut domains = state.domains.write().unwrap();
    let dom = domains
        .values_mut()
        .find(|d| d.id == id || d.domain_name.eq_ignore_ascii_case(&id));

    match dom {
        Some(d) => {
            d.catch_all_mailbox_id = payload.mailbox_id;
            Ok(Json(json!({ "status": "success", "catch_all": d.catch_all_mailbox_id })))
        }
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        )),
    }
}

// POST /api/v1/domains/:id/dkim-rotate
pub async fn rotate_domain_dkim(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut domains = state.domains.write().unwrap();
    let dom = domains
        .values_mut()
        .find(|d| d.id == id || d.domain_name.eq_ignore_ascii_case(&id));

    match dom {
        Some(d) => {
            d.dkim_selector = format!("aff_{}", &uuid::Uuid::new_v4().simple().to_string()[0..6]);
            Ok(Json(json!({
                "status": "success",
                "domain": d.domain_name,
                "new_selector": d.dkim_selector
            })))
        }
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        )),
    }
}

// GET /api/v1/mailboxes
pub async fn list_mailboxes(State(state): State<AppState>) -> impl IntoResponse {
    let mboxes = state.mailboxes.read().unwrap();
    let list: Vec<Mailbox> = mboxes.values().cloned().collect();
    Json(json!({ "mailboxes": list, "count": list.len() }))
}

// POST /api/v1/mailboxes
pub async fn create_mailbox(
    State(state): State<AppState>,
    Json(payload): Json<AdminCreateMailboxPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let email = payload.email.to_lowercase();
    let mut mailboxes = state.mailboxes.write().unwrap();
    if mailboxes.values().any(|m| m.email == email) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Mailbox already exists")),
        ));
    }

    let id = format!("mb_{}", uuid::Uuid::new_v4().simple());
    let mbox = Mailbox {
        id: id.clone(),
        domain_id: "dom_1".to_string(),
        domain_name: payload.domain_name,
        email,
        display_name: payload.display_name.unwrap_or_else(|| "User".to_string()),
        quota_limit_mb: payload.quota_limit_mb.unwrap_or(5120),
        quota_used_mb: 0,
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
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    mailboxes.insert(id, mbox.clone());
    Ok((StatusCode::CREATED, Json(json!({ "mailbox": mbox }))))
}

// GET /api/v1/mailboxes/:id
pub async fn get_mailbox(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mailboxes = state.mailboxes.read().unwrap();
    match mailboxes.get(&id) {
        Some(m) => Ok(Json(json!({ "mailbox": m }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Mailbox not found")),
        )),
    }
}

// DELETE /api/v1/mailboxes/:id
pub async fn delete_mailbox(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut mailboxes = state.mailboxes.write().unwrap();
    if mailboxes.remove(&id).is_some() {
        Ok(Json(json!({ "deleted": id })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Mailbox not found")),
        ))
    }
}

// PATCH /api/v1/mailboxes/:id/quota
pub async fn patch_mailbox_quota(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<QuotaPatchPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut mailboxes = state.mailboxes.write().unwrap();
    let mbox = match mailboxes.get_mut(&id) {
        Some(m) => m,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Mailbox not found")),
            ))
        }
    };

    mbox.quota_limit_mb = payload.quota_limit_mb;
    let res = mbox.clone();
    Ok(Json(json!({ "mailbox": res })))
}

// PUT /api/v1/mailboxes/:id/status
pub async fn put_mailbox_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<StatusPutPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut mailboxes = state.mailboxes.write().unwrap();
    let mbox = match mailboxes.get_mut(&id) {
        Some(m) => m,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Mailbox not found")),
            ))
        }
    };

    mbox.is_active = payload.is_active;
    let res = mbox.clone();
    Ok(Json(json!({ "mailbox": res })))
}

// GET /api/v1/queue
pub async fn list_queue(State(state): State<AppState>) -> impl IntoResponse {
    let queue = state.queue.read().unwrap();
    let list: Vec<QueueMessage> = queue.values().cloned().collect();
    Json(json!({ "queue": list, "count": list.len() }))
}

// DELETE /api/v1/queue/:id
pub async fn delete_queue_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut queue = state.queue.write().unwrap();
    if queue.remove(&id).is_some() {
        Ok(Json(json!({ "deleted": id })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Queue message not found")),
        ))
    }
}

// POST /api/v1/queue/:id/retry
pub async fn retry_queue_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut queue = state.queue.write().unwrap();
    let msg = match queue.get_mut(&id) {
        Some(m) => m,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Queue message not found")),
            ))
        }
    };

    msg.retry_count += 1;
    msg.status = "active".to_string();
    let res = msg.clone();
    Ok(Json(json!({ "status": "retrying", "message": res })))
}

// GET /api/v1/mail/track
pub async fn mail_track() -> impl IntoResponse {
    Json(json!({
        "records": [
            {
                "message_id": "msg_001",
                "sender": "alex.mercer@affinmail.local",
                "recipient": "client@external.com",
                "status": "delivered",
                "response_code": 250,
                "latency_ms": 142,
                "tls_version": "TLSv1.3",
                "timestamp": chrono::Utc::now().to_rfc3339()
            }
        ]
    }))
}

// GET /api/v1/system/logs
pub async fn system_logs() -> impl IntoResponse {
    Json(json!({
        "logs": [
            "[INFO] Stalwart JMAP daemon listening on 127.0.0.1:8080",
            "[INFO] Outbound SMTP deliverability engine clean - 0 deferred",
            "[INFO] AffinMail Native Rust REST Server healthy"
        ]
    }))
}

// GET /api/v1/ip-pools
pub async fn list_ip_pools(State(state): State<AppState>) -> impl IntoResponse {
    let pools = state.ip_pools.read().unwrap();
    let list: Vec<IpPool> = pools.values().cloned().collect();
    Json(json!({ "ip_pools": list, "count": list.len() }))
}

// POST /api/v1/ip-pools
pub async fn create_ip_pool(
    State(state): State<AppState>,
    Json(payload): Json<CreateIpPoolPayload>,
) -> impl IntoResponse {
    let id = format!("pool_{}", uuid::Uuid::new_v4().simple());
    let pool = IpPool {
        id: id.clone(),
        pool_name: payload.name,
        ip_addresses: payload.ips,
        is_blacklisted: false,
        reputation_score: 10.0,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    state.ip_pools.write().unwrap().insert(id, pool.clone());
    (StatusCode::CREATED, Json(json!({ "ip_pool": pool })))
}

// POST /api/v1/ippools/assign
pub async fn assign_ip_pool(
    Json(payload): Json<AssignIpPayload>,
) -> impl IntoResponse {
    Json(json!({
        "status": "assigned",
        "domain": payload.domain,
        "ip_address": payload.ip_address
    }))
}

// POST /api/v1/system/backup
pub async fn trigger_backup() -> impl IntoResponse {
    Json(json!({
        "status": "success",
        "backup_file": format!("affinmail_backup_{}.tar.gz", chrono::Utc::now().format("%Y%m%d_%H%M%S")),
        "size_bytes": 14859020
    }))
}

// POST /api/v1/system/restart
pub async fn restart_services() -> impl IntoResponse {
    Json(json!({
        "status": "success",
        "message": "Stalwart Mail Server and AffinMail services restarted successfully"
    }))
}
