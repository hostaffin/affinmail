use crate::state::AppState;
use crate::types::{Account, Domain, ErrorResponse, Plan};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
pub struct CreateAccountPayload {
    pub company_name: String,
    pub admin_email: String,
    pub plan: Option<String>,
    pub domain: Option<String>,
    pub external_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdatePlanPayload {
    pub plan: String,
}

#[derive(Deserialize)]
pub struct AddDomainPayload {
    pub domain: String,
    pub max_mailboxes: Option<i32>,
    pub storage_mb: Option<i64>,
}

#[derive(Deserialize)]
pub struct SsoTokenPayload {
    pub account_id: Option<String>,
    pub redirect_to: Option<String>,
}

// GET /api/v1/provision/plans
pub async fn list_plans(State(state): State<AppState>) -> impl IntoResponse {
    let plans = state.plans.read().unwrap();
    let list: Vec<Plan> = plans.values().cloned().collect();
    Json(json!({ "plans": list, "count": list.len() }))
}

// GET /api/v1/provision/plans/:id
pub async fn get_plan(
    State(state): State<AppState>,
    Path(id_or_slug): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let plans = state.plans.read().unwrap();
    let found = plans
        .values()
        .find(|p| p.id == id_or_slug || p.slug.eq_ignore_ascii_case(&id_or_slug))
        .cloned();

    match found {
        Some(p) => Ok(Json(json!({ "plan": p }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Plan not found")),
        )),
    }
}

// POST /api/v1/provision/accounts
pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateAccountPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let plan_slug = payload.plan.unwrap_or_else(|| "starter".to_string());
    let plans = state.plans.read().unwrap();
    let plan = plans
        .values()
        .find(|p| p.id == plan_slug || p.slug.eq_ignore_ascii_case(&plan_slug))
        .cloned();

    let plan = match plan {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, format!("Invalid plan '{}'", plan_slug))),
            ))
        }
    };

    let acct_id = format!("acct_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now().to_rfc3339();

    let new_account = Account {
        id: acct_id.clone(),
        company_name: payload.company_name.clone(),
        admin_email: payload.admin_email.clone(),
        plan_id: plan.id.clone(),
        status: "active".to_string(),
        external_id: payload.external_id,
        suspended_at: None,
        terminated_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    state
        .accounts
        .write()
        .unwrap()
        .insert(acct_id.clone(), new_account.clone());

    let mut created_domain = None;
    if let Some(dname) = payload.domain {
        if !dname.is_empty() {
            let dom_id = format!("dom_{}", uuid::Uuid::new_v4().simple());
            let dom = Domain {
                id: dom_id.clone(),
                account_id: Some(acct_id.clone()),
                domain_name: dname.to_lowercase(),
                status: "active".to_string(),
                hostaffin_service_id: None,
                max_mailboxes: plan.max_mailboxes,
                max_attachment_size_mb: plan.max_attachment_size_mb,
                disk_quota_mb: plan.storage_mb,
                dkim_selector: "affinmail".to_string(),
                dkim_public_key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...".to_string(),
                dkim_private_key: "-----BEGIN RSA PRIVATE KEY-----...".to_string(),
                catch_all_mailbox_id: None,
                created_at: now.clone(),
            };
            state.domains.write().unwrap().insert(dom_id.clone(), dom.clone());
            created_domain = Some(dom);
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "account": new_account,
            "domain": created_domain,
            "plan": plan
        })),
    ))
}

// GET /api/v1/provision/accounts/:id
pub async fn get_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let accounts = state.accounts.read().unwrap();
    match accounts.get(&id) {
        Some(a) => {
            let plans = state.plans.read().unwrap();
            let plan = plans.get(&a.plan_id).cloned();
            let domains = state.domains.read().unwrap();
            let domain_count = domains.values().filter(|d| d.account_id.as_deref() == Some(&id)).count();

            Ok(Json(json!({
                "account": a,
                "plan": plan,
                "domains_count": domain_count
            })))
        }
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Account not found")),
        )),
    }
}

// PUT /api/v1/provision/accounts/:id/plan
pub async fn update_account_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdatePlanPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let plans = state.plans.read().unwrap();
    let new_plan = match plans
        .values()
        .find(|p| p.id == payload.plan || p.slug.eq_ignore_ascii_case(&payload.plan))
        .cloned()
    {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "Plan not found")),
            ))
        }
    };
    drop(plans);

    let mut accounts = state.accounts.write().unwrap();
    let account = match accounts.get_mut(&id) {
        Some(a) => a,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };

    account.plan_id = new_plan.id.clone();
    account.updated_at = chrono::Utc::now().to_rfc3339();
    let updated = account.clone();

    Ok(Json(json!({
        "status": "success",
        "account": updated,
        "plan": new_plan
    })))
}

// POST /api/v1/provision/accounts/:id/suspend
pub async fn suspend_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut accounts = state.accounts.write().unwrap();
    let account = match accounts.get_mut(&id) {
        Some(a) => a,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };

    account.status = "suspended".to_string();
    account.suspended_at = Some(chrono::Utc::now().to_rfc3339());
    let res = account.clone();

    Ok(Json(json!({
        "status": "suspended",
        "account": res
    })))
}

// POST /api/v1/provision/accounts/:id/unsuspend
pub async fn unsuspend_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut accounts = state.accounts.write().unwrap();
    let account = match accounts.get_mut(&id) {
        Some(a) => a,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };

    account.status = "active".to_string();
    account.suspended_at = None;
    let res = account.clone();

    Ok(Json(json!({
        "status": "active",
        "account": res
    })))
}

