use serde_json::{json, Value};
use std::env;

#[derive(Clone, Debug)]
pub struct JmapClient {
    pub base_url: String,
    pub api_token: String,
    http_client: reqwest::Client,
}

impl JmapClient {
    pub fn new() -> Self {
        let base_url = env::var("AFFINMAIL_JMAP_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8080/jmap/api".to_string());
        let api_token = env::var("AFFINMAIL_API_TOKEN")
            .unwrap_or_else(|_| "aff_demo_token_user102".to_string());

        Self {
            base_url,
            api_token,
            http_client: reqwest::Client::new(),
        }
    }

    /// Search emails by keyword, mailbox folder, and unread status
    pub async fn search_emails(
        &self,
        query: &str,
        folder: Option<&str>,
        limit: Option<usize>,
        unread_only: bool,
    ) -> Result<Value, String> {
        let max_limit = limit.unwrap_or(20);
        let mut filter = json!({
            "text": query
        });

        if let Some(f) = folder {
            filter["inMailbox"] = json!(f);
        }
        if unread_only {
            filter["hasKeyword"] = json!("$unread");
        }

        let payload = json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
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

        self.post_jmap(&payload).await
    }

    /// Retrieve full email thread by threadId
    pub async fn get_thread(&self, thread_id: &str) -> Result<Value, String> {
        let payload = json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
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

    /// Send a new email message
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

        let payload = json!({
            "using": [
                "urn:ietf:params:jmap:core",
                "urn:ietf:params:jmap:mail",
                "urn:ietf:params:jmap:submission"
            ],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "create": {
                            "msg_new": {
                                "mailboxIds": { "sent": true },
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
                            }
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

    /// Create or update a draft
    pub async fn draft_email(
        &self,
        to: &[String],
        subject: &str,
        body: &str,
        draft_id: Option<&str>,
    ) -> Result<Value, String> {
        let to_list: Vec<Value> = to.iter().map(|addr| json!({ "email": addr })).collect();
        let target_id = draft_id.unwrap_or("draft_new");

        let payload = json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "create": {
                            target_id: {
                                "mailboxIds": { "drafts": true },
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
                            }
                        }
                    },
                    "draft_call"
                ]
            ]
        });

        self.post_jmap(&payload).await
    }

    /// Update labels on thread (star, archive, trash, mark spam)
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

        let payload = json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
            "methodCalls": [
                [
                    "Email/set",
                    {
                        "update": {
                            thread_id: patch
                        }
                    },
                    "update_labels_call"
                ]
            ]
        });

        self.post_jmap(&payload).await
    }

    /// Query current mailbox quota usage and plan limits
    pub async fn get_quota(&self) -> Result<Value, String> {
        let payload = json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
            "methodCalls": [
                [
                    "Mailbox/query",
                    {},
                    "quota_call"
                ]
            ]
        });

        self.post_jmap(&payload).await
    }

    async fn post_jmap(&self, payload: &Value) -> Result<Value, String> {
        let response = self
            .http_client
            .post(&self.base_url)
            .header("Authorization", format!("Bearer {}", self.api_token))
            .header("Content-Type", "application/json")
            .json(payload)
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
