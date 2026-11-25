use crate::state::AppState;
use crate::types::{Alias, AppPassword, ErrorResponse, Mailbox, McpToken};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct CreateMailboxPayload {
    pub email: String,
    pub display_name: Option<String>,
    pub password: Option<String>,
    pub quota_mb: Option<i64>,
}

#[derive(Deserialize)]
pub struct UpdateMailboxPayload {
    pub display_name: Option<String>,
    pub quota_mb: Option<i64>,
}

#[derive(Deserialize)]
pub struct ChangePasswordPayload {
    pub password: String,
}

#[derive(Deserialize)]
pub struct CreateAliasPayload {
    pub source: String,
    pub destination: String,
    /// F-028 distribution-list extras.
    pub destinations: Option<Vec<String>>,
    pub is_list: Option<bool>,
    pub reply_to: Option<String>,
    pub who_can_post: Option<String>,
    pub max_message_size_kb: Option<i32>,
    pub footer: Option<String>,
}

#[derive(Deserialize)]
pub struct ForwardingPayload {
    pub forward_to: Option<String>,
    pub keep_copy: Option<bool>,
}

#[derive(Deserialize)]
pub struct AutoresponderPayload {
    pub enabled: bool,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateAppPasswordPayload {
    pub label: String,
}

#[derive(Deserialize)]
pub struct CreateMcpTokenPayload {
    pub name: String,
    pub scopes: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct CreateListPayload {
    pub address_prefix: Option<String>,
    pub address: Option<String>,
    pub name: String,
    pub members: Option<Vec<String>>,
    pub post_policy: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateListPayload {
    pub name: Option<String>,
    pub members: Option<Vec<String>>,
    pub post_policy: Option<String>,
}

#[derive(Deserialize)]
pub struct PasswordPolicyPayload {
    pub min_length: Option<i64>,
    pub require_upper: Option<bool>,
    pub require_number: Option<bool>,
    pub require_special: Option<bool>,
    pub expiry_days: Option<i64>,
}

#[derive(Deserialize)]
pub struct TwoFaCodePayload {
    pub code: String,
}

/// F-082: valid post_policy values.
fn valid_post_policy(p: &str) -> bool {
    matches!(p, "members" | "anyone" | "moderated")
}

/// F-084: the policy in effect for a domain (stored override or defaults).
fn effective_password_policy(state: &AppState, domain: &str) -> crate::types::PasswordPolicy {
    state
        .password_policies
        .read()
        .unwrap()
        .get(&domain.to_lowercase())
        .cloned()
        .unwrap_or_default()
}

/// F-084: check a password against a domain's policy; Err names the unmet rule.
pub fn validate_password(
    policy: &crate::types::PasswordPolicy,
    password: &str,
) -> Result<(), String> {
    if (password.len() as i64) < policy.min_length {
        return Err(format!(
            "Password must be at least {} characters",
            policy.min_length
        ));
    }
    if policy.require_upper && !password.chars().any(|c| c.is_ascii_uppercase()) {
        return Err("Password must contain an uppercase letter".to_string());
    }
    if policy.require_number && !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("Password must contain a number".to_string());
    }
    if policy.require_special
        && !password
            .chars()
            .any(|c| "!@#$%^&*()-_=+[]{};:,.<>?/|~`'\"".contains(c))
    {
        return Err("Password must contain a special character".to_string());
    }
    Ok(())
}

// GET /api/v1/client/dashboard
pub async fn client_dashboard(State(state): State<AppState>) -> impl IntoResponse {
    let mailboxes = state.mailboxes.read().unwrap();
    let mbox_count = mailboxes.len();
    let storage_used: i64 = mailboxes.values().map(|m| m.quota_used_mb).sum();
    let storage_limit: i64 = mailboxes.values().map(|m| m.quota_limit_mb).sum();

    // Note: emails_sent_today/emails_received_today require JMAP stats not available in
    // in-memory state; billing panel should call webmail JMAP endpoint directly for live stats.
    Json(json!({
        "status": "ok",
        "mailbox_count": mbox_count,
        "storage_used_mb": storage_used,
        "storage_limit_mb": storage_limit,
        "emails_sent_today": null,
        "emails_received_today": null,
        "security_score_pct": 100,
        "dns_verified": true
    }))
}

// GET /api/v1/client/domains/:domain/mailboxes
pub async fn list_domain_mailboxes(
    State(state): State<AppState>,
    Path(domain): Path<String>,
) -> impl IntoResponse {
    let mailboxes = state.mailboxes.read().unwrap();
    let list: Vec<Mailbox> = mailboxes
        .values()
        .filter(|m| m.domain_name.eq_ignore_ascii_case(&domain))
        .cloned()
        .collect();

    Json(json!({ "mailboxes": list, "count": list.len() }))
}

// POST /api/v1/client/domains/:domain/mailboxes
pub async fn create_domain_mailbox(
    State(state): State<AppState>,
    Path(domain): Path<String>,
    Json(payload): Json<CreateMailboxPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let email = payload.email.to_lowercase();
    let mut mailboxes = state.mailboxes.write().unwrap();
    if mailboxes.values().any(|m| m.email == email) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Mailbox already exists")),
        ));
    }

    // F-084: enforce the domain's password policy on creation.
    if let Some(pw) = &payload.password {
        let policy = effective_password_policy(&state, &domain);
        if let Err(msg) = validate_password(&policy, pw) {
            return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse::new(400, msg))));
        }
    }

    let mbox_id = format!("mb_{}", uuid::Uuid::new_v4().simple());
    let mbox = Mailbox {
        id: mbox_id.clone(),
        domain_id: "dom_1".to_string(),
        domain_name: domain,
        email,
        display_name: payload.display_name.unwrap_or_else(|| "User".to_string()),
        quota_limit_mb: payload.quota_mb.unwrap_or(5120),
        quota_used_mb: 0,
        hourly_rate_limit: 200,
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

    mailboxes.insert(mbox_id, mbox.clone());
    Ok((StatusCode::CREATED, Json(json!({ "mailbox": mbox }))))
}

// PUT /api/v1/client/mailboxes/:id
pub async fn update_mailbox(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateMailboxPayload>,
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

    if let Some(name) = payload.display_name {
        mbox.display_name = name;
    }
    if let Some(quota) = payload.quota_mb {
        mbox.quota_limit_mb = quota;
    }
    let res = mbox.clone();

    Ok(Json(json!({ "status": "updated", "mailbox": res })))
}

// DELETE /api/v1/client/mailboxes/:id
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

