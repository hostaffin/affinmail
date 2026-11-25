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

/* ================================================================== */
/* Module H — F-082 lists, F-084 password policy, F-085 2FA (TOTP)     */
/* ================================================================== */

async fn json_response(app: axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

fn json_request(method: &str, uri: &str, payload: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap()
}

#[tokio::test]
async fn test_distribution_lists_crud() {
    let app = create_app(AppState::new());

    // GET seeded list
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/domains/affinmail.local/lists")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let seed_count = body.as_array().unwrap().len();
    assert!(seed_count >= 1);
    assert!(body
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["address"] == "team@affinmail.local"
            && l["members"].as_array().unwrap().len() == 1
            && l["post_policy"] == "members"));

    // Unknown domain -> 404
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/domains/nodomain.example/lists")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], 404);

    // POST with address_prefix, default post_policy
    let (status, body) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/domains/affinmail.local/lists",
            serde_json::json!({
                "address_prefix": "ops",
                "name": "Ops Team",
                "members": ["alex.mercer@affinmail.local", "outsider@example.com"]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["address"], "ops@affinmail.local");
    assert_eq!(body["post_policy"], "members");
    assert_eq!(body["members"].as_array().unwrap().len(), 2);
    let list_id = body["id"].as_str().unwrap().to_string();
    assert!(list_id.starts_with("lst_"));

    // Duplicate address -> 409
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/domains/affinmail.local/lists",
            serde_json::json!({ "address_prefix": "ops", "name": "Dup" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Invalid post_policy -> 400
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/domains/affinmail.local/lists",
            serde_json::json!({ "address_prefix": "x2", "name": "Bad", "post_policy": "weird" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // PATCH name + policy
    let (status, body) = json_response(
        app.clone(),
        json_request(
            "PATCH",
            &format!("/api/v1/client/lists/{}", list_id),
            serde_json::json!({ "name": "Operations", "post_policy": "anyone" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "Operations");
    assert_eq!(body["post_policy"], "anyone");

    // PATCH unknown id -> 404
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "PATCH",
            "/api/v1/client/lists/lst_nope",
            serde_json::json!({ "name": "Ghost" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // DELETE
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/client/lists/{}", list_id).as_str())
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], list_id);

    // DELETE again -> 404
    let (status, _) = json_response(
        app.clone(),
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/client/lists/{}", list_id).as_str())
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_password_policy_and_enforcement() {
    let app = create_app(AppState::new());

    // GET default policy
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/domains/affinmail.local/password-policy")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["min_length"], 10);
    assert_eq!(body["require_upper"], false);
    assert_eq!(body["require_number"], false);
    assert_eq!(body["require_special"], false);
    assert_eq!(body["expiry_days"], 0);

    // PUT invalid min_length -> 400
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "PUT",
            "/api/v1/client/domains/affinmail.local/password-policy",
            serde_json::json!({ "min_length": 5 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // PUT invalid expiry_days -> 400
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "PUT",
            "/api/v1/client/domains/affinmail.local/password-policy",
            serde_json::json!({ "expiry_days": 45 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // PUT valid policy
    let (status, body) = json_response(
        app.clone(),
        json_request(
            "PUT",
            "/api/v1/client/domains/affinmail.local/password-policy",
            serde_json::json!({
                "min_length": 12,
                "require_upper": true,
                "require_number": true
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["min_length"], 12);
    assert_eq!(body["require_upper"], true);

    // GET reflects the override
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/domains/affinmail.local/password-policy")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["min_length"], 12);

    // Enforcement: weak password rejected on mailbox create
    let (status, body) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/domains/affinmail.local/mailboxes",
            serde_json::json!({ "email": "weakpw@affinmail.local", "password": "short1" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("character"));

    // Missing uppercase also rejected
    let (status, body) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/domains/affinmail.local/mailboxes",
            serde_json::json!({ "email": "weakpw2@affinmail.local", "password": "alllowercase12" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("uppercase"));

    // Strong password accepted
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/domains/affinmail.local/mailboxes",
            serde_json::json!({ "email": "strongpw@affinmail.local", "password": "Sup3rSecure!" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Enforcement on password change: weak rejected, strong ok
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "PUT",
            "/api/v1/client/mailboxes/mb_1/password",
            serde_json::json!({ "password": "weak" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = json_response(
        app.clone(),
        json_request(
            "PUT",
            "/api/v1/client/mailboxes/mb_1/password",
            serde_json::json!({ "password": "N3wStrongPass!" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn test_2fa_totp_enrolment_flow() {
    let app = create_app(AppState::new());

    // Initially disabled
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/mailboxes/mb_1/2fa")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);

    // Unknown mailbox -> 404
    let (status, _) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/mailboxes/mb_nope/2fa")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Setup: fresh secret + otpauth url, still disabled
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .method("POST")
            .uri("/api/v1/client/mailboxes/mb_1/2fa/setup")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let secret = body["secret"].as_str().unwrap().to_string();
    assert!(!secret.is_empty());
    let url = body["otpauth_url"].as_str().unwrap();
    assert!(url.starts_with("otpauth://totp/AffinMail:alex.mercer@affinmail.local?secret="));
    assert!(url.contains("issuer=AffinMail"));
    assert!(url.contains("digits=6"));
    assert!(url.contains("period=30"));

    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/mailboxes/mb_1/2fa")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(body["enabled"], false);
    assert_eq!(status, StatusCode::OK);

    // Enable with a wrong code -> 400 (guaranteed to differ from the real code)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let real = affinmail_server::totp::code_at(&secret, now).unwrap();
    let bad: String = real
        .chars()
        .map(|c| if c == '0' { '1' } else { '0' })
        .collect();
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/mailboxes/mb_1/2fa/enable",
            serde_json::json!({ "code": bad }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Enable with the correct TOTP code (same function the server verifies with)
    let (status, body) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/mailboxes/mb_1/2fa/enable",
            serde_json::json!({ "code": real }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let codes = body["recovery_codes"].as_array().unwrap();
    assert_eq!(codes.len(), 10);
    for c in codes {
        let s = c.as_str().unwrap();
        assert_eq!(s.len(), 9);
        assert_eq!(&s[4..5], "-");
    }

    // Status now enabled
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/mailboxes/mb_1/2fa")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], true);

    // Disable with a recovery code
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/mailboxes/mb_1/2fa/disable",
            serde_json::json!({ "code": codes[0].as_str().unwrap() }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // State cleared
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/client/mailboxes/mb_1/2fa")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);

    // Disable again -> 400 (nothing enrolled)
    let (status, _) = json_response(
        app.clone(),
        json_request(
            "POST",
            "/api/v1/client/mailboxes/mb_1/2fa/disable",
            serde_json::json!({ "code": "AAAA-BBBB" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/* ================================================================== */
/* Close-out: DKIM private key never serialized, admin aliases 200      */
/* ================================================================== */

#[tokio::test]
async fn test_domains_never_expose_dkim_private_key() {
    let app = create_app(AppState::new());

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
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(
        !text.contains("PRIVATE KEY"),
        "GET /api/v1/domains must not serialize the DKIM private key"
    );
    let body: Value = serde_json::from_str(&text).unwrap();
    let domains = body["domains"].as_array().unwrap();
    assert!(domains.len() >= 1);
    // Public key + selector stay in the payload.
    assert!(domains[0].get("dkim_public_key").is_some());
    assert!(domains[0].get("dkim_selector").is_some());
    assert!(domains[0].get("dkim_private_key").is_none());
}

#[tokio::test]
async fn test_admin_aliases_list_ok() {
    let app = create_app(AppState::new());

    // Pathless admin route: used to 500 (Path extractor with no path param).
    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .uri("/api/v1/aliases")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let aliases = body["aliases"].as_array().unwrap();
    assert!(aliases.len() >= 1);
    assert_eq!(body["count"], aliases.len() as u64);
    // Field names AdminPanel.tsx's Aliases tab renders.
    let a = &aliases[0];
    assert!(a.get("id").is_some());
    assert!(a.get("source_address").is_some());
    assert!(a.get("destination_address").is_some());
    assert!(a.get("isActive").is_some());

    // The tab's create button hits POST /api/v1/aliases (also pathless).
    let (status, _) = json_response(
        app,
        json_request(
            "POST",
            "/api/v1/aliases",
            serde_json::json!({
                "source": "closeout@affinmail.local",
                "destination": "alex.mercer@affinmail.local"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}
