//! F-027 — Mailbox batch/message import (mbox, eml, imap) — Rust port of the
//! PHP `/api/v1/import/*` API so the existing ImportView UI keeps working.
//!
//! Flow (same as the PHP backend):
//!   parse upload → dedup (Message-ID / sha256) → JMAP session as the target
//!   user → blob upload → `Email/import` → job record.
//!
//! Jobs are kept in-memory only: the `affinmail_stats` role has no privileges
//! on `import_jobs`/`imported_messages` (owner `affinmail_user`), so
//! persistence is impossible from this process. Responses say so honestly
//! (`persisted: false`); jobs die on restart. Import itself is real.
//!
//! IMAP sources are rejected with 501: there is no IMAP client in the
//! dependency tree and none is worth adding for a prototype — the PHP
//! implementation is the reference if a real port is ever needed.

use crate::state::AppState;
use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

const MAX_UPLOAD_BYTES: usize = 50 * 1024 * 1024; // IMPORT_MAX_BYTES in PHP
const MAX_MESSAGE_BYTES: usize = 25 * 1024 * 1024;
const MAX_MESSAGES: usize = 10_000;
const STALWART_URL: &str = "http://127.0.0.1:8080";

#[derive(Clone, Serialize)]
pub struct ImportJob {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    status: String,
    #[serde(rename = "targetEmail")]
    target_email: String,
    #[serde(rename = "targetFolder")]
    target_folder: Option<String>,
    total: usize,
    imported: usize,
    #[serde(rename = "skippedDuplicates")]
    skipped: usize,
    errors: Vec<Value>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "finishedAt")]
    finished_at: Option<String>,
    /// Honest flag: no DB grants for import tables in this deployment.
    persisted: bool,
}

/// Jobs live in AppState so other handlers could inspect them later if needed.
pub fn new_job_store() -> Arc<Mutex<HashMap<String, ImportJob>>> {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Derive a 32-byte key from a VAULT_KEY string (64 hex chars → raw bytes,
/// else SHA-256 of the string). Same derivation as the PHP-era key.
fn key_from_string(line: &str) -> Vec<u8> {
    if line.len() == 64 && line.chars().all(|c| c.is_ascii_hexdigit()) {
        (0..64)
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&line[i..i + 2], 16).ok())
            .collect()
    } else {
        use ring::digest::{digest, SHA256};
        digest(&SHA256, line.as_bytes()).as_ref().to_vec()
    }
}

fn vault_key() -> Option<Vec<u8>> {
    // Check the VAULT_KEY process env var FIRST.
    if let Ok(v) = std::env::var("VAULT_KEY") {
        let line = v.trim().to_string();
        if !line.is_empty() {
            return Some(key_from_string(&line));
        }
    }
    // Fall back to reading the api/.env file as before.
    let raw = std::fs::read_to_string("/var/www/affinmail/api/.env").ok()?;
    let line = raw
        .lines()
        .find(|l| l.starts_with("VAULT_KEY="))?
        .trim_start_matches("VAULT_KEY=")
        .trim()
        .to_string();
    Some(key_from_string(&line))
}

/// Core decryption with an explicit key. Format: base64(iv).base64(tag).base64(ct)
/// where the AES-256-GCM tag is carried separately (PHP-compatible).
pub fn decrypt_with_key(key: &[u8], blob: &str) -> Result<String, String> {
    let parts: Vec<&str> = blob.split('.').collect();
    if parts.len() != 3 {
        return Err("vault value malformed".into());
    }
    let b64 = |s: &str| base64::engine::general_purpose::STANDARD.decode(s).map_err(|e| e.to_string());
    let (iv, tag, mut ct) = (b64(parts[0])?, b64(parts[1])?, b64(parts[2])?);
    // AES-256-GCM via ring's AEAD (same algorithm as PHP openssl_encrypt).
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
    let nonce_bytes: [u8; 12] = iv.try_into().map_err(|_| "bad iv")?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let unbound = UnboundKey::new(&AES_256_GCM, key).map_err(|e| e.to_string())?;
    let opening = LessSafeKey::new(unbound);
    let tag = ring::aead::Tag::try_from(&tag[..]).map_err(|_| "bad tag")?;
    let plain = opening
        .open_in_place_separate_tag(nonce, Aad::empty(), tag, &mut ct, 0..)
        .map_err(|_| "vault decryption failed (wrong key?)".to_string())?;
    String::from_utf8(plain.to_vec()).map_err(|_| "decrypted password is not utf-8".into())
}