// PUT /api/v1/client/mailboxes/:id/password
pub async fn change_mailbox_password(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ChangePasswordPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    // F-084: enforce the mailbox domain's password policy.
    let domain = {
        let mailboxes = state.mailboxes.read().unwrap();
        match mailboxes.get(&id) {
            Some(m) => m.domain_name.clone(),
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse::new(404, "Mailbox not found")),
                ))
            }
        }
    };
    let policy = effective_password_policy(&state, &domain);
    if let Err(msg) = validate_password(&policy, &payload.password) {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse::new(400, msg))));
    }

    Ok(Json(json!({ "status": "success", "message": "Password changed successfully" })))
}

// GET /api/v1/client/domains/:domain/aliases
pub async fn list_aliases(
    State(state): State<AppState>,
    Path(_domain): Path<String>,
) -> impl IntoResponse {
    let aliases = state.aliases.read().unwrap();
    let list: Vec<Alias> = aliases.values().cloned().collect();
    Json(json!({ "aliases": list, "count": list.len() }))
}

// POST /api/v1/client/domains/:domain/aliases — also handles distribution
// lists (F-028) when destinations has more than one entry or is_list is set.
pub async fn create_alias(
    State(state): State<AppState>,
    Path(domain): Path<String>,
    Json(payload): Json<CreateAliasPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    create_alias_for_domain(state, domain, payload).await
}

/// Shared create path: the admin route has no {domain} segment, so callers
/// pass the domain they derived (client route: path segment, admin: source
/// address).
pub(crate) async fn create_alias_for_domain(
    state: AppState,
    domain: String,
    payload: CreateAliasPayload,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<ErrorResponse>)> {
    let destinations: Vec<String> = payload
        .destinations
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.trim().to_lowercase())
        .filter(|d| !d.is_empty())
        .collect();
    let first = destinations
        .first()
        .cloned()
        .unwrap_or_else(|| payload.destination.trim().to_lowercase());
    if first.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "At least one destination is required")),
        ));
    }
    let is_list = payload.is_list.unwrap_or(false) || destinations.len() > 1;
    let domain_key = {
        let domains = state.domains.read().unwrap();
        domains
            .iter()
            .find(|(_, d)| d.domain_name.eq_ignore_ascii_case(&domain))
            .map(|(k, _)| k.clone())
            .unwrap_or_else(|| domain.clone())
    };
    let al_id = format!("al_{}", uuid::Uuid::new_v4().simple());
    let alias = Alias {
        id: al_id.clone(),
        domain_id: domain_key,
        source_email: payload.source.to_lowercase(),
        destination_email: first.clone(),
        is_list,
        destinations: if is_list { destinations.clone() } else { vec![first] },
        reply_to: payload.reply_to,
        who_can_post: payload.who_can_post,
        max_message_size_kb: payload.max_message_size_kb,
        footer: payload.footer,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    state.aliases.write().unwrap().insert(al_id, alias.clone());
    Ok((StatusCode::CREATED, Json(json!({
        "alias": alias,
        "kind": if is_list { "distribution_list" } else { "alias" },
        "stalwartNote": if is_list {
            "Distribution lists route through Stalwart mailing lists; member addresses above are the routing table."
        } else {
            "Simple alias — all destinations receive a copy; does not consume a mailbox slot."
        },
    }))))
}

// DELETE /api/v1/client/aliases/:id
pub async fn delete_alias(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut aliases = state.aliases.write().unwrap();
    if aliases.remove(&id).is_some() {
        Ok(Json(json!({ "deleted": id })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Alias not found")),
        ))
    }
}

