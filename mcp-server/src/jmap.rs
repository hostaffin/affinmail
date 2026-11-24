use crate::auth::start_of_today_iso;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

const CORE: &str = "urn:ietf:params:jmap:core";
const MAIL: &str = "urn:ietf:params:jmap:mail";
const QUOTA: &str = "urn:ietf:params:jmap:quota";
const SUBMISSION: &str = "urn:ietf:params:jmap:submission";
const CONTACTS: &str = "urn:ietf:params:jmap:contacts";

/// Pick the JMAP mail account id from a session document.
pub fn account_id_from_session(session: &Value) -> Result<String, String> {
    if let Some(id) = session
        .pointer("/primaryAccounts/urn:ietf:params:jmap:mail")
        .and_then(|v| v.as_str())
    {
        return Ok(id.to_string());
    }
    if let Some(id) = session
        .get("accounts")
        .and_then(|v| v.as_object())
        .and_then(|o| o.keys().next())
    {
        return Ok(id.clone());
    }
    Err("JMAP session exposes no mail account (no primaryAccounts mail entry, no accounts)".to_string())
}

/// Resolve a mailbox NAME or ROLE (case-insensitive) to its real mailbox id.
pub fn resolve_mailbox_id(list: &[Value], wanted: &str) -> Result<String, String> {
    let wanted_lower = wanted.to_lowercase();
    for mb in list {
        let name = mb.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        let role = mb.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        if let Some(id) = mb.get("id").and_then(|v| v.as_str()) {
            if name == wanted_lower || role == wanted_lower || id == wanted {
                return Ok(id.to_string());
            }
        }
    }
    Err(format!("Mailbox '{}' not found in account", wanted))
}

/// Combine Quota/get and Mailbox/get responses into the quota summary object.
pub fn build_quota_summary(
    quota_raw: Value,
    quota_error: Value,
    mailbox_raw: Value,
    mailbox_error: Value,
) -> Value {
    let mailbox_list = mailbox_raw
        .pointer("/methodResponses/0/1/list")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let quota_list = quota_raw
        .pointer("/methodResponses/0/1/list")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let primary = quota_list.first();

    let used = primary
        .and_then(|q| q.get("used"))
        .cloned()
        .unwrap_or(Value::Null);
    let limit = primary
        .and_then(|q| q.get("hardLimit").or_else(|| q.get("softLimit")))
        .cloned()
        .unwrap_or(Value::Null);

    let sum = |key: &str| -> i64 {
        mailbox_list
            .iter()
            .map(|mb| mb.get(key).and_then(|v| v.as_i64()).unwrap_or(0))
            .sum()
    };

    json!({
        "used": used,
        "limit": limit,
        "quotas": quota_list,
        "mailboxes": {
            "count": mailbox_list.len(),
            "totalEmails": sum("totalEmails"),
            "totalThreads": sum("totalThreads"),
            "unreadEmails": sum("unreadEmails"),
            "unreadThreads": sum("unreadThreads"),
            "list": mailbox_list,
        },
        "raw": {
            "quota": quota_raw,
            "quotaError": quota_error,
            "mailboxes": mailbox_raw,
            "mailboxError": mailbox_error,
        }
    })
}

#[derive(Clone, Debug)]
pub struct JmapClient {
    pub base_url: String,
    pub api_token: String,
    http_client: reqwest::Client,
}

impl JmapClient {
    pub fn new() -> Self {
        let base_url = env::var("AFFINMAIL_JMAP_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8080/jmap".to_string());

        let api_token = match env::var("AFFINMAIL_API_TOKEN") {
            Ok(t) if !t.trim().is_empty() => t,
            _ => {
                eprintln!(
                    "[FATAL] AFFINMAIL_API_TOKEN is required. Set it to a JMAP API token \
                     (sent as Bearer) or to email:password for an HTTP Basic authenticated \
                     local Stalwart account."
                );
                std::process::exit(1);
            }
        };

        Self::with_token(base_url, api_token)
    }