// POST /api/v1/provision/accounts/:id/terminate
pub async fn terminate_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut accounts = state.accounts.write().unwrap();
    let account = match accounts.get_mut(&id) {
        Some(a) => a,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };

    account.status = "terminated".to_string();
    account.terminated_at = Some(chrono::Utc::now().to_rfc3339());
    let res = account.clone();

    Ok(Json(json!({
        "status": "terminated",
        "grace_period_days": 30,
        "account": res
    })))
}

// DELETE /api/v1/provision/accounts/:id
pub async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut accounts = state.accounts.write().unwrap();
    if accounts.remove(&id).is_some() {
        let mut domains = state.domains.write().unwrap();
        domains.retain(|_, d| d.account_id.as_deref() != Some(&id));
        Ok(Json(json!({ "deleted": id })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Account not found")),
        ))
    }
}

// POST /api/v1/provision/accounts/:id/domains
pub async fn add_account_domain(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AddDomainPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let accounts = state.accounts.read().unwrap();
    let _account = match accounts.get(&id) {
        Some(a) => a.clone(),
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };
    drop(accounts);

    let dname = payload.domain.to_lowercase();
    let mut domains = state.domains.write().unwrap();
    if domains.values().any(|d| d.domain_name == dname) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Domain already exists")),
        ));
    }

    let dom_id = format!("dom_{}", uuid::Uuid::new_v4().simple());
    let dom = Domain {
        id: dom_id.clone(),
        account_id: Some(id),
        domain_name: dname,
        status: "active".to_string(),
        hostaffin_service_id: None,
        max_mailboxes: payload.max_mailboxes.unwrap_or(25),
        max_attachment_size_mb: 50,
        disk_quota_mb: payload.storage_mb.unwrap_or(51200),
        dkim_selector: "affinmail".to_string(),
        dkim_public_key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8...".to_string(),
        dkim_private_key: "-----BEGIN RSA PRIVATE KEY-----...".to_string(),
        catch_all_mailbox_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    domains.insert(dom_id, dom.clone());
    Ok((StatusCode::CREATED, Json(json!({ "domain": dom }))))
}

// DELETE /api/v1/provision/accounts/:id/domains/:domain
pub async fn remove_account_domain(
    State(state): State<AppState>,
    Path((id, domain)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut domains = state.domains.write().unwrap();
    let key = domains
        .iter()
        .find(|(_, d)| d.account_id.as_deref() == Some(&id) && d.domain_name.eq_ignore_ascii_case(&domain))
        .map(|(k, _)| k.clone());

    if let Some(k) = key {
        domains.remove(&k);
        Ok(Json(json!({ "deleted": domain })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found for this account")),
        ))
    }
}

// GET /api/v1/provision/accounts/:id/domains
pub async fn list_account_domains(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    let list: Vec<Domain> = domains
        .values()
        .filter(|d| d.account_id.as_deref() == Some(&id))
        .cloned()
        .collect();

    Ok(Json(json!({ "domains": list, "count": list.len() })))
}

// GET /api/v1/provision/accounts/:id/usage
pub async fn get_account_usage(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    let dom_ids: Vec<String> = domains
        .values()
        .filter(|d| d.account_id.as_deref() == Some(&id))
        .map(|d| d.id.clone())
        .collect();
    drop(domains);

    let mailboxes = state.mailboxes.read().unwrap();
    let account_mboxes: Vec<&crate::types::Mailbox> = mailboxes
        .values()
        .filter(|m| dom_ids.contains(&m.domain_id))
        .collect();

    let storage_used_mb: i64 = account_mboxes.iter().map(|m| m.quota_used_mb).sum();
    let mailbox_count = account_mboxes.len();

    Ok(Json(json!({
        "account_id": id,
        "storage_used_mb": storage_used_mb,
        "mailbox_count": mailbox_count,
        "emails_sent_today": 42,
        "emails_received_today": 128
    })))
}

// GET /api/v1/provision/accounts/:id/quota
pub async fn get_account_quota(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let accounts = state.accounts.read().unwrap();
    let account = match accounts.get(&id) {
        Some(a) => a.clone(),
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Account not found")),
            ))
        }
    };
    drop(accounts);

    let plans = state.plans.read().unwrap();
    let plan = plans.get(&account.plan_id).cloned().unwrap_or(Plan {
        id: "default".to_string(),
        slug: "default".to_string(),
        name: "Default".to_string(),
        max_domains: 1,
        max_mailboxes: 5,
        storage_mb: 10240,
        max_attachment_size_mb: 25,
        hourly_rate_limit: 100,
        has_dedicated_ip: false,
        has_sieve_vacation: true,
        has_mcp_access: false,
        created_at: "".to_string(),
        updated_at: "".to_string(),
    });
    drop(plans);

    Ok(Json(json!({
        "account_id": id,
        "plan": plan.name,
        "limits": {
            "max_domains": plan.max_domains,
            "max_mailboxes": plan.max_mailboxes,
            "storage_mb": plan.storage_mb,
            "hourly_rate_limit": plan.hourly_rate_limit
        },
        "usage": {
            "domains_used": 1,
            "mailboxes_used": 1,
            "storage_used_mb": 2048
        }
    })))
}

// POST /api/v1/provision/sso/token
pub async fn provision_sso_token(
    State(state): State<AppState>,
    Json(payload): Json<SsoTokenPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let account_id = match payload.account_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "Missing account_id")),
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
    let expires = now + 60;

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
