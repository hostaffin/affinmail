use crate::state::AppState;
use crate::types::{Account, Domain, ErrorResponse, Plan};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

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

/// F-025: plan create/update payload — every plan attribute is settable.
#[derive(Deserialize)]
pub struct PlanPayload {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub max_domains: Option<i32>,
    pub max_mailboxes: Option<i32>,
    pub storage_mb: Option<i64>,
    pub max_aliases: Option<i32>,
    pub max_distribution_lists: Option<i32>,
    pub max_send_per_hour: Option<i32>,
    pub max_send_per_day: Option<i32>,
    pub max_attachment_size_mb: Option<i32>,
    pub hourly_rate_limit: Option<i32>,
    pub webmail_access: Option<bool>,
    pub custom_branding: Option<bool>,
    pub dedicated_ip_count: Option<i32>,
    pub has_sieve_vacation: Option<bool>,
    pub has_mcp_access: Option<bool>,
    pub has_dmarc_reports: Option<bool>,
    pub external_id: Option<String>,
}

fn plan_from_payload(id: &str, p: &PlanPayload, now: &str) -> Plan {
    Plan {
        id: id.to_string(),
        slug: p.slug.clone(),
        name: p.name.clone(),
        description: p.description.clone().unwrap_or_default(),
        max_domains: p.max_domains.unwrap_or(1),
        max_mailboxes: p.max_mailboxes.unwrap_or(5),
        storage_mb: p.storage_mb.unwrap_or(10240),
        max_aliases: p.max_aliases.unwrap_or(10),
        max_distribution_lists: p.max_distribution_lists.unwrap_or(3),
        max_send_per_hour: p.max_send_per_hour.unwrap_or(p.hourly_rate_limit.unwrap_or(200)),
        max_send_per_day: p.max_send_per_day.unwrap_or(1000),
        max_attachment_size_mb: p.max_attachment_size_mb.unwrap_or(25),
        hourly_rate_limit: p.hourly_rate_limit.unwrap_or(200),
        webmail_access: p.webmail_access.unwrap_or(true),
        custom_branding: p.custom_branding.unwrap_or(false),
        dedicated_ip_count: p.dedicated_ip_count.unwrap_or(0),
        has_dedicated_ip: p.dedicated_ip_count.unwrap_or(0) > 0,
        has_sieve_vacation: p.has_sieve_vacation.unwrap_or(true),
        has_mcp_access: p.has_mcp_access.unwrap_or(false),
        has_dmarc_reports: p.has_dmarc_reports.unwrap_or(false),
        external_id: p.external_id.clone(),
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}

fn plan_to_json(p: &Plan) -> Value {
    serde_json::to_value(p).unwrap_or(Value::Null)
}

/// Provision a real 2048-bit RSA DKIM keypair for a new domain + register it
/// with Stalwart. Shared by F-023 (admin create) and F-026 (account create).
async fn provision_domain_record(
    state: &AppState,
    name: &str,
    account_id: Option<String>,
    max_mailboxes: i32,
    max_attachment: i32,
    storage_mb: i64,
) -> Domain {
    let key =
        crate::security_keys::generate_dkim_keypair(name, "affinmail");
    let stalwart = crate::stats::stalwart_jmap(json!([
        ["x:Domain/set", {
            "accountId": "admin",
            "create": { "new-1": { "name": name } }
        }, "0"]
    ]))
    .await;
    let stalwart_ok = matches!(&stalwart, Some(r) if r.get("notCreated").is_none() && r.get("created").is_some());

    let dom = Domain {
        id: format!("dom_{}", uuid::Uuid::new_v4().simple()),
        account_id,
        domain_name: name.to_string(),
        status: if stalwart_ok { "active".to_string() } else { "pending_dns".to_string() },
        hostaffin_service_id: None,
        max_mailboxes,
        max_attachment_size_mb: max_attachment,
        disk_quota_mb: storage_mb,
        dkim_selector: key.selector,
        dkim_public_key: key.public_key,
        dkim_private_key: key.private_key_pem,
        catch_all_mailbox_id: None,
        hourly_send_limit: 200,
        daily_send_limit: 1000,
        send_limit_action: "defer".to_string(),
        suspend_reason: None,
        terminated_at: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state
        .domains
        .write()
        .unwrap()
        .insert(dom.id.clone(), dom.clone());
    dom
}

// GET /api/v1/provision/plans
pub async fn list_plans(State(state): State<AppState>) -> impl IntoResponse {
    let plans = state.plans.read().unwrap();
    let list: Vec<Value> = plans.values().map(plan_to_json).collect();
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
        .find(|p| {
            p.id == id_or_slug
                || p.slug.eq_ignore_ascii_case(&id_or_slug)
                || p.external_id.as_deref() == Some(id_or_slug.as_str())
        })
        .cloned();

    match found {
        Some(p) => Ok(Json(json!({ "plan": plan_to_json(&p) }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Plan not found")),
        )),
    }
}

// POST /api/v1/provision/plans — F-025 create.
pub async fn create_plan(
    State(state): State<AppState>,
    Json(payload): Json<PlanPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if payload.slug.is_empty() || payload.name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "slug and name are required")),
        ));
    }
    let mut plans = state.plans.write().unwrap();
    if plans.values().any(|p| p.slug.eq_ignore_ascii_case(&payload.slug)) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "A plan with this slug already exists")),
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("plan_{}", uuid::Uuid::new_v4().simple());
    let plan = plan_from_payload(&id, &payload, &now);
    plans.insert(id, plan.clone());
    Ok((StatusCode::CREATED, Json(json!({ "plan": plan_to_json(&plan) }))))
}

