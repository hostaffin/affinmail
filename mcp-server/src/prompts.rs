use crate::auth::ScopeChecker;
use crate::jmap::JmapClient;
use crate::types::{GetPromptResult, Prompt, PromptArgument, PromptMessage, PromptMessageContent};
use serde_json::Value;

pub fn list_prompts() -> Vec<Prompt> {
    vec![
        Prompt {
            name: "summarize_inbox".to_string(),
            description: "Summarize recent emails from the inbox and identify key topics and urgent messages.".to_string(),
            arguments: Some(vec![PromptArgument {
                name: "limit".to_string(),
                description: "Number of recent emails to summarize (default: 20)".to_string(),
                required: false,
            }]),
        },
        Prompt {
            name: "draft_reply".to_string(),
            description: "Draft a context-aware professional reply to a specific email by ID.".to_string(),
            arguments: Some(vec![
                PromptArgument {
                    name: "email_id".to_string(),
                    description: "The unique ID of the email to reply to".to_string(),
                    required: true,
                },
                PromptArgument {
                    name: "instructions".to_string(),
                    description: "Optional user guidance on tone, intent, or specific details to include".to_string(),
                    required: false,
                },
            ]),
        },
        Prompt {
            name: "find_action_items".to_string(),
            description: "Scan recent emails to extract actionable tasks, commitments, and deadlines.".to_string(),
            arguments: Some(vec![PromptArgument {
                name: "limit".to_string(),
                description: "Number of recent emails to scan (default: 20)".to_string(),
                required: false,
            }]),
        },
    ]
}

pub async fn handle_get_prompt(
    name: &str,
    arguments: &Value,
    client: &JmapClient,
    scopes: &ScopeChecker,
) -> Result<GetPromptResult, String> {
    scopes.require_scope("mcp:read")?;

    match name {
        "summarize_inbox" => {
            let limit = arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(20);

            let res = client
                .search_emails(None, Some("inbox"), None, Some(limit), false, None, None)
                .await?;

            let emails = res
                .get("emails")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let mut formatted = String::new();
            for (idx, em) in emails.iter().enumerate() {
                let subject = em.get("subject").and_then(|v| v.as_str()).unwrap_or("(No Subject)");
                let from = em
                    .pointer("/from/0/name")
                    .and_then(|v| v.as_str())
                    .or_else(|| em.pointer("/from/0/email").and_then(|v| v.as_str()))
                    .unwrap_or("Unknown Sender");
                let date = em.get("receivedAt").and_then(|v| v.as_str()).unwrap_or("");
                let preview = em.get("preview").and_then(|v| v.as_str()).unwrap_or("");

                formatted.push_str(&format!(
                    "{}. From: {} | Subject: \"{}\" | Date: {}\n   Preview: {}\n\n",
                    idx + 1,
                    from,
                    subject,
                    date,
                    preview
                ));
            }

            if formatted.is_empty() {
                formatted = "No emails found in Inbox.".to_string();
            }

            let prompt_text = format!(
                "You are an AI email assistant for AffinMail.\n\
                 Below are the recent emails from the user's Inbox:\n\n\
                 {}\n\
                 Please provide:\n\
                 1. Executive Summary: High-level overview of active discussions.\n\
                 2. Urgent & Action Items: Messages requiring immediate replies or action.\n\
                 3. Informational: Newsletters, receipts, or low-priority notices.",
                formatted
            );

            Ok(GetPromptResult {
                description: Some("Summarize recent inbox messages".to_string()),
                messages: vec![PromptMessage {
                    role: "user",
                    content: PromptMessageContent {
                        content_type: "text",
                        text: prompt_text,
                    },
                }],
            })
        }
        "draft_reply" => {
            let email_id = arguments
                .get("email_id")
                .or_else(|| arguments.get("id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing required parameter 'email_id'".to_string())?;

            let instructions = arguments
                .get("instructions")
                .or_else(|| arguments.get("guidance"))
                .and_then(|v| v.as_str())
                .unwrap_or("Draft a polite, professional reply.");

            let email = client.read_email(email_id).await?;

            let subject = email.get("subject").and_then(|v| v.as_str()).unwrap_or("");
            let from = email.get("from").cloned().unwrap_or(Value::Null);
            let date = email.get("date").and_then(|v| v.as_str()).unwrap_or("");
            let body_text = email.get("body_text").and_then(|v| v.as_str()).unwrap_or("");

            let prompt_text = format!(
                "You are an AI email assistant for AffinMail.\n\
                 Please draft a context-aware reply to the following email:\n\n\
                 Subject: {}\n\
                 From: {}\n\
                 Date: {}\n\
                 Message Body:\n\
                 {}\n\n\
                 User Guidance / Instructions:\n\
                 {}\n\n\
                 Provide the drafted reply with subject line (e.g. Re: ...) and body text.",
                subject, from, date, body_text, instructions
            );

            Ok(GetPromptResult {
                description: Some(format!("Draft reply to email '{}'", email_id)),
                messages: vec![PromptMessage {
                    role: "user",
                    content: PromptMessageContent {
                        content_type: "text",
                        text: prompt_text,
                    },
                }],
            })
        }
        "find_action_items" => {
            let limit = arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(20);

            let res = client
                .search_emails(None, Some("inbox"), None, Some(limit), false, None, None)
                .await?;

            let emails = res
                .get("emails")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let mut formatted = String::new();
            for (idx, em) in emails.iter().enumerate() {
                let id = em.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let subject = em.get("subject").and_then(|v| v.as_str()).unwrap_or("(No Subject)");
                let from = em
                    .pointer("/from/0/name")
                    .and_then(|v| v.as_str())
                    .or_else(|| em.pointer("/from/0/email").and_then(|v| v.as_str()))
                    .unwrap_or("Unknown");
                let preview = em.get("preview").and_then(|v| v.as_str()).unwrap_or("");

                formatted.push_str(&format!(
                    "[{}] Email ID: {} | From: {} | Subject: \"{}\"\nPreview: {}\n\n",
                    idx + 1,
                    id,
                    from,
                    subject,
                    preview
                ));
            }

            let prompt_text = format!(
                "You are an AI assistant analyzing recent emails for action items.\n\
                 Here are the recent emails:\n\n\
                 {}\n\
                 Extract all concrete action items, requests, commitments, and deadlines.\n\
                 For each item, format as:\n\
                 - [ ] Task Description\n\
                   - Assignee / Requester:\n\
                   - Deadline (if mentioned):\n\
                   - Source Email ID & Subject:",
                formatted
            );

            Ok(GetPromptResult {
                description: Some("Extract action items and deadlines".to_string()),
                messages: vec![PromptMessage {
                    role: "user",
                    content: PromptMessageContent {
                        content_type: "text",
                        text: prompt_text,
                    },
                }],
            })
        }
        unknown => Err(format!("Prompt not found: {}", unknown)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_prompts() {
        let list = list_prompts();
        assert_eq!(list.len(), 3);
        assert!(list.iter().any(|p| p.name == "summarize_inbox"));
        assert!(list.iter().any(|p| p.name == "draft_reply"));
        assert!(list.iter().any(|p| p.name == "find_action_items"));
    }
}