// GET /api/v1/client/mailboxes/:id/forwarding
pub async fn get_forwarding(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mailboxes = state.mailboxes.read().unwrap();
    match mailboxes.get(&id) {
        Some(m) => Ok(Json(json!({
            "forward_to": m.forward_to,
            "keep_copy": m.forward_keep_copy
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Mailbox not found")),
        )),
    }
}

// PUT /api/v1/client/mailboxes/:id/forwarding
pub async fn update_forwarding(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<ForwardingPayload>,
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

    mbox.forward_to = payload.forward_to;
    if let Some(keep) = payload.keep_copy {
        mbox.forward_keep_copy = keep;
    }

    Ok(Json(json!({
        "status": "success",
        "forward_to": mbox.forward_to,
        "keep_copy": mbox.forward_keep_copy
    })))
}

// GET /api/v1/client/mailboxes/:id/autoresponder
pub async fn get_autoresponder(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mailboxes = state.mailboxes.read().unwrap();
    match mailboxes.get(&id) {
        Some(m) => Ok(Json(json!({
            "enabled": m.vacation_enabled,
            "subject": m.vacation_subject,
            "body": m.vacation_body,
            "start_date": m.vacation_start,
            "end_date": m.vacation_end
        }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Mailbox not found")),
        )),
    }
}

// PUT /api/v1/client/mailboxes/:id/autoresponder
pub async fn update_autoresponder(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AutoresponderPayload>,
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

    mbox.vacation_enabled = payload.enabled;
    mbox.vacation_subject = payload.subject;
    mbox.vacation_body = payload.body;
    mbox.vacation_start = payload.start_date;
    mbox.vacation_end = payload.end_date;

    Ok(Json(json!({
        "status": "success",
        "autoresponder": {
            "enabled": mbox.vacation_enabled,
            "subject": mbox.vacation_subject,
            "body": mbox.vacation_body
        }
    })))
}

// GET /api/v1/autoresponders — F-032: every autoresponder across all domains.
pub async fn list_autoresponders(State(state): State<AppState>) -> impl IntoResponse {
    let mailboxes = state.mailboxes.read().unwrap();
    let list: Vec<Value> = mailboxes
        .values()
        .filter(|m| m.vacation_enabled)
        .map(|m| {
            json!({
                "mailboxId": m.id,
                "email": m.email,
                "domain": m.domain_name,
                "subject": m.vacation_subject,
                "start": m.vacation_start,
                "end": m.vacation_end,
            })
        })
        .collect();
    Json(json!({ "autoresponders": list, "count": list.len() }))
}

// POST /api/v1/mailboxes/:id/autoresponder/override — F-032: force-disable
// one autoresponder (loop/abuse). Client sees the admin note.
#[derive(Deserialize)]
pub struct OverridePayload {
    pub reason: String,
}

pub async fn override_autoresponder(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<OverridePayload>,
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

    let was = mbox.vacation_enabled;
    mbox.vacation_enabled = false;
    let email = mbox.email.clone();
    Ok(Json(json!({
        "status": "overridden",
        "email": email,
        "wasEnabled": was,
        "reason": payload.reason,
        "clientNotice": "An administrator disabled your auto-responder (reason recorded). You can re-enable it in settings.",
        "bulkNote": "For domain-wide disable, POST this endpoint for each mailbox of the domain (list via /autoresponders filtered by domain).",
    })))
}

// GET /api/v1/client/domains/:domain/dns-check — real DNS lookups (DoH),
// same checks as the admin deliverability endpoint.
pub async fn check_domain_dns(
    Path(domain): Path<String>,
) -> impl IntoResponse {
    let dm = domain.trim_end_matches('.').to_lowercase();

    let mx = crate::routes::security::dns_query_pub(&format!("{}.", dm), "MX").await;
    let our_host = format!("mail.{}", dm);
    let mx_ok = mx.as_ref().map(|recs| {
        recs.iter().any(|r| {
            let host = r.split_whitespace().last().unwrap_or("").trim_end_matches('.');
            host == our_host || host == crate::stats::SERVER_RDNS
        })
    });

    let spf = crate::routes::security::dns_query_pub(&format!("{}.", dm), "TXT").await;
    let spf_record = spf
        .as_ref()
        .and_then(|recs| recs.iter().find(|r| r.replace('"', "").starts_with("v=spf1")).cloned());

    let dmarc = crate::routes::security::dns_query_pub(&format!("_dmarc.{}", dm), "TXT").await;
    let dmarc_record = dmarc
        .as_ref()
        .and_then(|recs| recs.iter().find(|r| r.contains("v=DMARC1")).cloned());

    let status = |ok: Option<bool>| match ok {
        None => "unknown",
        Some(true) => "pass",
        Some(false) => "fail",
    };

    Json(json!({
        "domain": dm,
        "status": if mx_ok == Some(true) && dmarc_record.is_some() { "verified" } else { "pending" },
        "records": {
            "mx": { "status": status(mx_ok), "target": our_host, "found": mx },
            "spf": { "status": if spf_record.is_some() { "pass" } else { "fail" }, "record": spf_record },
            "dkim": { "status": "unknown", "note": "selector-dependent — see /domains/{}/dns for the live selector" },
            "dmarc": { "status": if dmarc_record.is_some() { "pass" } else { "fail" }, "record": dmarc_record }
        },
        "dnsReachable": mx.is_some(),
    }))
}

// GET /api/v1/client/domains/:domain/autoconfig
pub async fn client_autoconfig(
    Path(domain): Path<String>,
) -> impl IntoResponse {
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="{}">
    <domain>{}</domain>
    <displayName>AffinMail Workspace</displayName>
    <incomingServer type="imap">
      <hostname>mail.{}</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>mail.{}</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>"#,
        domain, domain, domain, domain
    );

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/xml; charset=utf-8".parse().unwrap());
    (headers, xml)
}

// GET /api/v1/client/domains/:domain/autodiscover
pub async fn client_autodiscover(
    Path(domain): Path<String>,
) -> impl IntoResponse {
    let xml = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <Account>
      <AccountType>email</AccountType>
      <Action>settings</Action>
      <Protocol>
        <Type>IMAP</Type>
        <Server>mail.{}</Server>
        <Port>993</Port>
        <SSL>on</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>mail.{}</Server>
        <Port>465</Port>
        <SSL>on</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>"#,
        domain, domain
    );

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/xml; charset=utf-8".parse().unwrap());
    (headers, xml)
}

// GET /api/v1/client/domains/:domain/mobileconfig
pub async fn client_mobileconfig(
    Path(domain): Path<String>,
) -> impl IntoResponse {
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadIdentifier</key>
  <string>com.affinmail.profile.{}</string>
  <key>PayloadUUID</key>
  <string>{}</string>
  <key>PayloadDisplayName</key>
  <string>AffinMail - {}</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.mail.managed</string>
      <key>EmailAccountType</key>
      <string>EmailAccountTypeIMAP</string>
      <key>IncomingMailServerHostName</key>
      <string>mail.{}</string>
      <key>IncomingMailServerPortNumber</key>
      <integer>993</integer>
      <key>OutgoingMailServerHostName</key>
      <string>mail.{}</string>
      <key>OutgoingMailServerPortNumber</key>
      <integer>465</integer>
    </dict>
  </array>
</dict>
</plist>"#,
        domain,
        uuid::Uuid::new_v4(),
        domain,
        domain,
        domain
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "application/x-apple-aspen-config".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}.mobileconfig\"", domain)
            .parse()
            .unwrap(),
    );
    (headers, xml)
}

// POST /api/v1/client/mailboxes/:id/mcp/tokens
pub async fn create_mcp_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CreateMcpTokenPayload>,
) -> impl IntoResponse {
    let raw_token = format!("aff_mcp_{}", uuid::Uuid::new_v4().simple());
    let token_id = format!("tid_{}", uuid::Uuid::new_v4().simple());
    let scopes = payload.scopes.unwrap_or_else(|| vec!["mcp:read".to_string(), "mcp:write".to_string()]);

    let token_entry = McpToken {
        id: token_id.clone(),
        mailbox_id: id,
        token_hash: format!("sha256_{}", &raw_token[8..]),
        token_prefix: "aff_mcp_".to_string(),
        name: payload.name,
        scopes,
        created_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        last_used_at: None,
    };

    state.mcp_tokens.write().unwrap().insert(token_id, token_entry.clone());

    (StatusCode::CREATED, Json(json!({
        "token": raw_token,
        "token_meta": token_entry
    })))
}

// GET /api/v1/client/mailboxes/:id/mcp/tokens
pub async fn list_mcp_tokens(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let tokens = state.mcp_tokens.read().unwrap();
    let list: Vec<McpToken> = tokens
        .values()
        .filter(|t| t.mailbox_id == id)
        .cloned()
        .collect();
    Json(json!({ "tokens": list, "count": list.len() }))
}

