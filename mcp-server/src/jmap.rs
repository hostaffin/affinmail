use serde_json::{json, Value};
use std::env;

const CORE: &str = "urn:ietf:params:jmap:core";
const MAIL: &str = "urn:ietf:params:jmap:mail";
const QUOTA: &str = "urn:ietf:params:jmap:quota";

/// Pick the JMAP mail account id from a session document.
fn account_id_from_session(session: &Value) -> Result<String, String> {
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
fn resolve_mailbox_id(list: &[Value], wanted: &str) -> Result<String, String> {
    let wanted = wanted.to_lowercase();
    for mb in list {
        let name = mb.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        let role = mb.get("role").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        if let Some(id) = mb.get("id").and_then(|v| v.as_str()) {
            if name == wanted || role == wanted {
                return Ok(id.to_string());
            }
        }
    }
    Err(format!("Mailbox '{}' not found in account", wanted))
}

/// Combine Quota/get and Mailbox/get responses into the tool's summary object.
fn build_quota_summary(
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

    fn session_url(&self) -> String {
        let base = self.base_url.trim_end_matches('/');
        match base.strip_suffix("/jmap") {
            Some(root) => format!("{}/jmap/session", root),
            None => format!("{}/jmap/session", base),
        }
    }

    /// Resolve the mail accountId from the JMAP session document.
    async fn account_id(&self) -> Result<String, String> {
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
    async fn mailboxes(&self) -> Result<Vec<Value>, String> {
        let payload = json!({
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

    /// Search emails by keyword, mailbox folder, and unread status.
    pub async fn search_emails(
        &self,
        query: &str,
        folder: Option<&str>,
        limit: Option<usize>,
        unread_only: bool,
    ) -> Result<Value, String> {
        let max_limit = limit.unwrap_or(20);
        let mut filter = json!({});
        if !query.trim().is_empty() {
            filter["text"] = json!(query);
        }

        if let Some(f) = folder {
            filter["inMailbox"] = json!(self.mailbox_id(f).await?);
        }
        if unread_only {
            filter["hasKeyword"] = json!("$unread");
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
                            "id", "threadId", "subject", "from",
                            "receivedAt", "keywords", "preview"
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

    /// Send a new email message (submission flow kept, real Sent mailbox id used)
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
            "using": [CORE, MAIL, "urn:ietf:params:jmap:submission"],
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

    /// Create a new draft or update an existing one (Email/set "update" keyed by draft_id)
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

    /// Update labels on every email of a thread (thread_id is never an Email/set key)
    pub async fn update_labels(
        &self,
        thread_id: &str,
        add_labels: Option<&[String]>,
        remove_labels: Option<&[String]>,
    ) -> Result<Value, String> {
        let mut patch = json!({});

        if let Some(adds) = add_labels {
            for lbl in adds {
                patch[format!("keywords/{}", lbl)] = json!(true);
            }
        }
        if let Some(removes) = remove_labels {
            for lbl in removes {
                patch[format!("keywords/{}", lbl)] = json!(null);
            }
        }

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

        let mut update = serde_json::Map::new();
        for id in &email_ids {
            update.insert(id.clone(), patch.clone());
        }

        let payload = json!({
            "using": [CORE, MAIL],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "update": Value::Object(update)
                    },
                    "update_labels_call"
                ]
            ]
        });

        let res = self.post_jmap(&payload).await?;
        Ok(json!({
            "threadId": thread_id,
            "emailIds": email_ids,
            "update": res
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

    async fn post_jmap(&self, payload: &Value) -> Result<Value, String> {
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