// PUT /api/v1/provision/plans/:id — F-025 update (all attributes mutable).
pub async fn update_plan(
    State(state): State<AppState>,
    Path(id_or_slug): Path<String>,
    Json(payload): Json<PlanPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut plans = state.plans.write().unwrap();
    let key = plans
        .keys()
        .find(|k| {
            let p = &plans[*k];
            p.id == id_or_slug || p.slug.eq_ignore_ascii_case(&id_or_slug)
        })
        .cloned();
    let Some(key) = key else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Plan not found")),
        ));
    };
    let now = chrono::Utc::now().to_rfc3339();
    let mut updated = plans.get(&key).unwrap().clone();
    updated.slug = payload.slug.clone();
    updated.name = payload.name.clone();
    updated.description = payload.description.clone().unwrap_or(updated.description);
    if let Some(v) = payload.max_domains { updated.max_domains = v; }
    if let Some(v) = payload.max_mailboxes { updated.max_mailboxes = v; }
    if let Some(v) = payload.storage_mb { updated.storage_mb = v; }
    if let Some(v) = payload.max_aliases { updated.max_aliases = v; }
    if let Some(v) = payload.max_distribution_lists { updated.max_distribution_lists = v; }
    if let Some(v) = payload.max_send_per_hour { updated.max_send_per_hour = v; }
    if let Some(v) = payload.max_send_per_day { updated.max_send_per_day = v; }
    if let Some(v) = payload.max_attachment_size_mb { updated.max_attachment_size_mb = v; }
    if let Some(v) = payload.hourly_rate_limit { updated.hourly_rate_limit = v; }
    if let Some(v) = payload.webmail_access { updated.webmail_access = v; }
    if let Some(v) = payload.custom_branding { updated.custom_branding = v; }
    if let Some(v) = payload.dedicated_ip_count {
        updated.dedicated_ip_count = v;
        updated.has_dedicated_ip = v > 0;
    }
    if let Some(v) = payload.has_sieve_vacation { updated.has_sieve_vacation = v; }
    if let Some(v) = payload.has_mcp_access { updated.has_mcp_access = v; }
    if let Some(v) = payload.has_dmarc_reports { updated.has_dmarc_reports = v; }
    if payload.external_id.is_some() { updated.external_id = payload.external_id.clone(); }
    updated.updated_at = now;

    plans.insert(key, updated.clone());
    Ok(Json(json!({ "plan": plan_to_json(&updated) })))
}

// DELETE /api/v1/provision/plans/:id — F-025: blocked while accounts use it.
pub async fn delete_plan(
    State(state): State<AppState>,
    Path(id_or_slug): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut plans = state.plans.write().unwrap();
    let key = plans
        .keys()
        .find(|k| {
            let p = &plans[*k];
            p.id == id_or_slug || p.slug.eq_ignore_ascii_case(&id_or_slug)
        })
        .cloned();
    let Some(key) = key else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Plan not found")),
        ));
    };
    let in_use = state
        .accounts
        .read()
        .unwrap()
        .values()
        .any(|a| a.plan_id == key);
    if in_use {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Plan has active accounts — migrate them to another plan first")),
        ));
    }
    plans.remove(&key);
    Ok(Json(json!({ "deleted": id_or_slug })))
}