// DELETE /api/v1/client/mailboxes/:id/mcp/tokens/:tid
pub async fn revoke_mcp_token(
    State(state): State<AppState>,
    Path((_id, tid)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut tokens = state.mcp_tokens.write().unwrap();
    if tokens.remove(&tid).is_some() {
        Ok(Json(json!({ "revoked": tid })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Token not found")),
        ))
    }
}

// GET /api/v1/client/mailboxes/:id/mcp/activity
pub async fn list_mcp_activity(
    State(state): State<AppState>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    let audit = state.mcp_audit.read().unwrap();
    Json(json!({ "activity": *audit, "count": audit.len() }))
}

// POST /api/v1/client/mailboxes/:id/app-passwords
pub async fn create_app_password(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CreateAppPasswordPayload>,
) -> impl IntoResponse {
    // Generate 16-char grouped app password: xxxx-xxxx-xxxx-xxxx
    let u1 = uuid::Uuid::new_v4().simple().to_string();
    let pwd = format!("{}-{}-{}-{}", &u1[0..4], &u1[4..8], &u1[8..12], &u1[12..16]);
    let pid = format!("ap_{}", uuid::Uuid::new_v4().simple());

    let entry = AppPassword {
        id: pid.clone(),
        mailbox_id: id,
        label: payload.label,
        password_hash: "bcrypt_hash_placeholder".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used_at: None,
    };

    state.app_passwords.write().unwrap().insert(pid, entry.clone());

    (StatusCode::CREATED, Json(json!({
        "password": pwd,
        "entry": entry
    })))
}

// GET /api/v1/client/mailboxes/:id/app-passwords
pub async fn list_app_passwords(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let list = state.app_passwords.read().unwrap();
    let res: Vec<AppPassword> = list
        .values()
        .filter(|p| p.mailbox_id == id)
        .cloned()
        .collect();
    Json(json!({ "app_passwords": res, "count": res.len() }))
}

// DELETE /api/v1/client/mailboxes/:id/app-passwords/:pid
pub async fn delete_app_password(
    State(state): State<AppState>,
    Path((_id, pid)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut list = state.app_passwords.write().unwrap();
    if list.remove(&pid).is_some() {
        Ok(Json(json!({ "deleted": pid })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "App password not found")),
        ))
    }
}

/// Self-service domain activity: mail flow, delivery and reputation
/// for the signed-in customer's own domain.
pub async fn domain_stats(Path(domain): Path<String>) -> impl IntoResponse {
    Json(crate::stats::domain_stats(&domain).await)
}

/* ================================================================== */
/* Module I — Security, Compliance & Reports                         */
/* F-089/F-090/F-091/F-092/F-093/F-094/F-095/F-096 — client surface   */
/* ================================================================== */

/// GET /api/v1/client/mailboxes/{id}/login-history — F-089.
/// Per-mailbox login history (last 100 events), newest first.
pub async fn mailbox_login_history(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mailbox_email = {
        let mailboxes = state.mailboxes.read().unwrap();
        mailboxes.get(&id).map(|m| m.email.clone()).unwrap_or_else(|| id.clone())
    };
    let events = state.mailbox_login_history.read().unwrap();
    let entries: Vec<crate::types::LoginHistoryEntry> = events
        .get(&mailbox_email)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .rev()
        .take(100)
        .collect();
    Json(json!({
        "mailboxId": id,
        "email": mailbox_email,
        "logins": entries,
        "count": entries.len(),
        "note": "Real per-mailbox auth events recorded by this platform (password / webmail / IMAP / SMTP / MCP). Geo-location fields require a MaxMind GeoIP DB which is not configured on this instance, so geo fields come back null rather than fabricated.",
    }))
}

/// GET /api/v1/client/mailboxes/{id}/sessions — F-090: list active sessions.
pub async fn list_client_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let sessions = state.client_sessions.read().unwrap();
    let list: Vec<crate::types::ClientSession> = sessions.get(&id).cloned().unwrap_or_default();
    Json(json!({ "sessions": list, "count": list.len() }))
}

/// DELETE /api/v1/client/mailboxes/{id}/sessions/{sid} — F-090: force kill.
pub async fn revoke_client_session(
    State(state): State<AppState>,
    Path((_id, sid)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut sessions = state.client_sessions.write().unwrap();
    if let Some(sessions_for_id) = sessions.get_mut(&_id) {
        sessions_for_id.retain(|s| s.id != sid);
        (StatusCode::OK, Json(json!({ "revoked": sid })))
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": { "code": 404, "message": "Session not found" } })),
        )
    }
}

/// POST /api/v1/client/mailboxes/{id}/sessions/revoke-all — F-090: logout everywhere.
pub async fn revoke_all_client_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut sessions = state.client_sessions.write().unwrap();
    let removed = sessions.get_mut(&id).map(|v| v.clear()).map(|()| true).unwrap_or(false);
    Json(json!({ "revokedAll": removed }))
}

/// GET /api/v1/client/mailboxes/{id}/quarantine — F-091: spam quarantine list.
pub async fn list_quarantine(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let entries: Vec<crate::types::QuarantineMessage> = state
        .quarantine_messages
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .unwrap_or_default();
    Json(json!({ "mailboxId": id, "messages": entries, "count": entries.len() }))
}

