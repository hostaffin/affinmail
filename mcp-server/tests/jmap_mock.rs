//! End-to-end tests for the real JMAP client against a canned local HTTP mock.
//! Only std TcpListener — no external network, no mail ever leaves the box.

use affinmail_mcp_server::jmap::JmapClient;
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

fn mailboxes() -> Value {
    json!({
        "methodResponses": [
            ["Mailbox/get", {
                "accountId": "acct-1",
                "list": [
                    {"id": "mb-inbox", "name": "Inbox", "role": "inbox",
                     "totalEmails": 4, "totalThreads": 3, "unreadEmails": 2, "unreadThreads": 2},
                    {"id": "mb-sent", "name": "Sent", "role": "sent",
                     "totalEmails": 6, "totalThreads": 5, "unreadEmails": 0, "unreadThreads": 0},
                    {"id": "mb-drafts", "name": "Drafts", "role": "drafts",
                     "totalEmails": 1, "totalThreads": 1, "unreadEmails": 1, "unreadThreads": 1}
                ]
            }, "mailbox_get_1"]
        ]
    })
}

fn quota() -> Value {
    json!({
        "methodResponses": [
            ["Quota/get", {
                "accountId": "acct-1",
                "list": [
                    {"id": "q1", "used": 1048576, "hardLimit": 1073741824, "softLimit": 1073741824}
                ]
            }, "quota_get_1"]
        ]
    })
}

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
    let method = payload
        .pointer("/methodCalls/0/0")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let response = match method {
        "Quota/get" => quota(),
        "Mailbox/get" => mailboxes(),
        _ => json!({"methodResponses": []}),
    };
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

    let err = c.mailbox_id("archive").await.unwrap_err();
    assert!(err.contains("archive"), "unexpected error: {}", err);
}

#[tokio::test]
async fn quota_parsing_combines_quota_and_mailbox_counts() {
    let c = client();
    let quota = c.get_quota().await.unwrap();

    assert_eq!(quota["used"], json!(1048576));
    assert_eq!(quota["limit"], json!(1073741824));
    assert_eq!(quota["mailboxes"]["count"], json!(3));
    assert_eq!(quota["mailboxes"]["totalEmails"], json!(11));
    assert_eq!(quota["mailboxes"]["unreadEmails"], json!(3));
    assert_eq!(quota["mailboxes"]["list"].as_array().unwrap().len(), 3);
    assert_eq!(quota["raw"]["quotaError"], Value::Null);
    assert_eq!(quota["raw"]["mailboxError"], Value::Null);
}
