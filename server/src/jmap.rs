// jmap.rs — Batch 3 JMAP layer (RFC 8620/8621 subset) backed by mail_imap.
// The webmail (webmail/src/lib/jmap.ts) talks JMAP to /jmap/session and /jmap/;
// this module answers those two endpoints for accounts present in mail_users.
// Credentials arrive as HTTP Basic (email:password) — the same creds the browser
// already holds in sessionStorage — and are reused for Dovecot IMAP.

use axum::{
    body::Bytes,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use chrono::{TimeZone, Utc};
use mail_parser::{Addr, Address, MessageParser};
use serde_json::{json, Value};

use crate::{mail_imap, provision_db};

/// Parse `Authorization: Basic base64(email:password)`.
fn parse_basic(headers: &HeaderMap) -> Option<(String, String)> {
    let raw = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, b64) = raw.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("Basic") {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    let (email, password) = text.split_once(':')?;
    Some((email.to_string(), password.to_string()))
}

/// True when the email is a real mailbox in mail_users (DATABASE_URL path).
async fn mailbox_exists(email: &str) -> bool {
    if !provision_db::database_configured() {
        return false;
    }
    let client = match provision_db::connect_db().await {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .query_opt("SELECT 1 FROM mail_users WHERE email = $1", &[&email])
        .await
        .ok()
        .flatten()
        .is_some()
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "invalid email or password").into_response()
}

/// GET /jmap/session
pub async fn session(headers: HeaderMap) -> Response {
    let (email, _password) = match parse_basic(&headers) {
        Some(c) => c,
        None => return unauthorized(),
    };
    if !mailbox_exists(&email).await {
        return unauthorized();
    }

    let mut accounts = serde_json::Map::new();
    accounts.insert(
        email.clone(),
        json!({ "name": email, "accountCapabilities": {} }),
    );
    let mut primary = serde_json::Map::new();
    primary.insert("urn:ietf:params:jmap:mail".to_string(), json!(email));

    let body = json!({
        "username": email,
        "apiUrl": "/jmap/",
        "uploadUrl": "/jmap/upload/{accountId}/",
        "downloadUrl": "/jmap/download/{accountId}/{blobId}/{name}?type={type}",
        "accounts": Value::Object(accounts),
        "primaryAccounts": Value::Object(primary),
        "capabilities": {
            "urn:ietf:params:jmap:core": {},
            "urn:ietf:params:jmap:mail": {},
            "urn:ietf:params:jmap:submission": {},
            "urn:ietf:params:jmap:quota": {}
        }
    });
    Json(body).into_response()
}

/// POST /jmap/ — methodCalls dispatch.
pub async fn jmap(headers: HeaderMap, body: Bytes) -> Response {
    let (email, password) = match parse_basic(&headers) {
        Some(c) => c,
        None => return unauthorized(),
    };
    if !mailbox_exists(&email).await {
        return unauthorized();
    }

    let req: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("invalid JMAP request body: {e}"),
            )
                .into_response()
        }
    };

    let calls = req
        .get("methodCalls")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut responses = Vec::with_capacity(calls.len());
    for call in calls {
        let name = call.get(0).and_then(|v| v.as_str()).unwrap_or("");
        let args = call.get(1).cloned().unwrap_or(Value::Null);
        let cid = call.get(2).cloned().unwrap_or(Value::Null);

        let resp = match name {
            "Mailbox/get" => {
                let result = mailbox_get(&email, &password, &args).await;
                json!(["Mailbox/get", result, cid])
            }
            "Identity/get" => {
                let result = identity_get(&email);
                json!(["Identity/get", result, cid])
            }
            "Email/query" => {
                let result = email_query(&email, &password, &args).await;
                json!(["Email/query", result, cid])
            }
            "Email/get" => {
                let result = email_get(&email, &password, &args).await;
                json!(["Email/get", result, cid])
            }
            "Thread/get" => {
                let result = thread_get(&email, &password, &args).await;
                json!(["Thread/get", result, cid])
            }
            "Email/set" => {
                let result = email_set(&email, &password, &args).await;
                json!(["Email/set", result, cid])
            }
            "EmailSubmission/set" => {
                let result = email_submission_set(&email, &password, &args).await;
                json!(["EmailSubmission/set", result, cid])
            }
            "Quota/get" => {
                let result = quota_get(&email, &password, &args).await;
                json!(["Quota/get", result, cid])
            }
            other => json!([
                "error",
                {
                    "type": "unknownMethod",
                    "description": format!("unsupported JMAP method: {other}")
                },
                cid
            ]),
        };
        responses.push(resp);
    }

    Json(json!({ "methodResponses": responses })).into_response()
}