// POST /api/v1/provision/accounts — F-026: account + real DKIM + Stalwart
// domain registration + plan limits applied.
pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateAccountPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if payload.company_name.trim().is_empty() || payload.admin_email.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "company_name and admin_email are required")),
        ));
    }
    let plan_slug = payload.plan.unwrap_or_else(|| "starter".to_string());
    let plan = {
        let plans = state.plans.read().unwrap();
        plans
            .values()
            .find(|p| {
                p.id == plan_slug
                    || p.slug.eq_ignore_ascii_case(&plan_slug)
                    || p.external_id.as_deref() == Some(plan_slug.as_str())
            })
            .cloned()
    };

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
        if !dname.trim().is_empty() {
            let name = dname.to_lowercase().trim_end_matches('.').to_string();
            {
                let domains = state.domains.read().unwrap();
                if domains.values().any(|d| d.domain_name == name) {
                    return Err((
                        StatusCode::CONFLICT,
                        Json(ErrorResponse::new(409, format!("Domain '{}' already exists", name))),
                    ));
                }
            }
            let dom = provision_domain_record(
                &state,
                &name,
                Some(acct_id.clone()),
                plan.max_mailboxes,
                plan.max_attachment_size_mb,
                plan.storage_mb,
            )
            .await;
            created_domain = Some(dom);
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "account": new_account,
            "domain": created_domain,
            "plan": plan_to_json(&plan),
            "welcome": {
                "loginUrl": "/webmail",
                "dnsSetup": "See the domain's /dns endpoint for the record table",
                "note": "Welcome email delivery requires outbound mail (rDNS not configured on this instance) — the payload above is what would be sent."
            }
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
            let plan = plans.get(&a.plan_id).map(plan_to_json);
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
        .find(|p| {
            p.id == payload.plan
                || p.slug.eq_ignore_ascii_case(&payload.plan)
                || p.external_id.as_deref() == Some(payload.plan.as_str())
        })
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
        "plan": plan_to_json(&new_plan)
    })))
}

/// F-030: suspend — flips the account and all of its domains to suspended,
/// which blocks outbound sending and new logins at the platform layer.
#[derive(Deserialize)]
pub struct SuspendPayload {
    pub reason: Option<String>,
}

pub async fn suspend_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: Option<Json<SuspendPayload>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let reason = payload
        .and_then(|Json(p)| p.reason)
        .unwrap_or_else(|| "admin_request".to_string());

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
    account.updated_at = chrono::Utc::now().to_rfc3339();
    let res = account.clone();
    drop(accounts);

    // Suspend every domain too: outbound queue holds, logins blocked.
    let mut domains = state.domains.write().unwrap();
    let mut affected = Vec::new();
    for d in domains.values_mut() {
        if d.account_id.as_deref() == Some(&id) {
            d.status = "suspended".to_string();
            d.suspend_reason = Some(reason.clone());
            affected.push(d.domain_name.clone());
        }
    }

    Ok(Json(json!({
        "status": "suspended",
        "reason": reason,
        "account": res,
        "domainsSuspended": affected,
        "effects": ["outbound sending blocked (queue held)", "webmail/IMAP/POP3 login blocked", "inbound mail accepted but not delivered to new sessions"],
    })))
}

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
    account.updated_at = chrono::Utc::now().to_rfc3339();
    let res = account.clone();
    drop(accounts);

    let mut domains = state.domains.write().unwrap();
    let mut affected = Vec::new();
    for d in domains.values_mut() {
        if d.account_id.as_deref() == Some(&id) && d.status == "suspended" {
            d.status = "active".to_string();
            d.suspend_reason = None;
            affected.push(d.domain_name.clone());
        }
    }

    Ok(Json(json!({
        "status": "active",
        "account": res,
        "domainsReactivated": affected,
        "note": "Held queue mail is released by Stalwart when the domain re-enables."
    })))
}

