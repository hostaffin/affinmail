//! End-to-end tests for the real JMAP client against a canned local HTTP mock.
//! Only std TcpListener — no external network, no mail ever leaves the box.

use affinmail_mcp_server::admin::AdminClient;
use affinmail_mcp_server::auth::{AuditLogger, ScopeChecker};
use affinmail_mcp_server::jmap::JmapClient;
use affinmail_mcp_server::prompts;
use affinmail_mcp_server::resources;
use affinmail_mcp_server::tools;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

const SESSION: &str = r#"{
  "capabilities": {"urn:ietf:params:jmap:core": {}},
  "accounts": {
    "acct-1": {"name": "alice@affinmail.local", "isPersonal": true}
  },
  "primaryAccounts": {"urn:ietf:params:jmap:mail": "acct-1"}
}"#;

fn write_response(stream: &mut TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn handle_connection(mut stream: TcpStream) -> Option<()> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).ok()?;
    if request_line.is_empty() {
        return None;
    }
    let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("content-length: ").or_else(|| line.strip_prefix("Content-Length: ")) {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).ok()?;
    }

    if path.ends_with("/session") {
        write_response(&mut stream, SESSION);
        return Some(());
    }

    let payload: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let mut responses = Vec::new();

    if let Some(calls) = payload.get("methodCalls").and_then(|v| v.as_array()) {
        for call in calls {
            let method = call.get(0).and_then(|v| v.as_str()).unwrap_or("");
            let call_id = call.get(2).cloned().unwrap_or(json!("call_1"));
            let res_body = match method {
                "Quota/get" => json!({
                    "accountId": "acct-1",
                    "list": [
                        {"id": "q1", "used": 1048576, "hardLimit": 1073741824, "softLimit": 1073741824}
                    ]
                }),
                "Mailbox/get" => json!({
                    "accountId": "acct-1",
                    "list": [
                        {"id": "mb-inbox", "name": "Inbox", "role": "inbox",
                         "totalEmails": 4, "totalThreads": 3, "unreadEmails": 2, "unreadThreads": 2},
                        {"id": "mb-sent", "name": "Sent", "role": "sent",
                         "totalEmails": 6, "totalThreads": 5, "unreadEmails": 0, "unreadThreads": 0},
                        {"id": "mb-drafts", "name": "Drafts", "role": "drafts",
                         "totalEmails": 1, "totalThreads": 1, "unreadEmails": 1, "unreadThreads": 1},
                        {"id": "mb-archive", "name": "Archive", "role": "archive",
                         "totalEmails": 0, "totalThreads": 0, "unreadEmails": 0, "unreadThreads": 0}
                    ]
                }),
                "Email/query" => json!({
                    "accountId": "acct-1",
                    "ids": ["msg-1", "msg-2"],
                    "total": 2
                }),
                "Email/get" => json!({
                    "accountId": "acct-1",
                    "list": [
                        {
                            "id": "msg-1",
                            "threadId": "th-1",
                            "mailboxIds": {"mb-inbox": true},
                            "subject": "Welcome to AffinMail",
                            "from": [{"name": "Support", "email": "support@affinmail.com"}],
                            "to": [{"name": "Alice", "email": "alice@affinmail.local"}],
                            "cc": [],
                            "bcc": [],
                            "receivedAt": "2026-11-24T10:00:00Z",
                            "preview": "Welcome to your new email inbox!",
                            "textBody": [{"partId": "part-1", "type": "text/plain"}],
                            "bodyValues": {
                                "part-1": {"value": "Welcome to your new email inbox!\nEnjoy high deliverability.", "isTruncated": false}
                            },
                            "attachments": [
                                {"name": "guide.pdf", "type": "application/pdf", "size": 1024, "blobId": "b1"}
                            ]
                        },
                        {
                            "id": "msg-2",
                            "threadId": "th-2",
                            "mailboxIds": {"mb-inbox": true},
                            "subject": "Action Required: Verify Account",
                            "from": [{"name": "Security", "email": "sec@affinmail.com"}],
                            "to": [{"name": "Alice", "email": "alice@affinmail.local"}],
                            "cc": [],
                            "bcc": [],
                            "receivedAt": "2026-11-24T11:00:00Z",
                            "preview": "Please verify your security preferences by tomorrow.",
                            "textBody": [{"partId": "part-2", "type": "text/plain"}],
                            "bodyValues": {
                                "part-2": {"value": "Please verify your security preferences by tomorrow.", "isTruncated": false}
                            },
                            "attachments": []
                        }
                    ]
                }),
                "Email/set" => json!({
                    "accountId": "acct-1",
                    "created": {"msg_new": {"id": "msg-created-1"}},
                    "updated": {"msg-1": {}}
                }),
                "EmailSubmission/set" => json!({
                    "accountId": "acct-1",
                    "created": {"sub_1": {"id": "sub-created-1"}}
                }),
                "Thread/get" => json!({
                    "accountId": "acct-1",
                    "list": [{"id": "th-1", "emailIds": ["msg-1"]}]
                }),
                _ => json!({})
            };
            responses.push(json!([method, res_body, call_id]));
        }
    }

    let response = json!({ "methodResponses": responses });
    write_response(&mut stream, &response.to_string());
    Some(())
}