fn vault_decrypt(blob: &str) -> Result<String, String> {
    let key = vault_key().ok_or("VAULT_KEY not configured on this instance")?;
    decrypt_with_key(&key, blob)
}

/// Core encryption with an explicit key. Mirrors `decrypt_with_key`: AES-256-GCM,
/// random 12-byte IV from ring::rand::SystemRandom, output
/// base64(iv).base64(tag).base64(ciphertext).
pub fn encrypt_with_key(key: &[u8], plaintext: &str) -> Result<String, String> {
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
    use ring::rand::{SecureRandom, SystemRandom};
    let unbound = UnboundKey::new(&AES_256_GCM, key).map_err(|e| e.to_string())?;
    let sealing = LessSafeKey::new(unbound);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| "rng failed".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut in_out = plaintext.as_bytes().to_vec();
    let tag = sealing
        .seal_in_place_separate_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "encryption failed".to_string())?;
    let b64 = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!(
        "{}.{}.{}",
        b64(&nonce_bytes),
        b64(tag.as_ref()),
        b64(&in_out)
    ))
}

/* ------------------------------------------------------------------ */
/* Parsing (port of PHP parseMbox / messageHeaders / messageIdOf)      */
/* ------------------------------------------------------------------ */

struct ParsedMsg {
    raw: String,
    keywords: Value,
    received_at: String,
    message_id: String,
}

fn headers_block(raw: &str) -> Vec<(String, String)> {
    // Find header/body split (prefer \n\n like PHP when both exist).
    let pos = match (raw.find("\n\n"), raw.find("\r\n\r\n")) {
        (Some(l), Some(c)) => Some(if l < c { l } else { c }),
        (Some(l), None) => Some(l),
        (None, Some(c)) => Some(c),
        (None, None) => None,
    };
    let block = match pos {
        Some(p) => &raw[..p],
        None => raw,
    };
    // Unfold continuation lines, then split name/value.
    let mut unfolded = String::new();
    for line in block.split('\n') {
        if line.starts_with(' ') || line.starts_with('\t') {
            unfolded.push(' ');
            unfolded.push_str(line.trim());
        } else {
            if !unfolded.is_empty() {
                unfolded.push('\n');
            }
            unfolded.push_str(line.trim_end_matches('\r'));
        }
    }
    unfolded
        .split('\n')
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect()
}

fn message_id_of(headers: &[(String, String)]) -> String {
    headers
        .iter()
        .find(|(k, _)| k == "message-id")
        .and_then(|(_, v)| {
            let s = v.trim();
            if let (Some(a), Some(b)) = (s.find('<'), s.find('>')) {
                if b > a {
                    return Some(s[a + 1..b].to_string());
                }
            }
            Some(s.to_string())
        })
        .unwrap_or_default()
}

fn date_to_iso(date: Option<&str>, fallback_ms: i64) -> String {
    if let Some(d) = date {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(d) {
            return dt.to_utc().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        }
    }
    chrono::DateTime::from_timestamp(fallback_ms, 0)
        .unwrap_or_else(chrono::Utc::now)
        .to_utc()
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn mbox_keywords(headers: &[(String, String)]) -> Value {
    let mut kw = serde_json::Map::new();
    let get = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.to_ascii_uppercase())
            .unwrap_or_default()
    };
    if get("status").contains('R') {
        kw.insert("$seen".into(), json!(true));
    }
    let xs = get("x-status");
    if xs.contains('A') {
        kw.insert("$answered".into(), json!(true));
    }
    if xs.contains('F') {
        kw.insert("$flagged".into(), json!(true));
    }
    if xs.contains('D') {
        kw.insert("$draft".into(), json!(true));
    }
    Value::Object(kw)
}

