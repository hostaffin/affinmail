use crate::admin::{AdminClient, AdminResponse};
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
        Tool {
            name: "admin_get_system_health".to_string(),
            description: "Admin: read system health (postgres, redis, stalwart daemon checks) from the AffinMail admin API."
                .to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        Tool {
            name: "admin_create_domain".to_string(),
            description: "Admin: provision a new mail domain (generates DKIM keys, assigns storage quota)."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "domain": { "type": "string", "description": "Fully qualified domain name (e.g. 'company.com')" },
                    "storage_quota_mb": { "type": "integer", "description": "Total domain disk quota in MB (maps to diskQuotaMb)" },
                    "max_mailboxes": { "type": "integer", "description": "Maximum number of mailboxes allowed on the domain" },
                    "max_attachment_mb": { "type": "integer", "description": "Maximum attachment size in MB" }
                },
                "required": ["domain", "storage_quota_mb"]
            }),
        },
        Tool {
            name: "admin_provision_mailbox".to_string(),
            description: "Admin: create a mailbox under an existing domain with quota and initial password."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "email": { "type": "string", "description": "Full email address (e.g. 'alice@company.com')" },
                    "display_name": { "type": "string", "description": "User full name" },
                    "quota_mb": { "type": "integer", "description": "Mailbox quota in MB (maps to quotaLimitMb)" },
                    "password": { "type": "string", "description": "Initial mailbox password (8-256 chars)" }
                },
                "required": ["email", "quota_mb", "password"]
            }),
        },
        Tool {
            name: "admin_assign_egress_ip".to_string(),
            description: "Admin: bind a domain to an egress IP from the configured pool."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "domain": { "type": "string", "description": "Domain to route" },
                    "ip_address": { "type": "string", "description": "IPv4/IPv6 address from the IP pool" }
                },
                "required": ["domain", "ip_address"]
            }),
        },
        Tool {
            name: "admin_check_ip_reputation".to_string(),
            description: "Admin: report IP reputation computed ONLY from locally stored pool data (reputation_score, blacklist flag, allocations). No external DNSBL or network lookups."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "ip_address": { "type": "string", "description": "Optional single IP to report on; omit for all pooled IPs" }
                }
            }),
        },
        Tool {
            name: "admin_switch_storage_tier".to_string(),
            description: "Admin: switch the blob storage backend tier (e.g. 'fs', 's3', 'sftp')."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tier": { "type": "string", "description": "Target storage tier, e.g. 'fs', 's3', 'sftp'" }
                },
                "required": ["tier"]
            }),
        },
        Tool {
            name: "admin_trigger_auto_repair".to_string(),
            description: "Admin: run automated repair. Falls back to a service restart when the auto-repair endpoint is unavailable (noted in the result)."
                .to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        Tool {
            name: "admin_create_backup".to_string(),
            description: "Admin: trigger a compressed PostgreSQL + config backup snapshot."
                .to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
    ]
}

fn ok_text(res: AdminResponse) -> CallToolResult {
    CallToolResult::text(
        serde_json::to_string(&res.body).unwrap_or_else(|_| res.body.to_string()),
    )
}

fn admin_fail(action: &str, res: AdminResponse) -> CallToolResult {
    CallToolResult::error(res.error_text(action))
}

fn opt_string(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn opt_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| v.as_u64())
}

