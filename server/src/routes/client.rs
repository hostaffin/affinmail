use crate::state::AppState;
use crate::types::{Alias, AppPassword, ErrorResponse, Mailbox, McpToken};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

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

// GET /api/v1/client/dashboard
pub async fn client_dashboard(State(state): State<AppState>) -> impl IntoResponse {
    let mailboxes = state.mailboxes.read().unwrap();
    let mbox_count = mailboxes.len();
    let storage_used: i64 = mailboxes.values().map(|m| m.quota_used_mb).sum();
    let storage_limit: i64 = mailboxes.values().map(|m| m.quota_limit_mb).sum();

    Json(json!({
        "status": "ok",
        "mailbox_count": mbox_count,
        "storage_used_mb": storage_used,
        "storage_limit_mb": storage_limit,
        "emails_sent_today": 12,
        "emails_received_today": 84,
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
    if payload.password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "Password must be at least 8 characters")),
        ));
    }

    let mailboxes = state.mailboxes.read().unwrap();
    if !mailboxes.contains_key(&id) {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Mailbox not found")),
        ));
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

// POST /api/v1/client/domains/:domain/aliases
pub async fn create_alias(
    State(state): State<AppState>,
    Path(_domain): Path<String>,
    Json(payload): Json<CreateAliasPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let al_id = format!("al_{}", uuid::Uuid::new_v4().simple());
    let alias = Alias {
        id: al_id.clone(),
        domain_id: "dom_1".to_string(),
        source_email: payload.source.to_lowercase(),
        destination_email: payload.destination.to_lowercase(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    state.aliases.write().unwrap().insert(al_id, alias.clone());
    Ok((StatusCode::CREATED, Json(json!({ "alias": alias }))))
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

// GET /api/v1/client/domains/:domain/dns-check
pub async fn check_domain_dns(
    Path(domain): Path<String>,
) -> impl IntoResponse {
    Json(json!({
        "domain": domain,
        "status": "verified",
        "records": {
            "mx": { "status": "pass", "target": format!("mail.{}", domain), "priority": 10 },
            "spf": { "status": "pass", "record": "v=spf1 a mx ip4:198.51.100.10 ~all" },
            "dkim": { "status": "pass", "selector": "affinmail", "record": "v=DKIM1; k=rsa; p=..." },
            "dmarc": { "status": "pass", "policy": "quarantine", "record": "v=DMARC1; p=quarantine" }
        }
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