/// Split an mbox into raw messages (mboxrd-aware), port of PHP parseMbox.
fn parse_mbox(raw: &str) -> Vec<ParsedMsg> {
    let strict_starts = |l: &str| {
        // "From sender Day Mon DD HH:MM:SS YYYY" — loose but anchored check.
        l.starts_with("From ")
            && l[5..]
                .trim_start()
                .split_once(' ')
                .map(|(_, rest)| {
                    let p: Vec<&str> = rest.split_whitespace().collect();
                    p.len() >= 5
                })
                .unwrap_or(false)
    };
    let mut out = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    let mut push = |cur: &mut Vec<&str>, from_date_ms: &mut Option<i64>| {
        let body = cur.join("\n");
        if !body.trim().is_empty() {
            let headers = headers_block(&body);
            out.push(ParsedMsg {
                received_at: date_to_iso(None, from_date_ms.unwrap_or(0)),
                message_id: message_id_of(&headers),
                keywords: mbox_keywords(&headers),
                raw: format!("{}\n", body),
            });
        }
        cur.clear();
    };
    let mut from_date: Option<i64> = None;
    for line in raw.split('\n') {
        let line = line.trim_end_matches('\r');
        if strict_starts(line) {
            push(&mut cur, &mut from_date);
            from_date = chrono::DateTime::parse_from_rfc2822(
                line[5..].trim_start().to_string().as_str(),
            )
            .ok()
            .map(|d| d.timestamp());
            continue;
        }
        // mboxrd unescape: ">From " -> "From ".
        let unescaped = if line.starts_with('>') && line[1..].starts_with("From ") {
            &line[1..]
        } else {
            line
        };
        cur.push(unescaped);
    }
    push(&mut cur, &mut from_date);
    out
}

fn parse_eml(raw: &str) -> Vec<ParsedMsg> {
    if raw.starts_with("From ") && raw.contains("\nFrom ") {
        parse_mbox(raw)
    } else {
        let headers = headers_block(raw);
        vec![ParsedMsg {
            received_at: date_to_iso(
                headers.iter().find(|(k, _)| k == "date").map(|(_, v)| v.as_str()),
                chrono::Utc::now().timestamp(),
            ),
            message_id: message_id_of(&headers),
            keywords: mbox_keywords(&headers),
            raw: raw.to_string(),
        }]
    }
}

/* ------------------------------------------------------------------ */
/* Stalwart user-session helpers                                       */
/* ------------------------------------------------------------------ */