pub async fn handle_tool_call(
    name: &str,
    arguments: &Value,
    client: &JmapClient,
    admin: &AdminClient,
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
        "admin_get_system_health" => match admin.get("/health").await {
            Ok(res) if res.is_success() => ok_text(res),
            Ok(res) => admin_fail("admin_get_system_health", res),
            Err(err) => CallToolResult::error(err),
        },
        "admin_create_domain" => {
            let domain = match opt_string(arguments, "domain") {
                Some(d) => d,
                None => return CallToolResult::error("Missing required parameter 'domain'"),
            };
            let mut body = json!({ "domain": domain });
            if let Some(q) = opt_u64(arguments, "storage_quota_mb") {
                body["diskQuotaMb"] = json!(q);
            }
            if let Some(m) = opt_u64(arguments, "max_mailboxes") {
                body["maxMailboxes"] = json!(m);
            }
            if let Some(a) = opt_u64(arguments, "max_attachment_mb") {
                body["maxAttachmentMb"] = json!(a);
            }

            match admin.post("/domains", body).await {
                Ok(res) if res.is_success() => ok_text(res),
                Ok(res) => admin_fail("admin_create_domain", res),
                Err(err) => CallToolResult::error(err),
            }
        }
        "admin_provision_mailbox" => {
            let email = match opt_string(arguments, "email") {
                Some(e) => e,
                None => return CallToolResult::error("Missing required parameter 'email'"),
            };
            let password = match opt_string(arguments, "password") {
                Some(p) => p,
                None => return CallToolResult::error("Missing required parameter 'password'"),
            };
            let quota = match opt_u64(arguments, "quota_mb") {
                Some(q) => q,
                None => return CallToolResult::error("Missing required parameter 'quota_mb'"),
            };

            let mut body = json!({
                "email": email,
                "password": password,
                "quotaLimitMb": quota
            });
            if let Some(name) = opt_string(arguments, "display_name") {
                body["displayName"] = json!(name);
            }

            match admin.post("/mailboxes", body).await {
                Ok(res) if res.is_success() => ok_text(res),
                Ok(res) => admin_fail("admin_provision_mailbox", res),
                Err(err) => CallToolResult::error(err),
            }
        }
        "admin_assign_egress_ip" => {
            let domain = match opt_string(arguments, "domain") {
                Some(d) => d,
                None => return CallToolResult::error("Missing required parameter 'domain'"),
            };
            let ip = match opt_string(arguments, "ip_address") {
                Some(i) => i,
                None => return CallToolResult::error("Missing required parameter 'ip_address'"),
            };

            match admin
                .post("/ippools/assign", json!({ "domain": domain, "ip_address": ip }))
                .await
            {
                Ok(res) if res.is_success() => ok_text(res),
                Ok(res) => admin_fail("admin_assign_egress_ip", res),
                Err(err) => CallToolResult::error(err),
            }
        }
        "admin_check_ip_reputation" => {
            let filter = opt_string(arguments, "ip_address");
            match admin.get("/ip-pools").await {
                Ok(res) if res.is_success() => {
                    let pools = res
                        .body
                        .get("ipPools")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();

                    let reports: Vec<Value> = pools
                        .iter()
                        .filter(|p| match &filter {
                            Some(ip) => p.get("ip_address").and_then(|v| v.as_str()) == Some(ip.as_str()),
                            None => true,
                        })
                        .map(local_reputation)
                        .collect();

                    let out = json!({
                        "source": "local_stored_data",
                        "note": "Computed only from locally stored ip_pools records. No DNSBL, PTR, or network lookups were performed.",
                        "count": reports.len(),
                        "ips": reports,
                        "raw": res.body,
                    });
                    CallToolResult::text(out.to_string())
                }
                Ok(res) => admin_fail("admin_check_ip_reputation", res),
                Err(err) => CallToolResult::error(err),
            }
        }
        "admin_switch_storage_tier" => {
            let tier = match opt_string(arguments, "tier") {
                Some(t) => t,
                None => return CallToolResult::error("Missing required parameter 'tier'"),
            };

            match admin.post("/storage/switch", json!({ "tier": tier })).await {
                Ok(res) if res.is_success() => ok_text(res),
                Ok(res) => admin_fail("admin_switch_storage_tier", res),
                Err(err) => CallToolResult::error(err),
            }
        }
        "admin_trigger_auto_repair" => match admin.post("/system/auto-repair", json!({})).await {
            Ok(res) if res.is_success() => ok_text(res),
            Ok(res) if res.status == 404 => match admin.post("/system/restart", json!({})).await {
                Ok(restart) if restart.is_success() => CallToolResult::text(
                    json!({
                        "autoRepair": "unavailable",
                        "fallback": "POST /system/restart",
                        "note": "auto-repair endpoint returned 404; service restart was triggered instead",
                        "result": restart.body,
                    })
                    .to_string(),
                ),
                Ok(restart) => CallToolResult::error(format!(
                    "auto-repair unavailable (404) and fallback restart failed: {}",
                    restart.error_text("admin_trigger_auto_repair fallback /system/restart")
                )),
                Err(err) => CallToolResult::error(err),
            },
            Ok(res) => admin_fail("admin_trigger_auto_repair", res),
            Err(err) => CallToolResult::error(err),
        },
        "admin_create_backup" => match admin.post("/system/backup", json!({})).await {
            Ok(res) if res.is_success() => ok_text(res),
            Ok(res) => admin_fail("admin_create_backup", res),
            Err(err) => CallToolResult::error(err),
        },
        unknown => CallToolResult::error(format!("Unknown AffinMail tool: {}", unknown)),
    }
}

fn local_reputation(pool: &Value) -> Value {
    let ip = pool.get("ip_address").and_then(|v| v.as_str()).unwrap_or("unknown");
    let score = pool.get("reputation_score").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let blacklisted = pool
        .get("is_blacklisted")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let active = pool.get("is_active").and_then(|v| v.as_bool()).unwrap_or(false);
    let current = pool
        .get("current_allocations")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let max = pool.get("max_allocations").and_then(|v| v.as_i64()).unwrap_or(0);
    let saturation = if max > 0 {
        (current as f64 / max as f64 * 100.0).round()
    } else {
        0.0
    };

    let grade = if blacklisted || !active {
        "critical"
    } else if score >= 90.0 {
        "good"
    } else if score >= 70.0 {
        "fair"
    } else {
        "poor"
    };

    json!({
        "ip_address": ip,
        "reputation_score": score,
        "is_blacklisted": blacklisted,
        "is_active": active,
        "pool_type": pool.get("pool_type").cloned().unwrap_or(Value::Null),
        "rdns_hostname": pool.get("rdns_hostname").cloned().unwrap_or(Value::Null),
        "current_allocations": current,
        "max_allocations": max,
        "allocation_saturation_pct": saturation,
        "grade": grade,
    })
}

#[cfg(test)]
mod tests {
    use super::list_tools;
    use std::collections::HashSet;

    #[test]
    fn list_tools_is_complete_and_valid() {
        let tools = list_tools();
        assert!(tools.len() >= 14, "expected >= 14 tools, got {}", tools.len());

        let mut seen = HashSet::new();
        for tool in &tools {
            assert!(!tool.name.is_empty(), "tool with empty name");
            assert!(seen.insert(tool.name.clone()), "duplicate tool name: {}", tool.name);
            assert!(!tool.description.trim().is_empty(), "{} has no description", tool.name);
            assert_eq!(
                tool.input_schema.get("type").and_then(|v| v.as_str()),
                Some("object"),
                "{} input_schema is not type object",
                tool.name
            );
        }

        assert!(
            tools.iter().any(|t| t.name == "affinmail_search_emails"),
            "affinmail_search_emails tool missing"
        );
    }
}
