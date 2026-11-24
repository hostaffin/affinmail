use crate::auth::ScopeChecker;
use crate::jmap::JmapClient;
use crate::types::{ReadResourceResult, Resource, ResourceContent};

pub fn list_resources() -> Vec<Resource> {
    vec![
        Resource {
            uri: "mailbox://inbox/recent".to_string(),
            name: "Recent Inbox Emails".to_string(),
            description: "Last 20 emails in the user inbox".to_string(),
            mime_type: "application/json".to_string(),
        },
        Resource {
            uri: "mailbox://stats".to_string(),
            name: "Mailbox Statistics".to_string(),
            description: "Current mailbox statistics including email counts and storage usage".to_string(),
            mime_type: "application/json".to_string(),
        },
        Resource {
            uri: "mailbox://folders".to_string(),
            name: "Mailbox Folders".to_string(),
            description: "Mailbox folder structure with unread and total email counts".to_string(),
            mime_type: "application/json".to_string(),
        },
    ]
}

pub async fn handle_read_resource(
    uri: &str,
    client: &JmapClient,
    scopes: &ScopeChecker,
) -> Result<ReadResourceResult, String> {
    scopes.require_scope("mcp:read")?;

    match uri {
        "mailbox://inbox/recent" => {
            let res = client
                .search_emails(None, Some("inbox"), None, Some(20), false, None, None)
                .await?;
            Ok(ReadResourceResult {
                contents: vec![ResourceContent {
                    uri: uri.to_string(),
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()),
                }],
            })
        }
        "mailbox://stats" => {
            let res = client.get_mailbox_stats().await?;
            Ok(ReadResourceResult {
                contents: vec![ResourceContent {
                    uri: uri.to_string(),
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()),
                }],
            })
        }
        "mailbox://folders" => {
            let res = client.list_folders().await?;
            Ok(ReadResourceResult {
                contents: vec![ResourceContent {
                    uri: uri.to_string(),
                    mime_type: "application/json".to_string(),
                    text: serde_json::to_string_pretty(&res).unwrap_or_else(|_| res.to_string()),
                }],
            })
        }
        unknown => Err(format!("Resource not found: {}", unknown)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_resources() {
        let list = list_resources();
        assert_eq!(list.len(), 3);
        assert!(list.iter().any(|r| r.uri == "mailbox://inbox/recent"));
        assert!(list.iter().any(|r| r.uri == "mailbox://stats"));
        assert!(list.iter().any(|r| r.uri == "mailbox://folders"));
    }
}