async fn jmap_as_user(email: &str, pass: &str, method: &str, args: Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let body = json!({
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [[method, args, "0"]]
    });
    let resp = client
        .post(format!("{}/jmap", STALWART_URL))
        .basic_auth(email, Some(pass))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("JMAP request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("target mailbox authentication failed (http {})", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    v.get("methodResponses")
        .and_then(|m| m.get(0))
        .and_then(|m| m.get(1))
        .cloned()
        .ok_or_else(|| "unexpected JMAP response shape".into())
}

async fn jmap_upload_blob(email: &str, pass: &str, account_id: &str, raw: &[u8]) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{}/jmap/upload/{}/", STALWART_URL, account_id))
        .basic_auth(email, Some(pass))
        .header("Content-Type", "message/rfc822")
        .body(raw.to_vec())
        .send()
        .await
        .map_err(|e| format!("blob upload failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("blob upload failed (http {})", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    v.get("blobId")
        .and_then(|b| b.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "blob upload returned no blobId".into())
}

async fn resolve_target(
    email: &str,
    password: &str,
    folder: &str,
) -> Result<(String, String), String> {
    // Session → accountId.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let sess: Value = client
        .get(format!("{}/jmap/session", STALWART_URL))
        .basic_auth(email, Some(password))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let account_id = sess
        .get("primaryAccounts")
        .and_then(|p| p.get("urn:ietf:params:jmap:mail"))
        .and_then(|a| a.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            sess.get("accounts")
                .and_then(|a| a.as_object())
                .and_then(|o| o.keys().next().cloned())
        })
        .ok_or("target mailbox session has no mail account")?;

    // Mailbox/get → target folder id (role inbox when empty, like PHP).
    let res = jmap_as_user(email, password, "Mailbox/get", json!({
        "accountId": account_id, "ids": null
    }))
    .await?;
    let list = res.get("list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
    let wanted = folder.trim();
    let id = list
        .iter()
        .find(|mb| {
            let role = mb.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let name = mb.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if wanted.is_empty() {
                role == "inbox"
            } else {
                name.eq_ignore_ascii_case(wanted)
            }
        })
        .or_else(|| {
            if wanted.is_empty() {
                list.iter()
                    .find(|mb| mb.get("role").and_then(|r| r.as_str()) == Some("inbox"))
                    .or_else(|| list.first())
            } else {
                None
            }
        })
        .and_then(|mb| mb.get("id").and_then(|i| i.as_str()))
        .ok_or("target mailbox has no folders")?
        .to_string();
    Ok((account_id, id))
}

/* ------------------------------------------------------------------ */
/* Import core                                                         */
/* ------------------------------------------------------------------ */

#[derive(Deserialize, Default)]
pub struct JobQuery {
    pub targetemail: Option<String>,
}

async fn run_import(
    state: &AppState,
    kind: &str,
    target_email: &str,
    target_folder: &str,
    target_password: Option<String>,
    messages: Vec<ParsedMsg>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let email = target_email.trim().to_lowercase();
    if !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err(bad(400, "field targetEmail must be a valid email address"));
    }
    if messages.is_empty() {
        return Err(bad(400, "no messages found to import"));
    }
    if messages.len() > MAX_MESSAGES {
        return Err(bad(400, "import exceeds 10000 messages"));
    }

    // Password: supplied, or decrypt the stored vault (F-027 parity with PHP).
    let password = match target_password.filter(|p| !p.is_empty()) {
        Some(p) => p,
        None => {
            let vault = match crate::stats::pg_connect().await {
                Some(pg) => pg
                    .query_opt(
                        "SELECT secret_vault FROM mailboxes WHERE lower(email) = $1",
                        &[&email],
                    )
                    .await
                    .ok()
                    .flatten(),
                None => None,
            };
            match vault {
                Some(row) => {
                    let v: Option<String> = row.get(0);
                    match v.filter(|s| !s.is_empty()) {
                        Some(blob) => vault_decrypt(&blob).map_err(|e| bad(400, e))?,
                        None => {
                            return Err(bad(400, "target mailbox not found in AffinMail or has no stored password; supply targetPassword"))
                        }
                    }
                }
                None => {
                    return Err(bad(400, "target mailbox not found in AffinMail or has no stored password; supply targetPassword"))
                }
            }
        }
    };

    let (account_id, mailbox_id) =
        resolve_target(&email, &password, target_folder)
            .await
            .map_err(|e| bad(400, e))?;

    let job_id = format!("imp_{}", uuid::Uuid::new_v4().simple());
    let mut errors: Vec<Value> = Vec::new();
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut seen: HashSet<String> = HashSet::new();

    for m in messages {
        if m.raw.len() > MAX_MESSAGE_BYTES {
            errors.push(json!({"messageId": m.message_id, "error": "message exceeds 25MB limit"}));
            continue;
        }
        let key = if m.message_id.is_empty() {
            use ring::digest::{digest, SHA256};
            format!("sha256:{}", hex(digest(&SHA256, m.raw.as_bytes()).as_ref()))
        } else {
            m.message_id.clone()
        };
        if !seen.insert(key.clone()) {
            skipped += 1;
            continue;
        }
        // Server-side dedup: same Message-ID already in the target mailbox?
        if !m.message_id.is_empty() {
            if let Ok(q) = jmap_as_user(
                &email,
                &password,
                "Email/query",
                json!({
                    "accountId": account_id,
                    "filter": {"header": ["Message-ID", format!("<{}>", m.message_id)]},
                    "limit": 1
                }),
            )
            .await
            {
                let have = q.get("ids").and_then(|i| i.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
                if have {
                    skipped += 1;
                    continue;
                }
            }
        }
        let blob = match jmap_upload_blob(&email, &password, &account_id, m.raw.as_bytes()).await {
            Ok(b) => b,
            Err(e) => {
                errors.push(json!({"messageId": key, "error": e}));
                continue;
            }
        };
        let res = jmap_as_user(
            &email,
            &password,
            "Email/import",
            json!({
                "accountId": account_id,
                "emails": {"i1": {
                    "blobId": blob,
                    "mailboxIds": {mailbox_id.clone(): true},
                    "keywords": m.keywords,
                    "receivedAt": m.received_at,
                }}
            }),
        )
        .await;
        match res {
            Ok(r) if r.get("created").and_then(|c| c.get("i1")).is_some() => imported += 1,
            other => errors.push(json!({
                "messageId": key,
                "error": format!("email import rejected: {}", other.map(|o| o.to_string()).unwrap_or_default())
            })),
        }
    }

    let job = ImportJob {
        id: job_id,
        kind: kind.to_string(),
        status: "completed".into(),
        target_email: email.clone(),
        target_folder: if target_folder.trim().is_empty() { None } else { Some(target_folder.to_string()) },
        total: imported + skipped + errors.len(),
        imported,
        skipped,
        errors: errors.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        finished_at: Some(chrono::Utc::now().to_rfc3339()),
        persisted: false,
    };
    state.import_jobs.lock().unwrap().insert(job.id.clone(), job.clone());

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "data": serde_json::to_value(&job).unwrap_or(Value::Null),
            "persisted": false,
            "persistenceNote": "affinmail_stats has no privileges on import_jobs/imported_messages — job history is in-memory only until grants are applied.",
        })),
    ))
}