/// Spawn a 127.0.0.1-only mock JMAP server, return its base URL.
fn spawn_mock() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock listener");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            thread::spawn(move || {
                handle_connection(stream);
            });
        }
    });
    format!("http://127.0.0.1:{}/jmap", port)
}

fn client() -> JmapClient {
    JmapClient::with_token(spawn_mock(), "alice@affinmail.local:secret")
}

#[tokio::test]
async fn resolves_mailbox_ids_by_name_and_role() {
    let c = client();
    assert_eq!(c.mailbox_id("inbox").await.unwrap(), "mb-inbox");
    assert_eq!(c.mailbox_id("INBOX").await.unwrap(), "mb-inbox");
    assert_eq!(c.mailbox_id("sent").await.unwrap(), "mb-sent");
    assert_eq!(c.mailbox_id("Drafts").await.unwrap(), "mb-drafts");
    assert_eq!(c.mailbox_id("archive").await.unwrap(), "mb-archive");

    let err = c.mailbox_id("nonexistent_folder").await.unwrap_err();
    assert!(err.contains("nonexistent_folder"), "unexpected error: {}", err);
}

#[tokio::test]
async fn quota_parsing_combines_quota_and_mailbox_counts() {
    let c = client();
    let quota = c.get_quota().await.unwrap();

    assert_eq!(quota["used"], json!(1048576));
    assert_eq!(quota["limit"], json!(1073741824));
    assert_eq!(quota["mailboxes"]["count"], json!(4));
    assert_eq!(quota["mailboxes"]["totalEmails"], json!(11));
    assert_eq!(quota["mailboxes"]["unreadEmails"], json!(3));
    assert_eq!(quota["raw"]["quotaError"], Value::Null);
    assert_eq!(quota["raw"]["mailboxError"], Value::Null);
}