async fn mailbox_get(email: &str, password: &str, _args: &Value) -> Value {
    let folders = mail_imap::list_folders(email.to_string(), password.to_string())
        .await
        .unwrap_or_default();

    let mut list = Vec::with_capacity(folders.len());
    for f in folders {
        let (total, unseen) =
            mail_imap::folder_counts(email.to_string(), password.to_string(), f.name.clone())
                .await
                .unwrap_or((0, 0));
        let role = if f.role == "other" {
            Value::Null
        } else {
            json!(f.role)
        };
        list.push(json!({
            "id": f.name,
            "name": f.name,
            "role": role,
            "parentId": Value::Null,
            "totalEmails": total,
            "unreadEmails": unseen,
            "isSubscribed": true,
        }));
    }

    json!({ "list": list, "notFound": [] })
}

fn identity_get(email: &str) -> Value {
    json!({
        "list": [{
            "id": "1",
            "email": email,
            "name": email,
            "replyTo": Value::Null,
        }],
        "notFound": []
    })
}

async fn email_query(email: &str, password: &str, args: &Value) -> Value {
    let folder = args
        .get("filter")
        .and_then(|f| f.get("inMailbox"))
        .and_then(|v| v.as_str())
        .unwrap_or("INBOX");
    let text = args
        .get("filter")
        .and_then(|f| f.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
    let position = args.get("position").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

    let uids = if text.is_empty() {
        mail_imap::search_basic(
            email.to_string(),
            password.to_string(),
            folder.to_string(),
            "".to_string(),
        )
        .await
        .unwrap_or_default()
    } else {
        mail_imap::search_basic(
            email.to_string(),
            password.to_string(),
            folder.to_string(),
            text.to_string(),
        )
        .await
        .unwrap_or_default()
    };

    let total = uids.len();
    let paged: Vec<u32> = uids.into_iter().skip(position).take(limit).collect();
    let ids: Vec<String> = paged.iter().map(|uid| format!("{}:{}", folder, uid)).collect();

    json!({
        "accountId": email,
        "queryState": "0",
        "canCalculateChanges": false,
        "total": total,
        "ids": ids,
    })
}

async fn email_get(email: &str, password: &str, args: &Value) -> Value {
    let ids = args
        .get("ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut list = Vec::new();
    let mut not_found = Vec::new();

    for id in ids {
        let (folder, uid_str) = match id.split_once(':') {
            Some(p) => p,
            None => {
                not_found.push(id);
                continue;
            }
        };
        let uid: u32 = match uid_str.parse() {
            Ok(u) => u,
            Err(_) => {
                not_found.push(id);
                continue;
            }
        };

        let rfc822 = match mail_imap::fetch_message(
            email.to_string(),
            password.to_string(),
            folder.to_string(),
            uid,
        )
        .await
        {
            Ok(b) => b,
            Err(_) => {
                not_found.push(id);
                continue;
            }
        };

        let flags = match mail_imap::fetch_flags(
            email.to_string(),
            password.to_string(),
            folder.to_string(),
            uid,
        )
        .await
        {
            Ok(f) => f,
            Err(_) => Vec::new(),
        };

        let parsed = match parse_rfc822_to_jmap(&rfc822, folder, uid, &flags) {
            Some(e) => e,
            None => {
                not_found.push(id);
                continue;
            }
        };
        list.push(parsed);
    }

    json!({
        "accountId": email,
        "list": list,
        "notFound": not_found,
    })
}

async fn thread_get(email: &str, _password: &str, args: &Value) -> Value {
    let ids = args
        .get("ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut list = Vec::new();
    for id in ids {
        list.push(json!({
            "id": id,
            "emailIds": [id],
        }));
    }

    json!({
        "accountId": email,
        "list": list,
        "notFound": [],
    })
}

fn addr_to_json(addr: &Addr) -> Value {
    json!({
        "name": addr.name.as_ref().map(|n| n.to_string()),
        "email": addr.address.as_ref().map(|a| a.to_string()),
    })
}

fn address_list_to_json(addr_opt: Option<&Address>) -> Value {
    match addr_opt {
        None => Value::Array(Vec::new()),
        Some(Address::List(addrs)) => {
            Value::Array(addrs.iter().map(addr_to_json).collect())
        }
        Some(Address::Group(groups)) => {
            let mut all: Vec<Value> = Vec::new();
            for g in groups {
                all.extend(g.addresses.iter().map(addr_to_json));
            }
            Value::Array(all)
        }
    }
}

fn mail_parser_date_to_rfc3339(dt: &mail_parser::DateTime) -> String {
    // Build chrono DateTime from mail_parser DateTime fields
    let mut sign = 1i32;
    if dt.tz_before_gmt {
        sign = -1;
    }
    let offset_minutes =
        sign * ((dt.tz_hour as i32) * 60 + dt.tz_minute as i32);
    let naive = chrono::NaiveDate::from_ymd_opt(
        dt.year as i32,
        dt.month as u32,
        dt.day as u32,
    )
    .and_then(|d| d.and_hms_opt(dt.hour as u32, dt.minute as u32, dt.second as u32));
    match naive {
        Some(nd) => Utc
            .from_utc_datetime(&nd)
            .checked_sub_signed(chrono::Duration::minutes(offset_minutes as i64))
            .unwrap_or_else(|| Utc::now())
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        None => Utc::now().to_rfc3339(),
    }
}

fn keywords_from_flags(flags: &[String]) -> Value {
    let mut keywords = serde_json::Map::new();
    for flag in flags {
        match flag.as_str() {
            "\\Seen" => {
                keywords.insert("$seen".to_string(), json!(true));
            }
            "\\Flagged" => {
                keywords.insert("$flagged".to_string(), json!(true));
            }
            "\\Draft" => {
                keywords.insert("$draft".to_string(), json!(true));
            }
            _ => {}
        }
    }
    Value::Object(keywords)
}

fn parse_rfc822_to_jmap(raw: &[u8], folder: &str, uid: u32, flags: &[String]) -> Option<Value> {
    let parsed = match MessageParser::default().parse(raw) {
        Some(m) => m,
        None => return None,
    };

    let id = format!("{}:{}", folder, uid);
    let subject = parsed.subject().map(|s| s.to_string()).unwrap_or_default();

    // Date -> receivedAt ISO 8601 UTC
    let date_opt = parsed.date();
    let received_at = match date_opt {
        Some(dt) => mail_parser_date_to_rfc3339(dt),
        None => Utc::now().to_rfc3339(),
    };

    // From / To / Cc
    let from = address_list_to_json(parsed.from());
    let to = address_list_to_json(parsed.to());
    let cc = address_list_to_json(parsed.cc());

    // Body: text/html parts via mail-parser convenience methods
    let text_body_opt = parsed.body_text(0);
    let html_body_opt = parsed.body_html(0);
    let text_body = text_body_opt.map(|t| t.to_string()).unwrap_or_default();
    let html_body = html_body_opt.map(|h| h.to_string()).unwrap_or_default();

    let mut body_values = serde_json::Map::new();
    if !text_body.is_empty() {
        body_values.insert("text".to_string(), json!({ "value": text_body, "isTruncated": false }));
    }
    if !html_body.is_empty() {
        body_values.insert("html".to_string(), json!({ "value": html_body, "isTruncated": false }));
    }

    let preview = text_body.chars().take(200).collect::<String>().trim().to_string();

    // hasAttachment: attachments field is Vec<MessagePartId>
    let has_attachment = !parsed.attachments.is_empty();
    let attachments = json!([]);

    // mailboxIds — the folder the message belongs to
    let mut mailbox_ids = serde_json::Map::new();
    mailbox_ids.insert(folder.to_string(), json!(true));

    Some(json!({
        "id": id,
        "threadId": id,
        "subject": subject,
        "from": from,
        "to": to,
        "cc": cc,
        "receivedAt": received_at,
        "keywords": keywords_from_flags(flags),
        "mailboxIds": Value::Object(mailbox_ids),
        "preview": preview,
        "hasAttachment": has_attachment,
        "attachments": attachments,
        "bodyValues": Value::Object(body_values),
        "textBody": if !text_body.is_empty() {
            json!([{ "partId": "text", "type": "text/plain" }])
        } else {
            json!([])
        },
        "htmlBody": if !html_body.is_empty() {
            json!([{ "partId": "html", "type": "text/html" }])
        } else {
            json!([])
        },
    }))
}

fn sanitize_header(s: &str) -> String {
    s.chars().filter(|c| *c != '\r' && *c != '\n').collect()
}

fn addr_list_from_value(arr: Option<&Value>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(Value::Array(list)) = arr {
        for item in list.iter() {
            if let Some(email) = item.get("email").and_then(|v| v.as_str()) {
                let email = email.to_string();
                let name = item.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_default();
                out.push((name, email));
            }
        }
    }
    out
}

fn build_rfc822_from_jmap(obj: &Value, from_email: &str) -> Vec<u8> {
    let from_addrs = addr_list_from_value(obj.get("from"));
    let (from_name, from_addr) = from_addrs.first().map(|a| a.clone()).unwrap_or((from_email.to_string(), from_email.to_string()));
    let to_addrs = addr_list_from_value(obj.get("to"));
    let cc_addrs = addr_list_from_value(obj.get("cc"));
    let subject = obj.get("subject").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let body_val = obj.get("bodyValues").cloned().unwrap_or(Value::Null);
    let text_part = obj.get("textBody").and_then(|v| v.as_array()).and_then(|a| a.first());
    let text = text_part
        .and_then(|p| p.get("partId"))
        .and_then(|v| v.as_str())
        .and_then(|pid| body_val.get(pid))
        .and_then(|b| b.get("value").and_then(|v| v.as_str()))
        .unwrap_or("");

    let fmt_addr = |n: &str, e: &str| -> String {
        if n.trim().is_empty() {
            e.to_string()
        } else {
            format!("{} <{}>", n, e)
        }
    };
    let mut headers = String::new();
    headers.push_str(&format!(
        "From: {}\r\n",
        sanitize_header(&fmt_addr(&from_name, &from_addr))
    ));
    if !to_addrs.is_empty() {
        let tos: Vec<String> = to_addrs.iter().map(|(n, e)| fmt_addr(n, e)).collect();
        headers.push_str(&format!("To: {}\r\n", sanitize_header(&tos.join(", "))));
    }
    if !cc_addrs.is_empty() {
        let ccs: Vec<String> = cc_addrs.iter().map(|(n, e)| fmt_addr(n, e)).collect();
        headers.push_str(&format!("Cc: {}\r\n", sanitize_header(&ccs.join(", "))));
    }
    headers.push_str(&format!("Subject: {}\r\n", sanitize_header(&subject)));
    headers.push_str(&format!("Date: {}\r\n", Utc::now().to_rfc2822()));
    headers.push_str(&format!("Message-ID: <{}>\r\n", uuid::Uuid::new_v4()));
    headers.push_str("MIME-Version: 1.0\r\n");
    headers.push_str("Content-Type: text/plain; charset=utf-8\r\n\r\n");

    let out = format!("{headers}{text}");
    out.into_bytes()
}

async fn email_set(email: &str, password: &str, args: &Value) -> Value {
    let create = args.get("create").cloned().unwrap_or(Value::Null);
    let update = args.get("update").cloned().unwrap_or(Value::Null);
    let destroy = args.get("destroy").cloned().unwrap_or(Value::Null);

    let mut created = serde_json::Map::new();
    let mut not_created = serde_json::Map::new();
    if let Value::Object(map) = &create {
        for (name, obj) in map {
            let folder = if let Some(Value::Object(mbox)) = obj.get("mailboxIds") {
                if let Some(f) = mbox.keys().next() {
                    f.clone()
                } else { "Drafts".to_string() }
            } else { "Drafts".to_string() };
            let bytes = build_rfc822_from_jmap(obj, email);
            match mail_imap::append_message(email.to_string(), password.to_string(), folder.clone(), bytes).await {
                Ok(()) => {
                    // the new message has the highest UID in the folder
                    let uids = mail_imap::search_basic(email.to_string(), password.to_string(), folder.clone(), "".to_string()).await.unwrap_or_default();
                    let new_uid = uids.iter().max().copied().unwrap_or(0);
                    let id = format!("{}:{}", folder, new_uid);
                    created.insert(name.clone(), json!({ "id": id, "threadId": id }));
                }
                Err(e) => {
                    not_created.insert(name.clone(), json!({ "type": "serverFail", "description": format!("append failed: {e}") }));
                }
            }
        }
    }

    // update
    let mut updated = serde_json::Map::new();
    let mut not_updated = serde_json::Map::new();
    if let Value::Object(map) = &update {
        for (id, patch) in map {
            let (folder, uid_str) = match id.split_once(':') {
                Some(p) => p,
                None => { not_updated.insert(id.clone(), json!({ "type": "serverFail", "description": "bad id" })); continue; }
            };
            let uid: u32 = match uid_str.parse() {
                Ok(u) => u,
                Err(_) => { not_updated.insert(id.clone(), json!({ "type": "serverFail", "description": "bad uid" })); continue; }
            };
            let mut handled = false;

            if let Some(patch_obj) = patch.as_object() {
                // keywords changes
                for (k, v) in patch_obj {
                    if let Some(_keyword) = k.strip_prefix("keywords/") {
                        if let Some(flag_name) = v.as_str() {
                            let imap_flag = match flag_name {
                                "$seen" => Some("\\Seen"),
                                "$flagged" => Some("\\Flagged"),
                                "$draft" => Some("\\Draft"),
                                _ => None,
                            };
                            if let Some(flag) = imap_flag {
                                let add = v.as_str().map(|s| s != "$draft").unwrap_or(true);
                                let res = mail_imap::set_flag(
                                    email.to_string(), password.to_string(), folder.to_string(), uid,
                                    flag.to_string(), add,
                                ).await;
                                if res.is_err() {
                                    not_updated.insert(id.clone(), json!({ "type": "serverFail", "description": "set flag failed" }));
                                }
                            }
                            handled = true;
                        }
                    }
                    // mailboxIds change = move
                    if let Some(rest) = k.strip_prefix("mailboxIds/") {
                        let target_folder = rest;
                        if target_folder != folder {
                            // fetch RFC822 from source
                            let rfc822 = mail_imap::fetch_message(
                                email.to_string(), password.to_string(), folder.to_string(), uid
                            ).await;
                            if let Ok(msg) = rfc822 {
                                // append to target
                                let _ = mail_imap::append_message(
                                    email.to_string(), password.to_string(), target_folder.to_string(), msg
                                ).await;
                                // delete from source
                                let _ = mail_imap::delete_message(
                                    email.to_string(), password.to_string(), folder.to_string(), uid
                                ).await;
                            } else {
                                not_updated.insert(id.clone(), json!({ "type": "serverFail", "description": "move: fetch failed" }));
                            }
                        }
                        handled = true;
                    }
                }
            }
            if !handled {
                not_updated.insert(id.clone(), json!({ "type": "serverFail", "description": "unsupported update" }));
            }
            updated.insert(id.clone(), json!(null));
        }
    }

    // destroy
    let mut destroyed = Vec::new();
    let mut not_destroyed = serde_json::Map::new();
    if let Some(ids) = destroy.as_array() {
        for id in ids.iter() {
            if let Some(s) = id.as_str() {
                let (folder, uid_str) = match s.split_once(':') {
                    Some(p) => p,
                    None => { not_destroyed.insert(s.to_string(), json!({ "type": "serverFail", "description": "bad id" })); continue; }
                };
                let uid: u32 = match uid_str.parse() {
                    Ok(u) => u,
                    Err(_) => { not_destroyed.insert(s.to_string(), json!({ "type": "serverFail", "description": "bad uid" })); continue; }
                };
                let res = mail_imap::delete_message(
                    email.to_string(), password.to_string(), folder.to_string(), uid
                ).await;
                if res.is_err() {
                    not_destroyed.insert(s.to_string(), json!({ "type": "serverFail", "description": "delete failed" }));
                } else {
                    destroyed.push(s.to_string());
                }
            }
        }
    }

    json!({
        "accountId": email,
        "created": Value::Object(created),
        "notCreated": Value::Object(not_created),
        "updated": Value::Object(updated),
        "notUpdated": Value::Object(not_updated),
        "destroyed": destroyed,
        "notDestroyed": Value::Object(not_destroyed),
    })
}

async fn email_submission_set(email: &str, password: &str, args: &Value) -> Value {
    let create = args.get("create").cloned().unwrap_or(Value::Null);
    let mut created = serde_json::Map::new();
    let mut not_created = serde_json::Map::new();

    if let Value::Object(map) = &create {
        for (client_id, obj) in map {
            let email_id = obj.get("emailId").and_then(|v| v.as_str()).unwrap_or("");
            let envelope = obj.get("envelope");
            let from = envelope.and_then(|e| e.get("mailFrom")).and_then(|v| v.get("email")).and_then(|v| v.as_str()).unwrap_or(email).to_string();
            let rcpts: Vec<String> = envelope.and_then(|e| e.get("rcptTo")).and_then(|v| v.as_array()).map(|arr| {
                arr.iter().filter_map(|r| r.get("email").and_then(|e| e.as_str()).map(|s| s.to_string())).collect::<Vec<_>>()
            }).unwrap_or_default();

            let (folder, uid_str) = match email_id.split_once(':') {
                Some(p) => p,
                None => { not_created.insert(client_id.clone(), json!({ "type": "serverFail", "description": "bad emailId" })); continue; }
            };
            let uid: u32 = match uid_str.parse() { Ok(u) => u, Err(_) => { not_created.insert(client_id.clone(), json!({ "type": "serverFail", "description": "bad uid" })); continue; } };

            let rfc822 = mail_imap::fetch_message(email.to_string(), password.to_string(), folder.to_string(), uid).await;
            if let Err(e) = rfc822 {
                not_created.insert(client_id.clone(), json!({ "type": "serverFail", "description": format!("draft fetch failed: {e}") }));
                continue;
            }
            let rfc822 = rfc822.unwrap();

            let to = if rcpts.is_empty() { vec![email.to_string()] } else { rcpts.clone() };
            let send_res = mail_imap::send_message(email.to_string(), password.to_string(), from.to_string(), to, rfc822.clone()).await;
            if send_res.is_err() {
                not_created.insert(client_id.clone(), json!({ "type": "serverFail", "description": "send failed" }));
                continue;
            }

            let _ = mail_imap::append_message(email.to_string(), password.to_string(), "Sent".to_string(), rfc822.clone()).await;
            let _ = mail_imap::delete_message(email.to_string(), password.to_string(), folder.to_string(), uid).await;

            created.insert(client_id.clone(), json!({ "id": client_id, "emailId": email_id, "threadId": email_id }));
        }
    }

    json!({
        "accountId": email,
        "created": Value::Object(created),
        "notCreated": Value::Object(not_created),
        "updated": Value::Object(serde_json::Map::new()),
        "notUpdated": Value::Object(serde_json::Map::new()),
        "destroyed": Vec::<String>::new(),
        "notDestroyed": Value::Object(serde_json::Map::new()),
    })
}

async fn quota_get(email: &str, password: &str, _args: &Value) -> Value {
    let quota_mb = mailbox_quota_mb(email).await;
    let hard_limit = if quota_mb > 0 { quota_mb * 1024 * 1024 } else { 0 };
    let mut used: u64 = 0;
    let folders = mail_imap::list_folders(email.to_string(), password.to_string()).await.unwrap_or_default();
    for f in folders {
        let msgs = mail_imap::list_messages(email.to_string(), password.to_string(), f.name.clone(), 100000, 0).await.unwrap_or_default();
        for m in msgs {
            used = used.saturating_add(m.size as u64);
        }
    }
    let limit = if hard_limit > 0 { hard_limit as i64 } else { 0 };
    let free = if hard_limit > 0 { (hard_limit as u64).saturating_sub(used) as i64 } else { 0 };
    json!({
        "accountId": email,
        "list": [{
            "id": "quota",
            "accountId": email,
            "name": "mailbox",
            "resourceType": "octets",
            "used": used as i64,
            "hardLimit": if hard_limit > 0 { json!(hard_limit as i64) } else { Value::Null },
            "limit": limit,
            "free": free,
            "scope": "account",
            "types": ["Email"],
        }],
    })
}

async fn mailbox_quota_mb(email: &str) -> i64 {
    let client = match provision_db::connect_db().await {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let row = client
        .query_opt("SELECT quota_mb FROM mail_users WHERE email = $1", &[&email])
        .await
        .ok()
        .flatten();
    match row {
        Some(r) => r.get::<_, i64>(0).max(0),
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_header() {
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            "Basic dXNlckB4LmxvY2FsOnB3".parse().unwrap(),
        );
        let (email, pass) = parse_basic(&h).unwrap();
        assert_eq!(email, "user@x.local");
        assert_eq!(pass, "pw");
    }
}