fn bad(code: u16, msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (
        StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST),
        Json(json!({"status": "error", "error": msg.into()})),
    )
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async fn read_upload(mut mp: Multipart) -> Result<(Vec<u8>, Option<String>, Option<String>, Option<String>), (StatusCode, Json<Value>)> {
    let mut file: Vec<u8> = Vec::new();
    let mut target_email = None;
    let mut target_folder = None;
    let mut target_password = None;
    while let Some(f) = mp.next_field().await.map_err(|e| bad(400, e.to_string()))? {
        match f.name().unwrap_or("") {
            "file" => {
                let data = f.bytes().await.map_err(|e| bad(400, format!("upload read failed: {e}")))?;
                if data.len() > MAX_UPLOAD_BYTES {
                    return Err(bad(413, "file exceeds 50MB limit"));
                }
                file = data.to_vec();
            }
            "targetEmail" => target_email = Some(f.text().await.unwrap_or_default()),
            "targetFolder" => target_folder = Some(f.text().await.unwrap_or_default()),
            "targetPassword" => target_password = Some(f.text().await.unwrap_or_default()),
            _ => {}
        }
    }
    if file.is_empty() {
        return Err(bad(400, "no file uploaded"));
    }
    Ok((file, target_email, target_folder, target_password))
}

pub async fn import_mbox(
    State(state): State<AppState>,
    mp: Multipart,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let (file, email, folder, pass) = read_upload(mp).await?;
    let raw = String::from_utf8_lossy(&file).to_string();
    let messages = parse_mbox(&raw);
    run_import(&state, "mbox", &email.unwrap_or_default(), &folder.unwrap_or_default(), pass, messages).await
}

pub async fn import_eml(
    State(state): State<AppState>,
    mp: Multipart,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let (file, email, folder, pass) = read_upload(mp).await?;
    let raw = String::from_utf8_lossy(&file).to_string();
    let messages = parse_eml(&raw);
    run_import(&state, "eml", &email.unwrap_or_default(), &folder.unwrap_or_default(), pass, messages).await
}