    /// Explicit constructor for tests / embedders.
    pub fn with_token(base_url: impl Into<String>, api_token: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            api_token: api_token.into(),
            http_client: reqwest::Client::new(),
        }
    }

    /// Bearer for API tokens, HTTP Basic when the token contains ':' (email:password).
    fn auth(&self, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.api_token.split_once(':') {
            Some((user, pass)) => rb.basic_auth(user, Some(pass)),
            None => rb.bearer_auth(&self.api_token),
        }
    }

    pub fn session_url(&self) -> String {
        let base = self.base_url.trim_end_matches('/');
        match base.strip_suffix("/jmap") {
            Some(root) => format!("{}/jmap/session", root),
            None => format!("{}/jmap/session", base),
        }
    }

    /// Resolve the mail accountId from the JMAP session document.
    pub async fn account_id(&self) -> Result<String, String> {
        let url = self.session_url();
        let resp = self
            .auth(self.http_client.get(&url))
            .send()
            .await
            .map_err(|e| format!("JMAP session request to {} failed: {}", url, e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("JMAP session {} returned HTTP {}: {}", url, status, body));
        }

        let session: Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse JMAP session JSON: {}", e))?;

        account_id_from_session(&session)
    }

    /// All mailboxes with the properties needed for folder resolution and quota sums.
    pub async fn mailboxes(&self) -> Result<Vec<Value>, String> {
        let payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Mailbox/get",
                    {
                        "properties": [
                            "id", "name", "role", "parentId", "sortOrder",
                            "totalEmails", "totalThreads", "unreadEmails", "unreadThreads"
                        ]
                    },
                    "mailbox_get_1"
                ]
            ]
        });

        let res = self.post_jmap(&payload).await?;
        Ok(res
            .pointer("/methodResponses/0/1/list")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default())
    }

    /// Resolve a mailbox NAME or ROLE (case-insensitive) to its real mailbox id.
    pub async fn mailbox_id(&self, wanted: &str) -> Result<String, String> {
        let list = self.mailboxes().await?;
        resolve_mailbox_id(&list, wanted)
    }

    /// Search emails by query, folder, sender, unread_only, limit, and date range.
    pub async fn search_emails(
        &self,
        query: Option<&str>,
        folder: Option<&str>,
        sender: Option<&str>,
        limit: Option<usize>,
        unread_only: bool,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<Value, String> {
        let max_limit = limit.unwrap_or(20);
        let mut filter = json!({});

        if let Some(q) = query.filter(|s| !s.trim().is_empty()) {
            filter["text"] = json!(q);
        }
        if let Some(f) = folder.filter(|s| !s.trim().is_empty()) {
            filter["inMailbox"] = json!(self.mailbox_id(f).await?);
        }
        if let Some(s) = sender.filter(|s| !s.trim().is_empty()) {
            filter["from"] = json!(s);
        }
        if unread_only {
            filter["hasKeyword"] = json!("$unread");
        }
        if let Some(b) = before.filter(|s| !s.trim().is_empty()) {
            filter["before"] = json!(b);
        }
        if let Some(a) = after.filter(|s| !s.trim().is_empty()) {
            filter["after"] = json!(a);
        }

        let query_payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Email/query",
                    {
                        "filter": filter,
                        "sort": [{ "property": "receivedAt", "isAscending": false }],
                        "limit": max_limit
                    },
                    "call_query_1"
                ]
            ]
        });

        let query_res = self.post_jmap(&query_payload).await?;
        let ids = query_res
            .pointer("/methodResponses/0/1/ids")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if ids.is_empty() {
            return Ok(json!({ "total": 0, "emails": [], "query": query_res }));
        }

        let get_payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Email/get",
                    {
                        "ids": ids,
                        "properties": [
                            "id", "threadId", "mailboxIds", "subject", "from", "to",
                            "receivedAt", "keywords", "preview", "hasAttachment"
                        ]
                    },
                    "call_get_1"
                ]
            ]
        });

        let get_res = self.post_jmap(&get_payload).await?;
        let emails = get_res
            .pointer("/methodResponses/0/1/list")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(json!({ "total": emails.len(), "emails": emails, "query": query_res }))
    }

    /// Read full email content by ID (subject, from, to, cc, date, body_text, body_html, attachments)
    pub async fn read_email(&self, email_id: &str) -> Result<Value, String> {
        let payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Email/get",
                    {
                        "ids": [email_id],
                        "properties": [
                            "id", "threadId", "mailboxIds", "subject", "from", "to", "cc", "bcc",
                            "replyTo", "sentAt", "receivedAt", "keywords", "preview", "hasAttachment",
                            "size", "textBody", "htmlBody", "bodyValues", "attachments"
                        ],
                        "fetchTextBodyValues": true,
                        "fetchHTMLBodyValues": true
                    },
                    "call_read_1"
                ]
            ]
        });

        let res = self.post_jmap(&payload).await?;
        let email = res
            .pointer("/methodResponses/0/1/list/0")
            .cloned()
            .ok_or_else(|| format!("Email '{}' not found", email_id))?;

        // Extract body_text
        let mut body_text = String::new();
        if let Some(parts) = email.get("textBody").and_then(|v| v.as_array()) {
            for part in parts {
                if let Some(part_id) = part.get("partId").and_then(|v| v.as_str()) {
                    if let Some(val) = email.pointer(&format!("/bodyValues/{}/value", part_id)).and_then(|v| v.as_str()) {
                        if !body_text.is_empty() {
                            body_text.push('\n');
                        }
                        body_text.push_str(val);
                    }
                }
            }
        }
        if body_text.is_empty() {
            if let Some(preview) = email.get("preview").and_then(|v| v.as_str()) {
                body_text = preview.to_string();
            }
        }

        // Extract body_html
        let mut body_html = String::new();
        if let Some(parts) = email.get("htmlBody").and_then(|v| v.as_array()) {
            for part in parts {
                if let Some(part_id) = part.get("partId").and_then(|v| v.as_str()) {
                    if let Some(val) = email.pointer(&format!("/bodyValues/{}/value", part_id)).and_then(|v| v.as_str()) {
                        if !body_html.is_empty() {
                            body_html.push('\n');
                        }
                        body_html.push_str(val);
                    }
                }
            }
        }

        // Extract attachments
        let attachments: Vec<Value> = email
            .get("attachments")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|att| {
                        json!({
                            "name": att.get("name").cloned().unwrap_or(json!("unnamed")),
                            "type": att.get("type").cloned().unwrap_or(json!("application/octet-stream")),
                            "size": att.get("size").cloned().unwrap_or(json!(0)),
                            "blobId": att.get("blobId").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let date = email
            .get("receivedAt")
            .or_else(|| email.get("sentAt"))
            .cloned()
            .unwrap_or(Value::Null);

        Ok(json!({
            "id": email.get("id").cloned().unwrap_or(json!(email_id)),
            "thread_id": email.get("threadId").cloned().unwrap_or(Value::Null),
            "subject": email.get("subject").cloned().unwrap_or(json!("")),
            "from": email.get("from").cloned().unwrap_or(json!([])),
            "to": email.get("to").cloned().unwrap_or(json!([])),
            "cc": email.get("cc").cloned().unwrap_or(json!([])),
            "bcc": email.get("bcc").cloned().unwrap_or(json!([])),
            "date": date,
            "preview": email.get("preview").cloned().unwrap_or(json!("")),
            "body_text": body_text,
            "body_html": body_html,
            "attachments": attachments,
            "mailbox_ids": email.get("mailboxIds").cloned().unwrap_or(json!({})),
            "keywords": email.get("keywords").cloned().unwrap_or(json!({})),
        }))
    }

    /// List all mail folders with unread and total counts
    pub async fn list_folders(&self) -> Result<Value, String> {
        let mailboxes = self.mailboxes().await?;
        let folders: Vec<Value> = mailboxes
            .into_iter()
            .map(|mb| {
                json!({
                    "id": mb.get("id").cloned().unwrap_or(Value::Null),
                    "name": mb.get("name").cloned().unwrap_or(json!("")),
                    "role": mb.get("role").cloned().unwrap_or(Value::Null),
                    "total_emails": mb.get("totalEmails").and_then(|v| v.as_i64()).unwrap_or(0),
                    "unread_emails": mb.get("unreadEmails").and_then(|v| v.as_i64()).unwrap_or(0),
                    "total_threads": mb.get("totalThreads").and_then(|v| v.as_i64()).unwrap_or(0),
                    "unread_threads": mb.get("unreadThreads").and_then(|v| v.as_i64()).unwrap_or(0),
                })
            })
            .collect();

        Ok(json!({ "folders": folders }))
    }

    /// Retrieve full email thread by threadId
    pub async fn get_thread(&self, thread_id: &str) -> Result<Value, String> {
        let payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Thread/get",
                    {
                        "ids": [thread_id]
                    },
                    "call_thread_1"
                ]
            ]
        });

        self.post_jmap(&payload).await
    }

    /// Send a new email message via JMAP EmailSubmission
    pub async fn send_email(
        &self,
        to: &[String],
        subject: &str,
        body: &str,
        cc: Option<&[String]>,
        bcc: Option<&[String]>,
    ) -> Result<Value, String> {
        let to_list: Vec<Value> = to.iter().map(|addr| json!({ "email": addr })).collect();
        let cc_list: Vec<Value> = cc
            .unwrap_or(&[])
            .iter()
            .map(|addr| json!({ "email": addr }))
            .collect();
        let bcc_list: Vec<Value> = bcc
            .unwrap_or(&[])
            .iter()
            .map(|addr| json!({ "email": addr }))
            .collect();

        let sent_id = self.mailbox_id("sent").await?;
        let mut mailbox_ids = serde_json::Map::new();
        mailbox_ids.insert(sent_id, json!(true));

        let mut message = json!({
            "to": to_list,
            "cc": cc_list,
            "bcc": bcc_list,
            "subject": subject,
            "bodyValues": {
                "body1": {
                    "value": body,
                    "isTruncated": false
                }
            },
            "textBody": [{ "partId": "body1", "type": "text/plain" }]
        });
        message["mailboxIds"] = Value::Object(mailbox_ids);

        let payload = json!({
            "using": [CORE, MAIL, SUBMISSION],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "create": {
                            "msg_new": message
                        }
                    },
                    "create_msg"
                ],
                [
                    "EmailSubmission/set",
                    {
                        "create": {
                            "sub_1": {
                                "emailId": "#msg_new"
                            }
                        }
                    },
                    "send_msg"
                ]
            ]
        });

        self.post_jmap(&payload).await
    }

    /// Create a new draft or update an existing one in Drafts folder
    pub async fn draft_email(
        &self,
        to: &[String],
        subject: &str,
        body: &str,
        draft_id: Option<&str>,
    ) -> Result<Value, String> {
        let to_list: Vec<Value> = to.iter().map(|addr| json!({ "email": addr })).collect();
        let drafts_id = self.mailbox_id("drafts").await?;

        let mut mailbox_ids = serde_json::Map::new();
        mailbox_ids.insert(drafts_id, json!(true));

        let mut draft = json!({
            "keywords": { "$draft": true },
            "to": to_list,
            "subject": subject,
            "bodyValues": {
                "body1": {
                    "value": body,
                    "isTruncated": false
                }
            },
            "textBody": [{ "partId": "body1", "type": "text/plain" }]
        });
        draft["mailboxIds"] = Value::Object(mailbox_ids);

        let payload = match draft_id {
            Some(id) => json!({
                "using": [CORE, MAIL],
                "methodCalls": [
                    [
                        "Email/set",
                        {
                            "update": { id: draft }
                        },
                        "draft_call"
                    ]
                ]
            }),
            None => json!({
                "using": [CORE, MAIL],
                "methodCalls": [
                    [
                        "Email/set",
                        {
                            "create": { "draft_new": draft }
                        },
                        "draft_call"
                    ]
                ]
            }),
        };

        self.post_jmap(&payload).await
    }

    /// Move email IDs to a target folder
    pub async fn move_emails(&self, email_ids: &[String], target_folder: &str) -> Result<Value, String> {
        let target_id = self.mailbox_id(target_folder).await?;
        let mut mailbox_ids = serde_json::Map::new();
        mailbox_ids.insert(target_id.clone(), json!(true));

        let mut update = serde_json::Map::new();
        for id in email_ids {
            update.insert(id.clone(), json!({
                "mailboxIds": Value::Object(mailbox_ids.clone())
            }));
        }

        let payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "update": Value::Object(update)
                    },
                    "move_emails_call"
                ]
            ]
        });

        let res = self.post_jmap(&payload).await?;
        Ok(json!({
            "target_folder": target_folder,
            "target_mailbox_id": target_id,
            "moved_ids": email_ids,
            "result": res
        }))
    }

    /// Update flags (flag, unflag, read, unread, archive, etc.) on email IDs
    pub async fn flag_emails(
        &self,
        email_ids: &[String],
        action: Option<&str>,
        flagged: Option<bool>,
        read: Option<bool>,
        archive: Option<bool>,
        add_labels: Option<&[String]>,
        remove_labels: Option<&[String]>,
    ) -> Result<Value, String> {
        let mut patch = serde_json::Map::new();

        // 1. Action string
        match action.map(|s| s.to_lowercase()).as_deref() {
            Some("flag") => {
                patch.insert("keywords/$flagged".to_string(), json!(true));
            }
            Some("unflag") => {
                patch.insert("keywords/$flagged".to_string(), json!(null));
            }
            Some("read") => {
                patch.insert("keywords/$seen".to_string(), json!(true));
                patch.insert("keywords/$unread".to_string(), json!(null));
            }
            Some("unread") => {
                patch.insert("keywords/$seen".to_string(), json!(null));
                patch.insert("keywords/$unread".to_string(), json!(true));
            }
            _ => {}
        }

        // 2. Boolean overrides
        if let Some(f) = flagged {
            patch.insert(
                "keywords/$flagged".to_string(),
                if f { json!(true) } else { json!(null) },
            );
        }
        if let Some(r) = read {
            if r {
                patch.insert("keywords/$seen".to_string(), json!(true));
                patch.insert("keywords/$unread".to_string(), json!(null));
            } else {
                patch.insert("keywords/$seen".to_string(), json!(null));
                patch.insert("keywords/$unread".to_string(), json!(true));
            }
        }

        // 3. Custom labels
        if let Some(adds) = add_labels {
            for lbl in adds {
                patch.insert(format!("keywords/{}", lbl), json!(true));
            }
        }
        if let Some(rems) = remove_labels {
            for lbl in rems {
                patch.insert(format!("keywords/{}", lbl), json!(null));
            }
        }

        // 4. Archive handling
        let should_archive = action
            .map(|s| s.eq_ignore_ascii_case("archive"))
            .unwrap_or(false)
            || archive.unwrap_or(false);

        if should_archive {
            let archive_id = self.mailbox_id("archive").await?;
            let mut mb_map = serde_json::Map::new();
            mb_map.insert(archive_id, json!(true));
            patch.insert("mailboxIds".to_string(), Value::Object(mb_map));
        }

        let mut update = serde_json::Map::new();
        for id in email_ids {
            update.insert(id.clone(), Value::Object(patch.clone()));
        }

        let payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "update": Value::Object(update)
                    },
                    "flag_emails_call"
                ]
            ]
        });

        let res = self.post_jmap(&payload).await?;
        Ok(json!({
            "email_ids": email_ids,
            "result": res
        }))
    }

    /// Update labels on every email of a thread (backward-compatible affinmail_update_labels)
    pub async fn update_labels(
        &self,
        thread_id: &str,
        add_labels: Option<&[String]>,
        remove_labels: Option<&[String]>,
    ) -> Result<Value, String> {
        let thread_res = self.get_thread(thread_id).await?;
        let email_ids: Vec<String> = thread_res
            .pointer("/methodResponses/0/1/list/0/emailIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        if email_ids.is_empty() {
            return Err(format!(
                "Thread '{}' not found or contains no emails: {}",
                thread_id, thread_res
            ));
        }

        self.flag_emails(
            &email_ids,
            None,
            None,
            None,
            None,
            add_labels,
            remove_labels,
        )
        .await
    }

    /// List or search contacts across contacts backend or recent email correspondents
    pub async fn list_contacts(
        &self,
        query: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let max_contacts = limit.unwrap_or(50);
        let q_lower = query.map(|q| q.trim().to_lowercase()).filter(|q| !q.is_empty());

        // Attempt ContactCard/query if JMAP contacts capability is present
        let cards_payload = json!({
            "using": [CORE, CONTACTS],
            "methodCalls": [
                [
                    "ContactCard/query",
                    { "limit": max_contacts },
                    "query_contacts"
                ]
            ]
        });

        if let Ok(res) = self.post_jmap(&cards_payload).await {
            let ids = res
                .pointer("/methodResponses/0/1/ids")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            if !ids.is_empty() {
                let get_cards = json!({
                    "using": [CORE, CONTACTS],
                    "methodCalls": [
                        [
                            "ContactCard/get",
                            { "ids": ids, "properties": ["id", "name", "emails"] },
                            "get_contacts"
                        ]
                    ]
                });

                if let Ok(cards_res) = self.post_jmap(&get_cards).await {
                    let list = cards_res
                        .pointer("/methodResponses/0/1/list")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();

                    let mut contacts = Vec::new();
                    for card in list {
                        let name = card
                            .pointer("/name/full")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let email = card
                            .pointer("/emails/0/value")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !email.is_empty() {
                            if let Some(ref q) = q_lower {
                                if !name.to_lowercase().contains(q) && !email.to_lowercase().contains(q) {
                                    continue;
                                }
                            }
                            contacts.push(json!({ "name": name, "email": email }));
                        }
                    }
                    if !contacts.is_empty() {
                        return Ok(json!({ "count": contacts.len(), "contacts": contacts }));
                    }
                }
            }
        }

        // Fallback: extract distinct contacts from recent emails
        let recent = self.search_emails(None, None, None, Some(50), false, None, None).await?;
        let emails = recent
            .get("emails")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut seen = HashSet::new();
        let mut contacts = Vec::new();

        for em in &emails {
            let mut extract = |name: &str, email: &str| -> Option<Value> {
                let email_clean = email.trim().to_lowercase();
                if !email_clean.is_empty() && email_clean.contains('@') && seen.insert(email_clean.clone()) {
                    if let Some(ref q) = q_lower {
                        if !name.to_lowercase().contains(q) && !email_clean.contains(q) {
                            return None;
                        }
                    }
                    Some(json!({
                        "name": name.trim(),
                        "email": email.trim(),
                    }))
                } else {
                    None
                }
            };

            if let Some(from_arr) = em.get("from").and_then(|v| v.as_array()) {
                for f in from_arr {
                    let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let email = f.get("email").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(c) = extract(name, email) {
                        contacts.push(c);
                    }
                }
            }
            if let Some(to_arr) = em.get("to").and_then(|v| v.as_array()) {
                for t in to_arr {
                    let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let email = t.get("email").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(c) = extract(name, email) {
                        contacts.push(c);
                    }
                }
            }
            if contacts.len() >= max_contacts {
                break;
            }
        }

        Ok(json!({ "count": contacts.len(), "contacts": contacts }))
    }

    /// Return total_emails, unread, storage_used_mb, storage_quota_mb, sent_today
    pub async fn get_mailbox_stats(&self) -> Result<Value, String> {
        let quota_summary = self.get_quota().await?;

        let used_bytes = quota_summary.get("used").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let limit_bytes = quota_summary.get("limit").and_then(|v| v.as_f64()).unwrap_or(0.0);

        let storage_used_mb = (used_bytes / (1024.0 * 1024.0) * 100.0).round() / 100.0;
        let storage_quota_mb = (limit_bytes / (1024.0 * 1024.0) * 100.0).round() / 100.0;

        let total_emails = quota_summary
            .pointer("/mailboxes/totalEmails")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let unread = quota_summary
            .pointer("/mailboxes/unreadEmails")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Count sent today
        let mut sent_today: i64 = 0;
        if let Ok(sent_id) = self.mailbox_id("sent").await {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let today_start = start_of_today_iso(now);

            let sent_query = json!({
                "using": [CORE, MAIL],
                "methodCalls": [
                    [
                        "Email/query",
                        {
                            "filter": {
                                "inMailbox": sent_id,
                                "after": today_start
                            },
                            "limit": 1000
                        },
                        "sent_count_query"
                    ]
                ]
            });

            if let Ok(res) = self.post_jmap(&sent_query).await {
                if let Some(ids) = res.pointer("/methodResponses/0/1/ids").and_then(|v| v.as_array()) {
                    sent_today = ids.len() as i64;
                }
            }
        }

        Ok(json!({
            "total_emails": total_emails,
            "unread": unread,
            "storage_used_mb": storage_used_mb,
            "storage_quota_mb": storage_quota_mb,
            "sent_today": sent_today
        }))
    }

    /// Quota/get plus Mailbox/get counts, combined into one object.
    pub async fn get_quota(&self) -> Result<Value, String> {
        let quota_payload = json!({
            "using": [CORE, MAIL, QUOTA],
            "methodCalls": [
                [ "Quota/get", {}, "quota_get_1" ]
            ]
        });

        let quota_res = self.post_jmap(&quota_payload).await;
        let mailbox_payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Mailbox/get",
                    {
                        "properties": [
                            "id", "name", "role",
                            "totalEmails", "totalThreads", "unreadEmails", "unreadThreads"
                        ]
                    },
                    "mailbox_get_1"
                ]
            ]
        });
        let mailbox_res = self.post_jmap(&mailbox_payload).await;

        let (quota_raw, quota_error) = match quota_res {
            Ok(v) => (v, Value::Null),
            Err(e) => (Value::Null, json!(e)),
        };
        let (mailbox_raw, mailbox_error) = match mailbox_res {
            Ok(v) => (v, Value::Null),
            Err(e) => (Value::Null, json!(e)),
        };

        Ok(build_quota_summary(quota_raw, quota_error, mailbox_raw, mailbox_error))
    }

    pub async fn post_jmap(&self, payload: &Value) -> Result<Value, String> {
        let account_id = self.account_id().await?;

        let mut payload = payload.clone();
        if let Some(calls) = payload.get_mut("methodCalls").and_then(|v| v.as_array_mut()) {
            for call in calls.iter_mut() {
                if let Some(args) = call.get_mut(1).and_then(|v| v.as_object_mut()) {
                    args.entry("accountId").or_insert(json!(account_id));
                }
            }
        }

        let response = self
            .auth(self.http_client.post(&self.base_url))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("HTTP request to AffinMail JMAP failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("AffinMail JMAP returned HTTP {}: {}", status, body));
        }

        let json_body: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse JMAP JSON response: {}", e))?;

        Ok(json_body)
    }
}

