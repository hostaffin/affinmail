use affinmail_server::{create_app, state::AppState};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_health_and_stats() {
    let app = create_app(AppState::new());

    // Test GET /api/v1/health
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "healthy");
    assert_eq!(body["runtime"], "100% Native Rust (Zero PHP, Zero Docker)");

    // Test GET /api/v1/stats
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(body["overview"]["total_domains"].as_i64().unwrap() >= 1);
}

#[tokio::test]
async fn test_provisioning_lifecycle() {
    let app = create_app(AppState::new());

    // 1. List Plans
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/provision/plans")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(body["plans"].as_array().unwrap().len() >= 3);

    // 2. Create Account
    let payload = serde_json::json!({
        "company_name": "Rust Corp Global",
        "admin_email": "admin@rustcorp.com",
        "plan": "professional",
        "domain": "rustcorp.com"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/provision/accounts")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let account_id = body["account"]["id"].as_str().unwrap().to_string();
    assert_eq!(body["account"]["status"], "active");
    assert_eq!(body["domain"]["domain_name"], "rustcorp.com");

    // 3. Get Account
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/provision/accounts/{}", account_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 4. Suspend Account
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/provision/accounts/{}/suspend", account_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "suspended");

    // 5. Unsuspend Account
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/provision/accounts/{}/unsuspend", account_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "active");

    // 6. Generate SSO Token
    let sso_payload = serde_json::json!({
        "account_id": account_id,
        "redirect_to": "webmail"
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/provision/sso/token")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&sso_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let token = body["token"].as_str().unwrap().to_string();

    // 7. Exchange SSO Token
    let exchange_payload = serde_json::json!({ "token": token });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/sso-exchange")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&exchange_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "success");
    assert_eq!(body["account_id"], account_id);
}

#[tokio::test]
async fn test_client_self_service_and_configs() {
    let app = create_app(AppState::new());

    // 1. Client Dashboard
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/client/dashboard")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 2. Client DNS Check
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/client/domains/rustcorp.com/dns-check")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "verified");

    // 3. Thunderbird Autoconfig XML
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/client/domains/rustcorp.com/autoconfig")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/xml; charset=utf-8"
    );
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let xml = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(xml.contains("<clientConfig version=\"1.1\">"));
    assert!(xml.contains("<port>993</port>"));
    assert!(xml.contains("<port>465</port>"));

    // 4. Outlook Autodiscover XML
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/client/domains/rustcorp.com/autodiscover")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let xml = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(xml.contains("<Autodiscover"));

    // 5. Apple .mobileconfig
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/client/domains/rustcorp.com/mobileconfig")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/x-apple-aspen-config"
    );

    // 6. App Passwords (Generate & List)
    let payload = serde_json::json!({ "label": "Thunderbird on Laptop" });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/client/mailboxes/mb_1/app-passwords")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let pwd = body["password"].as_str().unwrap();
    assert_eq!(pwd.len(), 19); // 4 groups of 4 separated by 3 hyphens = 19 chars

    // 7. MCP Token (Generate & List)
    let mcp_payload = serde_json::json!({
        "name": "Claude Desktop Integration",
        "scopes": ["mcp:read", "mcp:write"]
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/client/mailboxes/mb_1/mcp/tokens")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&mcp_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(body["token"].as_str().unwrap().starts_with("aff_mcp_"));
}

#[tokio::test]
async fn test_admin_and_queue_operations() {
    let app = create_app(AppState::new());

    // 1. List Domains
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/domains")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(body["domains"].as_array().unwrap().len() >= 1);

    // 2. Create Domain
    let dom_payload = serde_json::json!({
        "name": "sovereignmail.org",
        "max_mailboxes": 50,
        "disk_quota_mb": 102400
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/domains")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&dom_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // 3. Get Domain DNS & Deliverability
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/domains/sovereignmail.org/dns")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/domains/sovereignmail.org/deliverability")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["deliverability_score"], 100);

    // 4. DKIM Rotation
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/domains/sovereignmail.org/dkim-rotate")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 5. Queue Operations
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/queue")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/queue/msg_101/retry")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 6. IP Pools
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/ip-pools")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 7. Backup Trigger
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/system/backup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