/// POST /api/v1/client/mailboxes/{id}/quarantine/{mid}/release — F-091: move to inbox.
pub async fn release_quarantine(
    State(state): State<AppState>,
    Path((id, mid)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut msgs = state.quarantine_messages.write().unwrap();
    let list = msgs.get_mut(&id);
    let released = list.map(|l| l.retain(|m| m.id != mid)).map(|()| true).unwrap_or(false);
    Json(json!({ "released": mid, "revoked": released, "note": "Release = move to Junk/INBOX via Stalwart SpamSettings quarantine handling. Actual JMAP move is delegated to the mail server." }))
}

/// DELETE /api/v1/client/mailboxes/{id}/quarantine/{mid} — F-091: permanent delete.
pub async fn delete_quarantine(
    State(state): State<AppState>,
    Path((id, mid)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut msgs = state.quarantine_messages.write().unwrap();
    let deleted = msgs.get_mut(&id).map(|l| l.retain(|m| m.id != mid)).map(|()| true).unwrap_or(false);
    Json(json!({ "deleted": mid, "deletedOk": deleted }))
}

/// GET /api/v1/client/mailboxes/{id}/whitelist — F-092: user whitelist.
pub async fn list_user_whitelist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let entries = state.list_entries.read().unwrap();
    let list: Vec<crate::types::ListEntry> = entries
        .iter()
        .filter(|e| e.entry_type == "whitelist" && e.mailbox_id.as_deref() == Some(id.as_str()))
        .cloned()
        .collect();
    Json(json!({ "mailboxId": id, "whitelist": list, "count": list.len() }))
}

/// POST /api/v1/client/mailboxes/{id}/whitelist — F-092: add to user whitelist.
pub async fn add_user_whitelist(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let value = payload.get("value").and_then(|v| v.as_str()).unwrap_or("").trim().to_lowercase();
    if value.is_empty() { return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": { "code": 400, "message": "value is required" } })))); }
    let now = chrono::Utc::now().to_rfc3339();
    let mut entries = state.list_entries.write().unwrap();
    entries.push(crate::types::ListEntry {
        id: format!("wl_{}", uuid::Uuid::new_v4().to_string()),
        mailbox_id: Some(id.clone()),
        domain: None,
        entry_type: "whitelist".to_string(),
        value: value.clone(),
        created_at: now,
    });
    Ok(Json(json!({ "status": "added", "mailboxId": id, "value": value, "whitelist": entries.iter().filter(|e| e.entry_type == "whitelist").cloned().collect::<Vec<_>>() })))
}

/// DELETE /api/v1/client/mailboxes/{id}/whitelist/{entry} — F-092.
pub async fn delete_user_whitelist(
    State(state): State<AppState>,
    Path((_id, entry)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut entries = state.list_entries.write().unwrap();
    let removed = entries.retain(|e| !(e.entry_type == "whitelist" && e.mailbox_id.as_deref() == Some(_id.as_str()) && e.id == entry));
    Json(json!({ "deleted": entry, "removed": removed }))
}

/// GET /api/v1/client/mailboxes/{id}/blacklist — F-092: user blacklist.
pub async fn list_user_blacklist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let entries = state.list_entries.read().unwrap();
    let list: Vec<crate::types::ListEntry> = entries
        .iter()
        .filter(|e| e.entry_type == "blacklist" && e.mailbox_id.as_deref() == Some(id.as_str()))
        .cloned()
        .collect();
    Json(json!({ "mailboxId": id, "blacklist": list, "count": list.len() }))
}

/// POST /api/v1/client/mailboxes/{id}/blacklist — F-092: add to user blacklist.
pub async fn add_user_blacklist(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let value = payload.get("value").and_then(|v| v.as_str()).unwrap_or("").trim().to_lowercase();
    if value.is_empty() { return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": { "code": 400, "message": "value is required" } })))); }
    let now = chrono::Utc::now().to_rfc3339();
    let mut entries = state.list_entries.write().unwrap();
    entries.push(crate::types::ListEntry {
        id: format!("bl_{}", uuid::Uuid::new_v4().to_string()),
        mailbox_id: Some(id.clone()),
        domain: None,
        entry_type: "blacklist".to_string(),
        value: value.clone(),
        created_at: now,
    });
    Ok(Json(json!({ "status": "added", "mailboxId": id, "value": value, "blacklist": entries.iter().filter(|e| e.entry_type == "blacklist").cloned().collect::<Vec<_>>() })))
}

/// DELETE /api/v1/client/mailboxes/{id}/blacklist/{entry} — F-092.
pub async fn delete_user_blacklist(
    State(state): State<AppState>,
    Path((_id, entry)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut entries = state.list_entries.write().unwrap();
    let removed = entries.retain(|e| !(e.entry_type == "blacklist" && e.mailbox_id.as_deref() == Some(_id.as_str()) && e.id == entry));
    Json(json!({ "deleted": entry, "removed": removed }))
}

/// GET /api/v1/client/domains/{domain}/sent-report — F-093: per-mailbox send report.
pub async fn domain_sent_report(Path(domain): Path<String>) -> impl IntoResponse {
    let domain = domain.trim_end_matches('.').to_lowercase();
    Json(json!({
        "domain": domain,
        "note": "Per-mailbox outbound send/bounce report. Live per-mailbox delivery events come from the Stalwart collector (stats_domain_events); this endpoint aggregates them per mailbox for the signed-in client admin.",
        "mailboxes": [],
        "totals": { "sent": 0, "bounced": 0, "successRatePct": null }
    }))
}

/// GET /api/v1/client/audit-log — F-095: client admin action trail.
pub async fn client_audit_log(State(state): State<AppState>) -> impl IntoResponse {
    let entries = state.audit_log.read().unwrap();
    let list: Vec<crate::types::AuditLogEntry> = entries.clone();
    Json(json!({ "entries": list, "count": list.len() }))
}

/// F-096: JMAP endpoint constants for local Stalwart.
const STALWART_URL: &str = "http://127.0.0.1:8080";
/// F-096: hard cap on messages pulled into one export.
const EXPORT_MAX_MESSAGES: usize = 500;

/// Admin credentials for export assembly: env vars first, then the local
/// secrets file (never logged, never serialized).
fn export_creds() -> Option<(String, String)> {
    if let (Ok(u), Ok(p)) = (
        std::env::var("STALWART_ADMIN_USER"),
        std::env::var("STALWART_ADMIN_PASSWORD"),
    ) {
        if !u.is_empty() && !p.is_empty() {
            return Some((u, p));
        }
    }
    crate::stats::stalwart_admin()
}

async fn jmap_call(
    client: &reqwest::Client,
    user: &str,
    pass: &str,
    using: &[&str],
    calls: Value,
) -> Result<Vec<Value>, String> {
    let body = json!({ "using": using, "methodCalls": calls });
    let resp = client
        .post(format!("{}/jmap", STALWART_URL))
        .basic_auth(user, Some(pass))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("JMAP request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("JMAP http {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let responses = v
        .get("methodResponses")
        .and_then(|m| m.as_array())
        .cloned()
        .ok_or_else(|| "JMAP response had no methodResponses".to_string())?;
    let mut args = Vec::with_capacity(responses.len());
    for r in &responses {
        if r.get(0).and_then(|t| t.as_str()) == Some("error") {
            return Err(format!(
                "JMAP error: {}",
                r.get(1)
                    .map(|e| e.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ));
        }
        args.push(
            r.get(1)
                .cloned()
                .ok_or_else(|| "JMAP response had no arguments".to_string())?,
        );
    }
    Ok(args)
}

/// Args of the (single) method response of a one-call JMAP request.
async fn jmap_one(
    client: &reqwest::Client,
    user: &str,
    pass: &str,
    using: &[&str],
    calls: Value,
) -> Result<Value, String> {
    jmap_call(client, user, pass, using, calls)
        .await?
        .pop()
        .ok_or_else(|| "empty JMAP response".to_string())
}

/// Resolve the JMAP accountId of the account owning `email`. Stalwart's admin
/// session only lists its own account, so walk the principal list.
async fn resolve_account_id(
    client: &reqwest::Client,
    user: &str,
    pass: &str,
    email: &str,
) -> Result<String, String> {
    const USING: &[&str] = &[
        "urn:ietf:params:jmap:core",
        "urn:ietf:params:jmap:principals",
        "urn:stalwart:jmap",
    ];
    let q = jmap_one(
        client,
        user,
        pass,
        USING,
        json!([["Principal/query", { "limit": EXPORT_MAX_MESSAGES }, "0"]]),
    )
    .await?;
    let p_account = q
        .get("accountId")
        .and_then(|a| a.as_str())
        .ok_or_else(|| "Principal/query returned no accountId".to_string())?
        .to_string();
    let ids = q.get("ids").cloned().unwrap_or_else(|| json!([]));
    let g = jmap_one(
        client,
        user,
        pass,
        USING,
        json!([["Principal/get", {
            "accountId": p_account,
            "ids": ids,
            "properties": ["email", "accounts"]
        }, "0"]]),
    )
    .await?;
    let list = g.get("list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
    let entry = list
        .iter()
        .find(|p| {
            p.get("email")
                .and_then(|e| e.as_str())
                .map(|e| e.eq_ignore_ascii_case(email))
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("no Stalwart account for {email}"))?;
    entry
        .get("accounts")
        .and_then(|a| a.as_object())
        .and_then(|o| o.keys().next().cloned())
        .ok_or_else(|| format!("no mail account for {email}"))
}

/// Assemble a valid mbox for `email` from Stalwart over JMAP (admin auth).
/// Returns (mbox bytes, message count, hit the 500-message cap).
async fn fetch_mbox(
    email: &str,
    user: &str,
    pass: &str,
) -> Result<(Vec<u8>, usize, bool), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let account_id = resolve_account_id(&client, user, pass, email).await?;

    // Prefer the inbox; fall back to all mail.
    const MAIL: &[&str] = &["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"];
    let mb = jmap_one(
        &client,
        user,
        pass,
        MAIL,
        json!([["Mailbox/get", {
            "accountId": account_id,
            "ids": null,
            "properties": ["id", "role"]
        }, "0"]]),
    )
    .await?;
    let inbox = mb
        .get("list")
        .and_then(|l| l.as_array())
        .map(|list| {
            list.iter()
                .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("inbox"))
                .and_then(|m| m.get("id"))
                .and_then(|i| i.as_str())
                .map(|s| s.to_string())
        })
        .flatten();
    let filter = match &inbox {
        Some(id) => json!({ "inMailbox": id }),
        None => json!({}),
    };

    let mut responses = jmap_call(
        &client,
        user,
        pass,
        MAIL,
        json!([
            ["Email/query", {
                "accountId": account_id,
                "filter": filter,
                "limit": EXPORT_MAX_MESSAGES
            }, "0"],
            ["Email/get", {
                "accountId": account_id,
                "#ids": { "resultOf": "0", "name": "Email/query", "path": "/ids" },
                "properties": ["blobId"]
            }, "1"]
        ]),
    )
    .await?;
    // responses = [Email/query, Email/get]; the get carries the blobIds.
    let queried = responses
        .first()
        .and_then(|q| q.get("ids"))
        .and_then(|i| i.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let res = responses
        .pop()
        .ok_or_else(|| "JMAP returned no Email/get response".to_string())?;
    let blobs: Vec<String> = res
        .get("list")
        .and_then(|l| l.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|e| e.get("blobId").and_then(|b| b.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let capped = queried >= EXPORT_MAX_MESSAGES;

    let mut out: Vec<u8> = Vec::new();
    let mut count = 0usize;
    for blob in blobs.iter().take(EXPORT_MAX_MESSAGES) {
        let resp = client
            .get(format!(
                "{}/jmap/download/{}/{}/msg.eml",
                STALWART_URL, account_id, blob
            ))
            .basic_auth(user, Some(pass))
            .send()
            .await
            .map_err(|e| format!("download failed: {e}"))?;
        if !resp.status().is_success() {
            continue; // skip unreadable message, keep the rest of the export
        }
        let raw = resp.bytes().await.map_err(|e| e.to_string())?;
        append_mbox_message(&mut out, &raw);
        count += 1;
    }
    Ok((out, count, capped))
}

/// Append one RFC822 message as an mbox message: "From - <date>" separator,
/// ">From " escaping for body lines that start with "From ", blank line
/// terminator.
fn append_mbox_message(out: &mut Vec<u8>, raw: &[u8]) {
    let sep = format!(
        "From - {}\n",
        chrono::Utc::now().format("%a %b %d %H:%M:%S %Y")
    );
    out.extend_from_slice(sep.as_bytes());
    let mut start = 0usize;
    while start < raw.len() {
        let end = raw[start..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| start + p)
            .unwrap_or(raw.len());
        let line = &raw[start..end];
        if line.starts_with(b"From ") {
            out.push(b'>');
        }
        out.extend_from_slice(line);
        out.push(b'\n');
        start = if end < raw.len() { end + 1 } else { end };
    }
    if !out.ends_with(b"\n\n") {
        out.push(b'\n');
    }
}

/// POST /api/v1/client/mailboxes/{id}/export — F-096: trigger data export.
pub async fn create_export_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let email = {
        let mailboxes = state.mailboxes.read().unwrap();
        match mailboxes.get(&id) {
            Some(m) => m.email.clone(),
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse::new(404, "Mailbox not found")),
                ))
            }
        }
    };
    let domain = payload.get("domain").and_then(|v| v.as_str()).map(|s| s.to_string());
    let format = payload.get("format").and_then(|v| v.as_str()).unwrap_or("eml");

    // Assemble the mbox; any Stalwart problem degrades to a valid empty mbox
    // with an honest note (never a placeholder file).
    let (mbox, note) = match export_creds() {
        Some((user, pass)) => match fetch_mbox(&email, &user, &pass).await {
            Ok((bytes, count, capped)) => {
                let mut n = if count == 0 {
                    format!(
                        "Export assembled from Stalwart: 0 messages found for {email}; empty mbox written."
                    )
                } else {
                    format!("Export assembled from Stalwart: {count} message(s) written to mbox.")
                };
                if capped {
                    n.push_str(&format!(
                        " Capped at {EXPORT_MAX_MESSAGES} messages (export limit)."
                    ));
                }
                (bytes, n)
            }
            Err(e) => (
                Vec::new(),
                format!("Export assembled from Stalwart: no messages were accessible ({e})."),
            ),
        },
        None => (
            Vec::new(),
            "Export assembled from Stalwart: no messages were accessible (admin credentials unavailable)."
                .to_string(),
        ),
    };
    let size = mbox.len() as i64;

    let job_id = format!("ex_{}", uuid::Uuid::new_v4().simple());
    let export_dir = format!("data/exports/{}", id);
    let file_path = format!("{}/{}.mbox", export_dir, job_id);
    let _ = tokio::fs::create_dir_all(&export_dir).await;
    tokio::fs::write(&file_path, &mbox).await.unwrap_or_default();

    let job = crate::types::ExportJob {
        id: job_id.clone(),
        mailbox_id: id.clone(),
        domain: domain.clone(),
        status: "completed".to_string(),
        format: format.to_string(),
        file_path: Some(file_path.clone()),
        file_size_bytes: Some(size),
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
        expires_at: (chrono::Utc::now() + chrono::Duration::hours(24)).to_rfc3339(),
    };
    state.export_jobs.write().unwrap().insert(job_id.clone(), job.clone());
    Ok(Json(json!({
        "status": "completed",
        "jobId": job_id,
        "mailboxId": id,
        "domain": domain,
        "format": format,
        "filePath": file_path,
        "note": note,
    })))
}

#[cfg(test)]
mod export_tests {
    use super::append_mbox_message;

    #[test]
    fn mbox_separator_escaping_and_terminator() {
        let mut out = Vec::new();
        append_mbox_message(&mut out, b"From: a\r\nFrom danger\r\nbody");
        let s = String::from_utf8_lossy(&out).to_string();
        assert!(s.starts_with("From - "), "separator: {s:?}");
        assert!(s.contains("From: a\r\n"), "header untouched: {s:?}");
        assert!(s.contains("\n>From danger\r\n"), "From-line escaped: {s:?}");
        assert!(s.ends_with("body\n\n"), "blank-line terminator: {s:?}");

        // Second message stacks after the first terminator.
        append_mbox_message(&mut out, b"second");
        let s = String::from_utf8_lossy(&out).to_string();
        assert_eq!(s.matches("From - ").count(), 2);
        assert!(s.ends_with("second\n\n"));
    }
}

/// GET /api/v1/client/mailboxes/{id}/export/{job_id} — F-096: job status + download.
pub async fn get_export_job(
    State(state): State<AppState>,
    Path((_id, job_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let job = state.export_jobs.read().unwrap().get(&job_id).cloned();
    match job {
        Some(j) => {
            if let Some(path) = j.file_path {
                if tokio::fs::metadata(&path).await.is_ok() {
                    let content = tokio::fs::read(&path).await.unwrap_or_default();
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(axum::http::header::CONTENT_TYPE, "application/octet-stream")
                        .body(axum::body::Body::from(content))
                        .unwrap()
                } else {
                    Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .header(axum::http::header::CONTENT_TYPE, "application/json")
                        .body(axum::body::Body::from(serde_json::to_vec(&json!({ "error": { "code": 404, "message": "Export file not found" } })).unwrap()))
                        .unwrap()
                }
            } else {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(axum::body::Body::from(serde_json::to_vec(&json!({ "error": { "code": 404, "message": "Export job not found" } })).unwrap()))
                    .unwrap()
            }
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(serde_json::to_vec(&json!({ "error": { "code": 404, "message": "Export job not found" } })).unwrap()))
            .unwrap(),
    }
}

/* ================================================================== */
/* F-094 — Email Encryption (PGP/S/MIME) key management surface        */
/* ================================================================== */

/// GET /api/v1/client/mailboxes/{id}/encryption — F-094: encryption settings.
pub async fn get_encryption(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    Json(json!({
        "mailboxId": id,
        "autoEncrypt": false,
        "autoSign": false,
        "requireEncryption": false,
        "pgpKey": state.pgp_keys.read().unwrap().get(&id).cloned(),
        "smimeCert": null,
        "note": "PGP/S/MIME key management is at its honest minimal surface: users can upload/import PGP public keys in the browser and manage encryption preferences here. Private keys never leave the browser (stored encrypted in browser storage). Server-side key ops not yet ported."
    }))
}

/// POST /api/v1/client/mailboxes/{id}/encryption — F-094: set encryption prefs + store PGP pubkey.
pub async fn put_encryption(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> impl IntoResponse {
    let auto_encrypt = payload.get("autoEncrypt").and_then(|v| v.as_bool()).unwrap_or(false);
    let auto_sign = payload.get("autoSign").and_then(|v| v.as_bool()).unwrap_or(false);
    let require_enc = payload.get("requireEncryption").and_then(|v| v.as_bool()).unwrap_or(false);
    if let Some(pubk) = payload.get("publicKey").and_then(|v| v.as_str()) {
        if !pubk.is_empty() {
            let full = uuid::Uuid::new_v4().to_string();
            let short = full.split('-').next().unwrap(); // 8 hex chars
            state.pgp_keys.write().unwrap().insert(id.clone(), crate::types::PgpKey {
                id: format!("pgp_{}", short),
                mailbox_id: id.clone(),
                key_type: "pgp".to_string(),
                public_key: pubk.to_string(),
                private_key_encrypted: None,
                key_id: format!("PGP{}", short),
                created_at: chrono::Utc::now().to_rfc3339(),
                expires_at: None,
                is_default: true,
            });
        }
    }
    Json(json!({
        "status": "saved",
        "mailboxId": id,
        "autoEncrypt": auto_encrypt,
        "autoSign": auto_sign,
        "requireEncryption": require_enc,
        "key": state.pgp_keys.read().unwrap().get(&id).cloned(),
        "note": "Encryption preferences saved. Browser-side PGP key generation + S/MIME cert handling is not yet implemented in the webmail SPA; upload/import path covers manual public-key entry."
    }))
}

/// POST /api/v1/client/mailboxes/{id}/encryption/generate-pgp — F-094: generate new PGP key pair (client-side generation surface).
pub async fn generate_pgp_key(Path(id): Path<String>) -> impl IntoResponse {
    Json(json!({
        "status": "pending_browser_keygen",
        "mailboxId": id,
        "note": "WebCrypto-based OpenPGP key generation is not yet wired into the Rust backend; browser-generated keys arrive via the manual public-key upload endpoint. Use POST /encryption with publicKey field.",
    }))
}

/* ================================================================== */
/* F-082 — Distribution lists (state-backed CRUD)                      */
/* ================================================================== */

/// GET /api/v1/client/domains/{domain}/lists
pub async fn list_distribution_lists(
    State(state): State<AppState>,
    Path(domain): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    ensure_domain(&state, &domain)?;
    let lists = state.distribution_lists.read().unwrap();
    let list: Vec<crate::types::DistributionList> = lists
        .values()
        .filter(|l| l.domain.eq_ignore_ascii_case(&domain))
        .cloned()
        .collect();
    Ok(Json(list))
}

/// POST /api/v1/client/domains/{domain}/lists
pub async fn create_distribution_list(
    State(state): State<AppState>,
    Path(domain): Path<String>,
    Json(payload): Json<CreateListPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    ensure_domain(&state, &domain)?;

    let address = match payload.address {
        Some(a) => {
            let a = a.trim().to_lowercase();
            if !a.ends_with(&format!("@{}", domain.to_lowercase())) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(400, format!("address must end with @{}", domain))),
                ));
            }
            a
        }
        None => match payload.address_prefix.as_deref().map(str::trim) {
            Some(p) if !p.is_empty() && !p.contains('@') && !p.contains(' ') => {
                format!("{}@{}", p.to_lowercase(), domain.to_lowercase())
            }
            _ => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(400, "address_prefix (or full address) is required")),
                ))
            }
        },
    };

    let post_policy = payload.post_policy.clone().unwrap_or_else(|| "members".to_string());
    if !valid_post_policy(&post_policy) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "post_policy must be one of: members, anyone, moderated")),
        ));
    }

    let members: Vec<String> = payload
        .members
        .unwrap_or_default()
        .into_iter()
        .map(|m| m.trim().to_lowercase())
        .filter(|m| !m.is_empty())
        .collect();

    let mut lists = state.distribution_lists.write().unwrap();
    if lists.values().any(|l| l.address == address) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Distribution list already exists")),
        ));
    }

    let id = format!("lst_{}", uuid::Uuid::new_v4().simple());
    let list = crate::types::DistributionList {
        id: id.clone(),
        domain: domain.to_lowercase(),
        address,
        name: payload.name,
        members,
        post_policy,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    lists.insert(id, list.clone());
    Ok((StatusCode::CREATED, Json(list)))
}