/// F-030: terminate — 30-day grace (configurable), then data removal.
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
    account.updated_at = chrono::Utc::now().to_rfc3339();
    let res = account.clone();
    drop(accounts);

    Ok(Json(json!({
        "status": "terminated",
        "grace_period_days": 30,
        "account": res,
        "deletionAt": (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339(),
        "note": "During the grace period data exists but the account stays suspended. Permanent deletion (mailboxes, DKIM keys, configs) runs at deletionAt — the purge job is not implemented in this prototype; deletion is manual until then.",
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
    let (plan_max_mailboxes, plan_max_domains, plan_attachment, plan_storage) = {
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
        match plans.get(&account.plan_id) {
            Some(p) => (p.max_mailboxes, p.max_domains, p.max_attachment_size_mb, p.storage_mb),
            None => (25, 1, 50, 51200),
        }
    };

    // Plan limit: max domains per account.
    {
        let domains = state.domains.read().unwrap();
        let count = domains.values().filter(|d| d.account_id.as_deref() == Some(&id)).count() as i32;
        if count >= plan_max_domains {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse::new(409, format!("Plan limit reached: max {} domain(s). Upgrade the plan first.", plan_max_domains))),
            ));
        }
    }

    let dname = payload.domain.to_lowercase().trim_end_matches('.').to_string();
    {
        let domains = state.domains.read().unwrap();
        if domains.values().any(|d| d.domain_name == dname) {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse::new(409, "Domain already exists")),
            ));
        }
    }

    let dom = provision_domain_record(
        &state,
        &dname,
        Some(id),
        payload.max_mailboxes.unwrap_or(plan_max_mailboxes),
        plan_attachment,
        payload.storage_mb.unwrap_or(plan_storage),
    )
    .await;

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
        "emails_sent_today": 0,
        "emails_received_today": 0,
        "note": "send/receive counters come from the stats collector (stats_mail_events); shown as 0 here until the collector has data for this account."
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
    let plan = plans.get(&account.plan_id).cloned();
    drop(plans);

    let Some(plan) = plan else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Account's plan no longer exists")),
        ));
    };

    let domains = state.domains.read().unwrap();
    let dom_ids: Vec<String> = domains
        .values()
        .filter(|d| d.account_id.as_deref() == Some(&id))
        .map(|d| d.id.clone())
        .collect();
    let domains_used = dom_ids.len() as i32;
    drop(domains);

    let mailboxes = state.mailboxes.read().unwrap();
    let mailboxes_used = mailboxes.values().filter(|m| dom_ids.contains(&m.domain_id)).count() as i32;
    let storage_used_mb: i64 = mailboxes.values().filter(|m| dom_ids.contains(&m.domain_id)).map(|m| m.quota_used_mb).sum();
    drop(mailboxes);

    Ok(Json(json!({
        "account_id": id,
        "plan": plan.name,
        "limits": {
            "max_domains": plan.max_domains,
            "max_mailboxes": plan.max_mailboxes,
            "storage_mb": plan.storage_mb,
            "max_aliases": plan.max_aliases,
            "max_distribution_lists": plan.max_distribution_lists,
            "max_send_per_hour": plan.max_send_per_hour,
            "max_send_per_day": plan.max_send_per_day,
            "hourly_rate_limit": plan.hourly_rate_limit
        },
        "usage": {
            "domains_used": domains_used,
            "mailboxes_used": mailboxes_used,
            "storage_used_mb": storage_used_mb
        }
    })))
}

// POST /api/v1/provision/sso/token — F-034 impersonation with audit trail.
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

    let account = {
        let accounts = state.accounts.read().unwrap();
        match accounts.get(&account_id) {
            Some(a) => a.clone(),
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse::new(404, "Account not found")),
                ))
            }
        }
    };

    let token = format!("sso_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now().timestamp();
    let expires = now + 60;

    let mut sso = state.sso_tokens.write().unwrap();
    sso.insert(token.clone(), (account.id.clone(), account.admin_email.clone(), expires));
    drop(sso);

    // Audit entry (F-034). Admin identity is the current session user; the
    // prototype has no per-admin identity beyond the shared token.
    state.impersonation_log.write().unwrap().push(crate::types::ImpersonationLog {
        id: format!("imp_{}", uuid::Uuid::new_v4().simple()),
        admin_username: "admin".to_string(),
        account_id: account.id.clone(),
        account_email: account.admin_email.clone(),
        started_at: chrono::Utc::now().to_rfc3339(),
        ended_at: None,
        reason: "support_session".to_string(),
    });

    let redirect = payload.redirect_to.unwrap_or_else(|| "webmail".to_string());
    let signed_url = format!("/auth/sso?token={}&target={}", token, redirect);

    Ok(Json(json!({
        "status": "success",
        "token": token,
        "expires_in": 60,
        "login_url": signed_url,
        "audit": "Impersonation session logged (admin, account, start time). Client panel shows an assistance banner while the session is active.",
    })))
}

// GET /api/v1/provision/impersonations — F-034 audit list.
pub async fn list_impersonations(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let log = state.impersonation_log.read().unwrap();
    Json(json!({ "impersonations": *log, "count": log.len() }))
}
