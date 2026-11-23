use crate::jmap::JmapClient;
use crate::types::{CallToolResult, Tool};
use serde_json::{json, Value};

pub fn list_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "affinmail_search_emails".to_string(),
            description: "Search emails across AffinMail user mailbox by keyword, folder, or unread status via JMAP."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keywords, sender email, or subject line to search for"
                    },
                    "folder": {
                        "type": "string",
                        "description": "Optional mailbox folder name (e.g. 'inbox', 'sent', 'drafts', 'archive')"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of messages to return (default: 20)"
                    },
                    "unread_only": {
                        "type": "boolean",
                        "description": "If true, only return unread emails"
                    }
                },
                "required": ["query"]
            }),
        },
        Tool {
            name: "affinmail_get_thread".to_string(),
            description: "Retrieve full email conversation thread and message contents by threadId."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The unique thread ID (e.g. 'th_1092a')"
                    }
                },
                "required": ["thread_id"]
            }),
        },
        Tool {
            name: "affinmail_send_email".to_string(),
            description: "Send an outbound email message via AffinMail JMAP submission."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "to": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "List of recipient email addresses"
                    },
                    "subject": {
                        "type": "string",
                        "description": "Subject line of the email"
                    },
                    "body": {
                        "type": "string",
                        "description": "Plain text or HTML body content"
                    },
                    "cc": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional CC recipient email addresses"
                    },
                    "bcc": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional BCC recipient email addresses"
                    }
                },
                "required": ["to", "subject", "body"]
            }),
        },
        Tool {
            name: "affinmail_draft_email".to_string(),
            description: "Create or update an editable draft inside the user's Drafts folder."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "to": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "List of recipient email addresses"
                    },
                    "subject": {
                        "type": "string",
                        "description": "Draft subject line"
                    },
                    "body": {
                        "type": "string",
                        "description": "Draft body text"
                    },
                    "draft_id": {
                        "type": "string",
                        "description": "Optional existing draft ID to overwrite"
                    }
                },
                "required": ["to", "subject", "body"]
            }),
        },
        Tool {
            name: "affinmail_update_labels".to_string(),
            description: "Update labels or flags on an email (star, unstar, archive, mark spam, move to trash)."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The target email or thread ID"
                    },
                    "add_labels": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Labels to add (e.g. ['$flagged', '$seen'])"
                    },
                    "remove_labels": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Labels to remove"
                    }
                },
                "required": ["thread_id"]
            }),
        },
        Tool {
            name: "affinmail_get_quota".to_string(),
            description: "Get the current user's mailbox quota consumption, byte limits, and allocated egress IP."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
    ]
}

pub async fn handle_tool_call(
    name: &str,
    arguments: &Value,
    client: &JmapClient,
) -> CallToolResult {
    match name {
        "affinmail_search_emails" => {
            let query = arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let folder = arguments.get("folder").and_then(|v| v.as_str());
            let limit = arguments.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);
            let unread_only = arguments
                .get("unread_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            match client.search_emails(query, folder, limit, unread_only).await {
                Ok(res) => CallToolResult::text(res.to_string()),
                Err(err) => CallToolResult::error(err),
            }
        }
        "affinmail_get_thread" => {
            let thread_id = match arguments.get("thread_id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return CallToolResult::error("Missing required parameter 'thread_id'"),
            };

            match client.get_thread(thread_id).await {
                Ok(res) => CallToolResult::text(res.to_string()),
                Err(err) => CallToolResult::error(err),
            }
        }
        "affinmail_send_email" => {
            let to: Vec<String> = arguments
                .get("to")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let subject = arguments
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let body = arguments
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let cc: Option<Vec<String>> = arguments.get("cc").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            });
            let bcc: Option<Vec<String>> = arguments.get("bcc").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            });

            match client
                .send_email(&to, subject, body, cc.as_deref(), bcc.as_deref())
                .await
            {
                Ok(res) => CallToolResult::text(res.to_string()),
                Err(err) => CallToolResult::error(err),
            }
        }
        "affinmail_draft_email" => {
            let to: Vec<String> = arguments
                .get("to")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let subject = arguments
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let body = arguments
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let draft_id = arguments.get("draft_id").and_then(|v| v.as_str());

            match client.draft_email(&to, subject, body, draft_id).await {
                Ok(res) => CallToolResult::text(res.to_string()),
                Err(err) => CallToolResult::error(err),
            }
        }
        "affinmail_update_labels" => {
            let thread_id = match arguments.get("thread_id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return CallToolResult::error("Missing required parameter 'thread_id'"),
            };

            let add_labels: Option<Vec<String>> =
                arguments.get("add_labels").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect()
                });
            let remove_labels: Option<Vec<String>> =
                arguments.get("remove_labels").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect()
                });

            match client
                .update_labels(thread_id, add_labels.as_deref(), remove_labels.as_deref())
                .await
            {
                Ok(res) => CallToolResult::text(res.to_string()),
                Err(err) => CallToolResult::error(err),
            }
        }
        "affinmail_get_quota" => match client.get_quota().await {
            Ok(res) => CallToolResult::text(res.to_string()),
            Err(err) => CallToolResult::error(err),
        },
        unknown => CallToolResult::error(format!("Unknown AffinMail tool: {}", unknown)),
    }
}