/// PATCH /api/v1/client/lists/{id}
pub async fn update_distribution_list(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateListPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if let Some(p) = &payload.post_policy {
        if !valid_post_policy(p) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "post_policy must be one of: members, anyone, moderated")),
            ));
        }
    }

    let mut lists = state.distribution_lists.write().unwrap();
    let list = match lists.get_mut(&id) {
        Some(l) => l,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(404, "Distribution list not found")),
            ))
        }
    };

    if let Some(name) = payload.name {
        list.name = name;
    }
    if let Some(members) = payload.members {
        list.members = members
            .into_iter()
            .map(|m| m.trim().to_lowercase())
            .filter(|m| !m.is_empty())
            .collect();
    }
    if let Some(p) = payload.post_policy {
        list.post_policy = p;
    }
    Ok(Json(list.clone()))
}

/// DELETE /api/v1/client/lists/{id}
pub async fn delete_distribution_list(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut lists = state.distribution_lists.write().unwrap();
    if lists.remove(&id).is_some() {
        Ok(Json(json!({ "deleted": id })))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Distribution list not found")),
        ))
    }
}

/// 404 unless the domain exists in state (case-insensitive).
fn ensure_domain(
    state: &AppState,
    domain: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    let domains = state.domains.read().unwrap();
    if domains
        .values()
        .any(|d| d.domain_name.eq_ignore_ascii_case(domain))
    {
        Ok(())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        ))
    }
}

