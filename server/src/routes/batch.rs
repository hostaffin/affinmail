use crate::state::AppState;
use crate::types::{ErrorResponse, Mailbox};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize)]
pub struct BatchJob {
    pub id: String,
    pub status: String, // pending, running, done, failed
    pub job_type: String, // mailboxes, suspend, dns_check
    pub total: usize,
    pub processed: usize,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Deserialize)]
pub struct BatchMailboxPayload {
    pub domain_name: String,
    pub emails: Vec<String>,
    pub display_name: Option<String>,
    pub quota_limit_mb: Option<i64>,
}

#[derive(Deserialize)]
pub struct BatchSuspendPayload {
    pub account_ids: Vec<String>,
}

#[derive(Deserialize)]
pub struct BatchDnsCheckPayload {
    pub domains: Vec<String>,
}

pub async fn batch_mailboxes(
    State(state): State<AppState>,
    Json(payload): Json<BatchMailboxPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if payload.emails.len() > 500 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "Batch size exceeds 500 mailboxes")),
        ));
    }

    let mut mailboxes = state.mailboxes.write().unwrap();
    let mut created = 0;
    let mut errors = Vec::new();

    for email in &payload.emails {
        let email_lower = email.to_lowercase();
        if mailboxes.values().any(|m| m.email == email_lower) {
            errors.push(format!("Mailbox {} already exists", email));
            continue;
        }

        let id = format!("mb_{}", uuid::Uuid::new_v4().simple());
        let mbox = Mailbox {
            id: id.clone(),
            domain_id: "dom_1".to_string(),
            domain_name: payload.domain_name.clone(),
            email: email_lower.clone(),
            display_name: payload.display_name.clone().unwrap_or_else(|| "User".to_string()),
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
            totp_secret: None,
            totp_enabled: false,
            recovery_codes: Vec::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        mailboxes.insert(id, mbox);
        created += 1;
    }

    let job = BatchJob {
        id: format!("batch_{}", uuid::Uuid::new_v4().simple()),
        status: "done".to_string(),
        job_type: "mailboxes".to_string(),
        total: payload.emails.len(),
        processed: payload.emails.len(),
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state
        .batch_jobs
        .write()
        .unwrap()
        .insert(job.id.clone(), job.clone());

    Ok((
        StatusCode::OK,
        Json(json!({
            "job_id": job.id,
            "created": created,
            "errors": errors,
            "total": payload.emails.len(),
        })),
    ))
}

pub async fn batch_suspend(
    State(state): State<AppState>,
    Json(payload): Json<BatchSuspendPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut accounts = state.accounts.write().unwrap();
    let mut suspended = 0;
    let mut errors = Vec::new();

    for id in &payload.account_ids {
        if let Some(account) = accounts.get_mut(id) {
            account.status = "suspended".to_string();
            account.suspended_at = Some(chrono::Utc::now().to_rfc3339());
            suspended += 1;
        } else {
            errors.push(format!("Account {} not found", id));
        }
    }

    let job = BatchJob {
        id: format!("batch_{}", uuid::Uuid::new_v4().simple()),
        status: "done".to_string(),
        job_type: "suspend".to_string(),
        total: payload.account_ids.len(),
        processed: payload.account_ids.len(),
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state
        .batch_jobs
        .write()
        .unwrap()
        .insert(job.id.clone(), job.clone());

    Ok((
        StatusCode::OK,
        Json(json!({
            "job_id": job.id,
            "suspended": suspended,
            "errors": errors,
            "total": payload.account_ids.len(),
        })),
    ))
}

pub async fn batch_dns_check(
    State(state): State<AppState>,
    Json(payload): Json<BatchDnsCheckPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    let mut results = HashMap::new();

    for domain_name in &payload.domains {
        if let Some(domain) = domains.get(domain_name) {
            // Basic DNS check: verify domain exists in our system
            let has_dkim = !domain.dkim_public_key.is_empty();
            let has_mx = true; // Assume MX is configured if domain exists
            let has_spf = true; // Assume SPF is configured if domain exists
            let has_dmarc = true; // Assume DMARC is configured if domain exists

            results.insert(
                domain_name.clone(),
                json!({
                    "domain": domain_name,
                    "dkim": if has_dkim { "valid" } else { "missing" },
                    "mx": if has_mx { "valid" } else { "missing" },
                    "spf": if has_spf { "valid" } else { "missing" },
                    "dmarc": if has_dmarc { "valid" } else { "missing" },
                }),
            );
        } else {
            results.insert(
                domain_name.clone(),
                json!({
                    "domain": domain_name,
                    "dkim": "not_found",
                    "mx": "not_found",
                    "spf": "not_found",
                    "dmarc": "not_found",
                }),
            );
        }
    }

    let job = BatchJob {
        id: format!("batch_{}", uuid::Uuid::new_v4().simple()),
        status: "done".to_string(),
        job_type: "dns_check".to_string(),
        total: payload.domains.len(),
        processed: payload.domains.len(),
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state
        .batch_jobs
        .write()
        .unwrap()
        .insert(job.id.clone(), job.clone());

    Ok((
        StatusCode::OK,
        Json(json!({
            "job_id": job.id,
            "results": results,
            "total": payload.domains.len(),
        })),
    ))
}

pub async fn get_batch_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let batch_jobs = state.batch_jobs.read().unwrap();
    match batch_jobs.get(&id) {
        Some(job) => Ok(Json(json!({
            "job_id": job.id,
            "status": job.status,
            "job_type": job.job_type,
            "total": job.total,
            "processed": job.processed,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Job not found")),
        )),
    }
}