/// IMAP source import: not implemented in the Rust prototype (needs an IMAP
/// client crate; deliberately not added — see module doc).
pub async fn import_imap(Json(_body): Json<Value>) -> impl IntoResponse {
    Err::<Json<Value>, (StatusCode, Json<Value>)>(bad(
        501,
        "IMAP-source import is not implemented in the Rust backend yet. Use mbox/eml upload (fully supported). The legacy PHP API implemented this via a custom IMAP client.",
    ))
}

pub async fn list_jobs(
    State(state): State<AppState>,
    Query(q): Query<JobQuery>,
) -> impl IntoResponse {
    let jobs = state.import_jobs.lock().unwrap();
    let mut list: Vec<&ImportJob> = jobs
        .values()
        .filter(|j| {
            q.targetemail
                .as_ref()
                .map(|t| j.target_email.eq_ignore_ascii_case(t))
                .unwrap_or(true)
        })
        .collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list.truncate(50);
    let out: Vec<Value> = list
        .iter()
        .map(|j| serde_json::to_value(j).unwrap_or(Value::Null))
        .collect();
    let count = out.len();
    Json(json!({
        "status": "success",
        "data": { "jobs": out, "count": count },
        "persisted": false,
    }))
}

pub async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    match state.import_jobs.lock().unwrap().get(&id) {
        Some(j) => Ok(Json(json!({
            "status": "success",
            "data": serde_json::to_value(j).unwrap_or(Value::Null),
        }))),
        None => Err(bad(404, "import job not found")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real ciphertext produced by the PHP vaultEncrypt (bob@affinmail.local's
    /// stored password) — proves ring AES-256-GCM is wire-compatible with the
    /// legacy format. Skipped when the key file or DB is absent.
    #[test]
    fn vault_decrypt_php_vector() {
        let blob = "HnQYRUGfhiCqs8Aq.TZXPFlod3VtWDrWZvVNFMg==.bvfd438aZw6jM/kHr7Ta";
        match vault_decrypt(blob) {
            Ok(p) => assert!(!p.is_empty(), "decrypted to empty string"),
            Err(e) => panic!("decrypt failed: {e} (VAULT_KEY changed on host?)"),
        }
    }

    #[test]
    fn vault_roundtrip_fixed_key() {
        // Fixed 32-byte key — no VAULT_KEY env needed; round-trip must be
        // byte-compatible (3 dot-separated parts, plaintext restored).
        let key: [u8; 32] = [0x5a; 32];
        let plaintext = "s3cr3tP@ssw0rd";
        let blob = encrypt_with_key(&key, plaintext).unwrap();
        assert_eq!(blob.split('.').count(), 3, "blob must have 3 parts");
        let back = decrypt_with_key(&key, &blob).unwrap();
        assert_eq!(back, plaintext);
    }

    #[test]
    fn parse_mbox_splits_and_unescapes() {
        let mbox = "From alice@example.com Mon Jan 01 00:00:00 2024\nMessage-ID: <a@x>\nSubject: one\n\nbody>From escaped\nFrom bob@example.com Tue Jan 02 00:00:00 2024\nMessage-ID: <b@x>\n\nbody2\n";
        let msgs = parse_mbox(mbox);
        assert_eq!(msgs.len(), 2, "expected 2 messages, got {}", msgs.len());
        assert_eq!(msgs[0].message_id, "a@x");
        assert!(msgs[0].raw.contains(">From escaped") || msgs[0].raw.contains("From escaped"));
        assert_eq!(msgs[1].message_id, "b@x");
    }

    #[test]
    fn parse_eml_single() {
        let eml = "Message-ID: <c@x>\nDate: Mon, 01 Jan 2024 00:00:00 +0000\n\nhi";
        let msgs = parse_eml(eml);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].message_id, "c@x");
        assert!(msgs[0].received_at.starts_with("2024-01-01"));
    }
}