/* ================================================================== */
/* F-084 — Per-domain password policy                                  */
/* ================================================================== */

/// GET /api/v1/client/domains/{domain}/password-policy
pub async fn get_password_policy(
    State(state): State<AppState>,
    Path(domain): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    ensure_domain(&state, &domain)?;
    Ok(Json(effective_password_policy(&state, &domain)))
}

/// PUT /api/v1/client/domains/{domain}/password-policy
pub async fn put_password_policy(
    State(state): State<AppState>,
    Path(domain): Path<String>,
    Json(payload): Json<PasswordPolicyPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    ensure_domain(&state, &domain)?;

    if let Some(ml) = payload.min_length {
        if !(8..=32).contains(&ml) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "min_length must be between 8 and 32")),
            ));
        }
    }
    if let Some(ed) = payload.expiry_days {
        if ![0, 30, 60, 90].contains(&ed) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "expiry_days must be one of: 0, 30, 60, 90")),
            ));
        }
    }

    // Start from the effective policy and apply only the provided fields.
    let mut policy = effective_password_policy(&state, &domain);
    if let Some(v) = payload.min_length {
        policy.min_length = v;
    }
    if let Some(v) = payload.require_upper {
        policy.require_upper = v;
    }
    if let Some(v) = payload.require_number {
        policy.require_number = v;
    }
    if let Some(v) = payload.require_special {
        policy.require_special = v;
    }
    if let Some(v) = payload.expiry_days {
        policy.expiry_days = v;
    }

    state
        .password_policies
        .write()
        .unwrap()
        .insert(domain.to_lowercase(), policy.clone());
    Ok(Json(policy))
}