#[cfg(test)]
mod tests {
    use super::{account_id_from_session, build_quota_summary, resolve_mailbox_id, JmapClient};
    use serde_json::{json, Value};

    fn client(base_url: &str) -> JmapClient {
        JmapClient::with_token(base_url, "user@example.com:secret")
    }

    #[test]
    fn session_url_derives_from_jmap_base() {
        assert_eq!(
            client("http://127.0.0.1:8080/jmap").session_url(),
            "http://127.0.0.1:8080/jmap/session"
        );
        assert_eq!(
            client("https://mail.example.com/jmap/").session_url(),
            "https://mail.example.com/jmap/session"
        );
    }

    #[test]
    fn colon_token_becomes_basic_auth() {
        let c = client("http://127.0.0.1:8080/jmap");
        let rb = c.auth(c.http_client.get("http://127.0.0.1:8080/jmap/session"));
        let req = rb.build().expect("request builds");
        let auth = req.headers().get("authorization").unwrap().to_str().unwrap();
        assert!(auth.starts_with("Basic "), "got {}", auth);
        assert_eq!(auth, "Basic dXNlckBleGFtcGxlLmNvbTpzZWNyZXQ=");
    }

    #[test]
    fn account_id_prefers_primary_mail_account() {
        let session = json!({
            "accounts": {"acct-a": {}, "acct-b": {}},
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "acct-b"}
        });
        assert_eq!(account_id_from_session(&session).unwrap(), "acct-b");
    }

    #[test]
    fn account_id_falls_back_to_first_account() {
        let session = json!({"accounts": {"only": {}}});
        assert_eq!(account_id_from_session(&session).unwrap(), "only");
    }

    #[test]
    fn account_id_errors_without_accounts() {
        assert!(account_id_from_session(&json!({})).is_err());
    }

    #[test]
    fn mailbox_resolution_is_case_insensitive_and_skips_idless_entries() {
        let list = vec![
            json!({"name": "Inbox", "role": "inbox"}),
            json!({"id": "mb-1", "name": "Archive", "role": "archive"}),
        ];
        assert_eq!(resolve_mailbox_id(&list, "ARCHIVE").unwrap(), "mb-1");
        assert_eq!(resolve_mailbox_id(&list, "archive").unwrap(), "mb-1");
        assert!(resolve_mailbox_id(&list, "trash").is_err());
    }

    #[test]
    fn quota_summary_handles_missing_and_error_payloads() {
        let summary = build_quota_summary(
            Value::Null,
            json!("quota down"),
            Value::Null,
            json!("mailbox down"),
        );
        assert_eq!(summary["used"], Value::Null);
        assert_eq!(summary["limit"], Value::Null);
        assert_eq!(summary["mailboxes"]["count"], json!(0));
        assert_eq!(summary["raw"]["quotaError"], json!("quota down"));
    }

    #[test]
    fn quota_summary_falls_back_to_soft_limit() {
        let quota = json!({"methodResponses": [["Quota/get", {"list": [{"used": 5, "softLimit": 50}]}, "q"]]});
        let mailboxes = json!({"methodResponses": [["Mailbox/get", {"list": [{"totalEmails": 2}]}, "m"]]});
        let summary = build_quota_summary(quota, Value::Null, mailboxes, Value::Null);
        assert_eq!(summary["limit"], json!(50));
        assert_eq!(summary["mailboxes"]["totalEmails"], json!(2));
    }
}