#[tokio::test]
async fn search_and_read_emails_work() {
    let c = client();

    // 1. search_emails
    let search_res = c
        .search_emails(Some("welcome"), Some("inbox"), None, Some(10), false, None, None)
        .await
        .unwrap();
    assert_eq!(search_res["total"], 2);
    let emails = search_res["emails"].as_array().unwrap();
    assert_eq!(emails[0]["id"], "msg-1");

    // 2. read_email
    let email = c.read_email("msg-1").await.unwrap();
    assert_eq!(email["id"], "msg-1");
    assert_eq!(email["subject"], "Welcome to AffinMail");
    assert!(email["body_text"].as_str().unwrap().contains("high deliverability"));
    assert_eq!(email["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(email["attachments"][0]["name"], "guide.pdf");
}

#[tokio::test]
async fn list_folders_and_get_stats_work() {
    let c = client();

    // 1. list_folders
    let folders_res = c.list_folders().await.unwrap();
    let folders = folders_res["folders"].as_array().unwrap();
    assert_eq!(folders.len(), 4);
    assert_eq!(folders[0]["name"], "Inbox");
    assert_eq!(folders[0]["unread_emails"], 2);

    // 2. get_mailbox_stats
    let stats = c.get_mailbox_stats().await.unwrap();
    assert_eq!(stats["total_emails"], 11);
    assert_eq!(stats["unread"], 3);
    assert_eq!(stats["storage_used_mb"], 1.0);
    assert_eq!(stats["storage_quota_mb"], 1024.0);
    assert_eq!(stats["sent_today"], 2);
}

#[tokio::test]
async fn send_email_and_compose_draft_work() {
    let c = client();

    // 1. send_email
    let send_res = c
        .send_email(
            &["bob@example.com".to_string()],
            "Test Subject",
            "Test Body",
            None,
            None,
        )
        .await
        .unwrap();
    assert!(send_res["methodResponses"].as_array().is_some());

    // 2. draft_email
    let draft_res = c
        .draft_email(&["carol@example.com".to_string()], "Draft Subject", "Draft Body", None)
        .await
        .unwrap();
    assert!(draft_res["methodResponses"].as_array().is_some());
}

#[tokio::test]
async fn move_and_flag_emails_work() {
    let c = client();

    // 1. move_emails
    let move_res = c
        .move_emails(&["msg-1".to_string()], "archive")
        .await
        .unwrap();
    assert_eq!(move_res["target_folder"], "archive");
    assert_eq!(move_res["target_mailbox_id"], "mb-archive");

    // 2. flag_emails
    let flag_res = c
        .flag_emails(
            &["msg-1".to_string()],
            Some("flag"),
            None,
            Some(true),
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(flag_res["email_ids"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn list_contacts_extracts_correspondents() {
    let c = client();
    let contacts_res = c.list_contacts(None, Some(10)).await.unwrap();
    let count = contacts_res["count"].as_i64().unwrap();
    assert!(count >= 2);
    let contacts = contacts_res["contacts"].as_array().unwrap();
    assert!(contacts.iter().any(|c| c["email"] == "support@affinmail.com"));
    assert!(contacts.iter().any(|c| c["email"] == "alice@affinmail.local"));
}

#[tokio::test]
async fn mcp_resources_list_and_read() {
    let c = client();
    let scopes = ScopeChecker::from_env();

    // 1. list_resources
    let res_list = resources::list_resources();
    assert_eq!(res_list.len(), 3);

    // 2. read resources
    let inbox_res = resources::handle_read_resource("mailbox://inbox/recent", &c, &scopes)
        .await
        .unwrap();
    assert_eq!(inbox_res.contents[0].uri, "mailbox://inbox/recent");
    assert!(inbox_res.contents[0].text.contains("Welcome to AffinMail"));

    let stats_res = resources::handle_read_resource("mailbox://stats", &c, &scopes)
        .await
        .unwrap();
    assert_eq!(stats_res.contents[0].uri, "mailbox://stats");
    assert!(stats_res.contents[0].text.contains("total_emails"));

    let folders_res = resources::handle_read_resource("mailbox://folders", &c, &scopes)
        .await
        .unwrap();
    assert_eq!(folders_res.contents[0].uri, "mailbox://folders");
    assert!(folders_res.contents[0].text.contains("mb-inbox"));
}

#[tokio::test]
async fn mcp_prompts_list_and_get() {
    let c = client();
    let scopes = ScopeChecker::from_env();

    // 1. list_prompts
    let prompt_list = prompts::list_prompts();
    assert_eq!(prompt_list.len(), 3);

    // 2. get summarize_inbox
    let sum_prompt = prompts::handle_get_prompt("summarize_inbox", &json!({}), &c, &scopes)
        .await
        .unwrap();
    assert!(sum_prompt.messages[0].content.text.contains("Executive Summary"));

    // 3. get draft_reply
    let reply_prompt = prompts::handle_get_prompt(
        "draft_reply",
        &json!({"email_id": "msg-1", "instructions": "Be brief"}),
        &c,
        &scopes,
    )
    .await
    .unwrap();
    assert!(reply_prompt.messages[0].content.text.contains("Welcome to AffinMail"));
    assert!(reply_prompt.messages[0].content.text.contains("Be brief"));

    // 4. get find_action_items
    let actions_prompt = prompts::handle_get_prompt("find_action_items", &json!({}), &c, &scopes)
        .await
        .unwrap();
    assert!(actions_prompt.messages[0].content.text.contains("Action Required"));
}

#[tokio::test]
async fn token_scopes_enforcement() {
    let c = client();
    let admin = AdminClient::new();
    let audit = AuditLogger::new();

    // Scope: read only
    let read_scopes = ScopeChecker::with_scopes(&["mcp:read"]);
    let read_call = tools::handle_tool_call(
        "search_emails",
        &json!({"query": "test"}),
        &c,
        &admin,
        &read_scopes,
        &audit,
    )
    .await;
    assert!(!read_call.is_error, "read operation should succeed with mcp:read");

    let write_denied = tools::handle_tool_call(
        "compose_draft",
        &json!({"to": ["bob@example.com"], "subject": "Test", "body": "Body"}),
        &c,
        &admin,
        &read_scopes,
        &audit,
    )
    .await;
    assert!(write_denied.is_error, "write operation must fail without mcp:write");
    assert!(write_denied.content[0].text.contains("Permission denied"));

    let send_denied = tools::handle_tool_call(
        "send_email",
        &json!({"to": ["bob@example.com"], "subject": "Test", "body": "Body"}),
        &c,
        &admin,
        &read_scopes,
        &audit,
    )
    .await;
    assert!(send_denied.is_error, "send operation must fail without mcp:send");
    assert!(send_denied.content[0].text.contains("Permission denied"));

    // Scope: send only
    let send_scopes = ScopeChecker::with_scopes(&["mcp:send"]);
    let send_allowed = tools::handle_tool_call(
        "send_email",
        &json!({"to": ["bob@example.com"], "subject": "Test", "body": "Body"}),
        &c,
        &admin,
        &send_scopes,
        &audit,
    )
    .await;
    assert!(!send_allowed.is_error, "send operation should succeed with mcp:send");

    let read_denied = tools::handle_tool_call(
        "read_email",
        &json!({"email_id": "msg-1"}),
        &c,
        &admin,
        &send_scopes,
        &audit,
    )
    .await;
    assert!(read_denied.is_error, "read operation must fail without mcp:read");
}

#[tokio::test]
async fn audit_log_records_tool_calls() {
    let temp_log = std::env::temp_dir().join(format!("mcp-audit-{}.log", std::process::id()));
    let temp_log_str = temp_log.to_string_lossy().to_string();

    let audit = AuditLogger::with_path(&temp_log_str, "test-agent");
    audit.log_tool_call("test_tool", false, Some("testing success"));
    audit.log_tool_call("test_tool_err", true, Some("testing error"));

    let content = std::fs::read_to_string(&temp_log).expect("read audit log");
    assert!(content.contains("\"tool\":\"test_tool\""));
    assert!(content.contains("\"status\":\"success\""));
    assert!(content.contains("\"tool\":\"test_tool_err\""));
    assert!(content.contains("\"status\":\"error\""));
    assert!(content.contains("\"agent\":\"test-agent\""));

    let _ = std::fs::remove_file(temp_log);
}