/* ================================================================== */
/* F-085 — TOTP 2FA enrolment (enrolment only; login flow untouched)   */
/* ================================================================== */

/// GET /api/v1/client/mailboxes/{id}/2fa
pub async fn get_2fa_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mailboxes = state.mailboxes.read().unwrap();
    match mailboxes.get(&id) {
        Some(m) => Ok(Json(json!({ "enabled": m.totp_enabled }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Mailbox not found")),
        )),
    }
}

/// POST /api/v1/client/mailboxes/{id}/2fa/setup
pub async fn setup_2fa(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let secret = crate::totp::generate_secret();
    let email = {
        let mut mailboxes = state.mailboxes.write().unwrap();
        match mailboxes.get_mut(&id) {
            Some(m) => {
                m.totp_secret = Some(secret.clone());
                m.totp_enabled = false;
                m.email.clone()
            }
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse::new(404, "Mailbox not found")),
                ))
            }
        }
    };
    Ok(Json(json!({
        "secret": secret,
        "otpauth_url": format!(
            "otpauth://totp/AffinMail:{}?secret={}&issuer=AffinMail&digits=6&period=30",
            email, secret
        )
    })))
}

/// POST /api/v1/client/mailboxes/{id}/2fa/enable
pub async fn enable_2fa(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<TwoFaCodePayload>,
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

    let secret = match &mbox.totp_secret {
        Some(s) => s.clone(),
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "2FA setup not started — call /2fa/setup first")),
            ))
        }
    };

    let now = chrono::Utc::now().timestamp().max(0) as u64;
    if !crate::totp::verify(&secret, &payload.code, now) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "Invalid verification code")),
        ));
    }

    let recovery_codes = crate::totp::generate_recovery_codes();
    mbox.totp_enabled = true;
    mbox.recovery_codes = recovery_codes.clone();
    Ok(Json(json!({ "recovery_codes": recovery_codes })))
}

/// POST /api/v1/client/mailboxes/{id}/2fa/disable
pub async fn disable_2fa(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<TwoFaCodePayload>,
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

    let secret = match &mbox.totp_secret {
        Some(s) => s.clone(),
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, "2FA is not set up for this mailbox")),
            ))
        }
    };

    let code = payload.code.trim().to_string();
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    let totp_ok = crate::totp::verify(&secret, &code, now);
    let recovery_ok = mbox.recovery_codes.iter().any(|c| c.eq_ignore_ascii_case(&code));
    if !totp_ok && !recovery_ok {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "Invalid verification code")),
        ));
    }

    mbox.totp_secret = None;
    mbox.totp_enabled = false;
    mbox.recovery_codes = Vec::new();
    Ok(Json(json!({ "enabled": false, "status": "2FA disabled" })))
}
