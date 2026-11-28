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