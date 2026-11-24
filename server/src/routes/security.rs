//! Module D — Email Authentication & Security (F-035..F-046).
//!
//! DKIM truth comes from Stalwart itself over the admin JMAP API
//! (`urn:stalwart:jmap`): `x:DkimSignature` holds the live signing keys and
//! `x:Domain.dnsZoneFile` the DNS records Stalwart expects published. The
//! PostgreSQL `domains` mirror keeps DEMO keys and is never presented as the
//! live source. External checks (DNS lookup via Google DoH) are real; when a
//! service is unreachable the API says so instead of fabricating data.

use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

fn err(status: StatusCode, code: u16, msg: impl Into<String>) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": { "code": code, "message": msg.into() } })))
}

/* ------------------------------------------------------------------ */
/* Live Stalwart data helpers                                          */
/* ------------------------------------------------------------------ */

/// All DKIM signatures registered in Stalwart (the live signing keys).
pub async fn stalwart_dkim_pub() -> Option<Vec<Value>> {
    stalwart_dkim().await
}

/// Pub wrapper for admin.rs: resolve DNS records via DoH.
pub async fn dns_query_pub(name: &str, rtype: &str) -> Option<Vec<String>> {
    dns_query(name, rtype).await
}

/// Pub wrapper for admin.rs: the registered Stalwart domain object.
pub async fn stalwart_domain_pub(name: &str) -> Option<Value> {
    stalwart_domain(name).await
}

async fn stalwart_dkim() -> Option<Vec<Value>> {    let ids = crate::stats::stalwart_jmap(json!([
        ["x:DkimSignature/query", { "accountId": "admin" }, "0"]
    ]))
    .await?
    .get("ids")?
    .as_array()?
    .clone();
    if ids.is_empty() {
        return Some(Vec::new());
    }
    crate::stats::stalwart_jmap(json!([
        ["x:DkimSignature/get", { "accountId": "admin", "ids": ids }, "0"]
    ]))
    .await?
    .get("list")?
    .as_array()
    .cloned()
}

/// The registered Stalwart domain object (matched by name).
async fn stalwart_domain(name: &str) -> Option<Value> {
    let ids = crate::stats::stalwart_jmap(json!([
        ["x:Domain/query", { "accountId": "admin" }, "0"]
    ]))
    .await?
    .get("ids")?
    .as_array()?
    .clone();
    if ids.is_empty() {
        return None;
    }
    let list = crate::stats::stalwart_jmap(json!([
        ["x:Domain/get", { "accountId": "admin", "ids": ids }, "0"]
    ]))
    .await?
    .get("list")?
    .as_array()?
    .clone();
    list.into_iter()
        .find(|d| d.get("name").and_then(|n| n.as_str()) == Some(name))
}

/// Resolve a DNS record via Google DoH (real network lookup).
async fn dns_query(name: &str, rtype: &str) -> Option<Vec<String>> {
    let url = format!(
        "https://dns.google/resolve?name={}&type={}",
        urlencode(name),
        rtype
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok()?;
    let v: Value = client.get(&url).send().await.ok()?.json().await.ok()?;
    let answers = v.get("Answer")?.as_array()?;
    Some(
        answers
            .iter()
            .filter_map(|a| a.get("data").and_then(|d| d.as_str()).map(|s| s.to_string()))
            .collect(),
    )
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Extract the bare key from a DNS TXT DKIM value (strip quotes/parts).
fn txt_bare(v: &str) -> String {
    v.replace('"', "").replace(' ', "").replace('\n', "")
}

/* ------------------------------------------------------------------ */
/* F-035/F-036 — DKIM keys                                             */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/dkim — live DKIM keys from Stalwart + DNS publication
/// status (real DoH lookup).
pub async fn dkim_overview(State(_state): State<AppState>) -> impl IntoResponse {
    let mut keys = Vec::new();
    let mut stalwart_ok = true;
    if let Some(sigs) = stalwart_dkim().await {
        for s in sigs {
            let selector = s.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let domain_id = s
                .get("domainId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Resolve the domain name for this signature.
            let domain = crate::stats::stalwart_jmap(json!([
                ["x:Domain/get", { "accountId": "admin", "ids": [domain_id] }, "0"]
            ]))
            .await
            .and_then(|r| {
                r.get("list")
                    .and_then(|l| l.get(0))
                    .and_then(|d| d.get("name"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();
            let algo = s
                .get("@type")
                .and_then(|v| v.as_str())
                .unwrap_or("Dkim1RsaSha256")
                .to_string();
            let pubkey = s
                .get("publicKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let host = format!("{}._domainkey.{}", selector, domain);
            let published = dns_query(&host, "TXT").await;
            let found = published
                .as_ref()
                .map(|recs| recs.iter().any(|r| txt_bare(r).contains(&pubkey)));
            keys.push(json!({
                "id": s.get("id").cloned().unwrap_or(Value::Null),
                "domain": domain,
                "selector": selector,
                "algorithm": if algo.contains("Ed25519") { "ed25519" } else { "rsa" },
                "stage": s.get("stage").and_then(|v| v.as_str()).unwrap_or("active"),
                "createdAt": s.get("createdAt").cloned().unwrap_or(Value::Null),
                "publicKey": pubkey,
                "dnsHost": host,
                "dnsRecord": format!("v=DKIM1; k={}; p={}", if algo.contains("Ed25519") { "ed25519" } else { "rsa" }, pubkey),
                "dnsStatus": match (&published, found) {
                    (None, _) => "unknown",          // DNS lookup failed
                    (Some(_), Some(true)) => "published",
                    (Some(_), Some(false)) => "mismatch",
                    (Some(_), None) => "missing",
                },
            }));
        }
    } else {
        stalwart_ok = false;
    }

    // PostgreSQL mirror is DEMO data — flagged as such, never live truth.
    let mirror_note;
    let mut mirror: Vec<Value> = Vec::new();
    if let Some(pg) = crate::stats::pg_connect().await {
        match pg
            .query(
                "SELECT domain_name, dkim_selector, left(dkim_public_key, 40) FROM domains WHERE is_active = true OR is_active IS NULL",
                &[],
            )
            .await
        {
            Ok(rows) => {
                for r in rows {
                    mirror.push(json!({
                        "domain": r.get::<_, String>(0),
                        "selector": r.get::<_, String>(1),
                        "publicKeyPreview": r.get::<_, String>(2),
                    }));
                }
                mirror_note = "PostgreSQL domains.dkim_* columns hold DEMO/placeholder keys — Stalwart (above) is the live signing source".to_string();
            }
            Err(e) => mirror_note = format!("PostgreSQL mirror unavailable: {e}"),
        }
    } else {
        mirror_note = "PostgreSQL unavailable".to_string();
    }

    Json(json!({
        "source": if stalwart_ok { "stalwart" } else { "unavailable" },
        "stalwartReachable": stalwart_ok,
        "keys": keys,
        "pgMirror": { "rows": mirror, "note": mirror_note },
        "note": if stalwart_ok {
            "Keys are Stalwart's live auto-generated DKIM signatures. Publish the DNS records shown; rotation happens in Stalwart (rotateAfter 90d)."
        } else {
            "Stalwart admin API unreachable — DKIM state unknown, not fabricated."
        }
    }))
}

/// POST /api/v1/security/dkim/rotate — rotate via Stalwart (new selector per
/// its template) or honestly report why not.
#[derive(Deserialize)]
pub struct RotateBody {
    pub domain: String,
    pub algorithm: Option<String>, // rsa | ed25519
}

pub async fn dkim_rotate(
    State(_state): State<AppState>,
    Json(body): Json<RotateBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let domain = body.domain.trim().trim_end_matches('.').to_lowercase();
    let dom = stalwart_domain(&domain).await.ok_or_else(|| {
        err(StatusCode::NOT_FOUND, 404, format!("Domain '{}' not registered in Stalwart", domain))
    })?;
    let dom_id = dom.get("id").and_then(|v| v.as_str()).unwrap_or("b").to_string();
    let algo = match body.algorithm.as_deref() {
        Some("ed25519") => "Dkim1Ed25519Sha256",
        _ => "Dkim1RsaSha256",
    };

    // Stage a new signature in "keygen" stage; Stalwart promotes it through
    // publish → active per the domain's dkimManagement schedule.
    let created = crate::stats::stalwart_jmap(json!([
        ["x:DkimSignature/set", {
            "accountId": "admin",
            "create": {
                "rotate-1": {
                    "domainId": dom_id,
                    "selector": "",           // empty = use domain selectorTemplate
                    "@type": algo,
                    "stage": "keygen",
                }
            }
        }, "0"]
    ]))
    .await;

    match created {
        Some(r) if r.get("notCreated").is_none() || r.get("created").is_some() => {
            Ok(Json(json!({
                "status": "rotating",
                "domain": domain,
                "algorithm": if algo == "Dkim1Ed25519Sha256" { "ed25519" } else { "rsa" },
                "next": "Stalwart generates the key (keygen), then publishes → activates it per dkimManagement (48h propagation, 7d retire overlap). Fetch /security/dkim to see the new selector and its DNS record.",
                "result": r,
            })))
        }
        Some(r) => Err(err(
            StatusCode::BAD_REQUEST,
            400,
            format!("Stalwart rejected the rotation request: {}", r),
        )),
        None => Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            503,
            "Stalwart admin API unreachable — rotation not performed",
        )),
    }
}

/* ------------------------------------------------------------------ */
/* F-038 — DMARC policy manager                                        */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/dmarc/{domain} — DMARC record check + recommended
/// record text. Reads live DNS, never invents a result.
pub async fn dmarc_get(Path(domain): Path<String>) -> impl IntoResponse {
    let domain = domain.trim_end_matches('.').to_lowercase();
    let host = format!("_dmarc.{}", domain);
    let lookup = dns_query(&host, "TXT").await;
    let record = lookup
        .as_ref()
        .and_then(|recs| recs.iter().find(|r| r.contains("v=DMARC1")).cloned());
    let policy = record
        .as_deref()
        .and_then(|r| r.split(';').find(|p| p.trim().starts_with("p=")))
        .map(|p| p.trim()[2..].to_string());
    let rua = record
        .as_deref()
        .and_then(|r| r.split(';').find(|p| p.trim().starts_with("rua=")))
        .map(|p| p.trim()[4..].to_string());

    let suggested = json!({
        "host": host,
        "type": "TXT",
        "value": format!("v=DMARC1; p={}; rua=mailto:postmaster@{}", policy.as_deref().unwrap_or("none"), domain),
    });

    Json(json!({
        "domain": domain,
        "record": record,
        "dnsHost": host,
        "policy": policy,
        "rua": rua,
        "found": record.is_some(),
        "dnsReachable": lookup.is_some(),
        "wizard": {
            "none": format!("v=DMARC1; p=none; rua=mailto:postmaster@{}", domain),
            "quarantine": format!("v=DMARC1; p=quarantine; pct=25; rua=mailto:postmaster@{}", domain),
            "reject": format!("v=DMARC1; p=reject; rua=mailto:postmaster@{}", domain),
        },
        "suggested": suggested,
        "note": "Publish the TXT record at your DNS provider; no DNS API is connected so this panel validates but cannot push records.",
    }))
}

/* ------------------------------------------------------------------ */
/* F-039 — DMARC aggregate reports (from Stalwart, live)               */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/dmarc-reports — DMARC aggregate reports Stalwart has
/// received (x:DmarcInternalReport). Empty store → honest empty list.
pub async fn dmarc_reports(State(_state): State<AppState>) -> impl IntoResponse {
    let mut reports = Vec::new();
    let mut live = true;
    if let Some(ids) = crate::stats::stalwart_jmap(json!([
        ["x:DmarcInternalReport/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .and_then(|r| r.get("ids").and_then(|i| i.as_array()).cloned())
    {
        if !ids.is_empty() {
            if let Some(list) = crate::stats::stalwart_jmap(json!([
                ["x:DmarcInternalReport/get", { "accountId": "admin", "ids": ids }, "0"]
            ]))
            .await
            .and_then(|r| r.get("list").and_then(|l| l.as_array()).cloned())
            {
                for r in list {
                    reports.push(r);
                }
            }
        }
    } else {
        live = false;
    }
    Json(json!({
        "live": live,
        "reports": reports,
        "count": reports.len(),
        "note": if live {
            "Aggregate DMARC reports received by this server (Stalwart x:DmarcInternalReport)."
        } else {
            "Stalwart admin API unreachable — report store state unknown."
        }
    }))
}

/* ------------------------------------------------------------------ */
/* F-041/F-042 — MTA-STS + TLS-RPT                                     */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/mts-sts/{domain} — live policy + DNS status.
pub async fn mta_sts(Path(domain): Path<String>) -> impl IntoResponse {
    let domain = domain.trim_end_matches('.').to_lowercase();
    let policy = crate::stats::stalwart_jmap(json!([
        ["x:MtaSts/get", { "accountId": "admin", "ids": ["singleton"] }, "0"]
    ]))
    .await
    .and_then(|r| r.get("list").and_then(|l| l.get(0)).cloned());

    let txt = dns_query(&format!("_mta-sts.{}", domain), "TXT").await;
    Json(json!({
        "domain": domain,
        "stalwartPolicy": policy,
        "dnsTxtHost": format!("_mta-sts.{}", domain),
        "dnsTxt": txt,
        "dnsWellKnown": format!("https://mta-sts.{}/.well-known/mta-sts.txt", domain),
        "recordTemplate": format!("v=STSv1; id={}", chrono::Utc::now().format("%Y%m%d%H%M%S")),
        "note": "Policy served by Stalwart at the well-known URL; publish the _mta-sts TXT record at your DNS provider.",
    }))
}

/// GET /api/v1/security/tls-rpt/{domain} — TLS-RPT record + received reports.
pub async fn tls_rpt(Path(domain): Path<String>) -> impl IntoResponse {
    let domain = domain.trim_end_matches('.').to_lowercase();
    let txt = dns_query(&format!("_smtp._tls.{}", domain), "TXT").await;
    let reports = crate::stats::stalwart_jmap(json!([
        ["x:TlsInternalReport/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .map(|r| r.get("total").cloned().unwrap_or(Value::Null));
    Json(json!({
        "domain": domain,
        "dnsTxtHost": format!("_smtp._tls.{}", domain),
        "dnsTxt": txt,
        "recordTemplate": format!("v=TLSRPTv1; rua=mailto:postmaster@{}", domain),
        "reportsReceived": reports.unwrap_or(Value::Null),
        "note": "Publish the TXT record; JSON TLS reports arrive at the rua address and are parsed by Stalwart (x:TlsInternalReport).",
    }))
}

/* ------------------------------------------------------------------ */
/* F-043 — ARC                                                         */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/arc — live ARC settings from Stalwart (x:MtaStageData).
pub async fn arc_settings(State(_state): State<AppState>) -> impl IntoResponse {
    let settings = crate::stats::stalwart_jmap(json!([
        ["x:MtaStageData/get", { "accountId": "admin", "ids": ["singleton"] }, "0"]
    ]))
    .await;
    match settings {
        Some(s) => Json(json!({
            "live": true,
            "settings": s,
            "note": "ARC seal/sign configuration lives in Stalwart (x:MtaStageData); forwarded mail is sealed per these settings.",
        })),
        None => Json(json!({
            "live": false,
            "note": "Stalwart admin API unreachable — ARC settings unknown.",
        })),
    }
}

/* ------------------------------------------------------------------ */
/* F-044 — TLS certificate inventory                                   */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/certificates — cert inventory. Live: probe the local
/// mail listener for its cert; Stalwart's x:Certificate store for uploads.
pub async fn certificates(State(_state): State<AppState>) -> impl IntoResponse {
    let mut certs = Vec::new();

    // Real probe: read the served certificate off the SMTP submission listener.
    let probe = tokio::net::TcpStream::connect("127.0.0.1:465").await;
    if let Ok(stream) = probe {
        drop(stream);
        let out = tokio::process::Command::new("openssl")
            .args([
                "s_client",
                "-connect", "127.0.0.1:465",
                "-showcerts",
                "</dev/null",
            ])
            .output()
            .await;
        if let Ok(o) = out {
            let text = String::from_utf8_lossy(&o.stdout);
            let subject = text
                .lines()
                .find(|l| l.contains("subject="))
                .map(|l| l.trim().trim_start_matches("subject=").to_string());
            let issuer = text
                .lines()
                .find(|l| l.contains("issuer="))
                .map(|l| l.trim().trim_start_matches("issuer=").to_string());
            let dates: Vec<String> = text
                .lines()
                .filter(|l| l.contains("Not ") && l.contains(":"))
                .map(|l| l.trim().to_string())
                .collect();
            certs.push(json!({
                "listener": "smtps://0.0.0.0:465",
                "subject": subject,
                "issuer": issuer,
                "validity": dates,
                "source": "live-probe",
            }));
        }
    }

    // Uploaded certs in Stalwart's store.
    let stored = crate::stats::stalwart_jmap(json!([
        ["x:Certificate/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .map(|r| r.get("total").cloned().unwrap_or(json!(0)));

    Json(json!({
        "certificates": certs,
        "stalwartCertificateCount": stored.unwrap_or(Value::Null),
        "provisioner": "manual",
        "note": "Let's Encrypt automation for mail hostnames is not configured on this instance (no ACME account); the live cert above is probed from the running listener. Upload custom PEMs through Stalwart's certificate store.",
    }))
}

/* ------------------------------------------------------------------ */
/* F-045 — Spam & antivirus configuration                              */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/spam — live spam config (thresholds, DNSBLs, rules).
pub async fn spam_settings(State(_state): State<AppState>) -> impl IntoResponse {
    let settings = crate::stats::stalwart_jmap(json!([
        ["x:SpamSettings/get", { "accountId": "admin", "ids": ["singleton"] }, "0"]
    ]))
    .await;
    let dnsbls = crate::stats::stalwart_jmap(json!([
        ["x:SpamDnsblServer/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .map(|r| r.get("total").cloned().unwrap_or(json!(0)));
    let rules = crate::stats::stalwart_jmap(json!([
        ["x:SpamRule/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .map(|r| r.get("total").cloned().unwrap_or(json!(0)));

    Json(json!({
        "live": settings.is_some(),
        "settings": settings,
        "dnsblCount": dnsbls.unwrap_or(Value::Null),
        "ruleCount": rules.unwrap_or(Value::Null),
        "quarantine": "spam messages land in the recipient's Junk folder (Stalwart native); no separate admin quarantine store is configured",
        "note": "Live configuration from Stalwart (x:SpamSettings). Bayes training data is not present on this instance.",
    }))
}

/* ------------------------------------------------------------------ */
/* F-046 — Brute-force protection                                      */
/* ------------------------------------------------------------------ */

/// GET /api/v1/security/bruteforce — live ban rates + blocked IP list.
pub async fn bruteforce(State(_state): State<AppState>) -> impl IntoResponse {
    let security = crate::stats::stalwart_jmap(json!([
        ["x:Security/get", { "accountId": "admin", "ids": ["singleton"] }, "0"]
    ]))
    .await
    .and_then(|r| r.get("list").and_then(|l| l.get(0)).cloned());

    let blocked = crate::stats::stalwart_jmap(json!([
        ["x:BlockedIp/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .map(|r| r.get("total").cloned().unwrap_or(json!(0)));

    let allowed = crate::stats::stalwart_jmap(json!([
        ["x:AllowedIp/query", { "accountId": "admin", "calculateTotal": true }, "0"]
    ]))
    .await
    .map(|r| r.get("total").cloned().unwrap_or(json!(0)));

    Json(json!({
        "live": security.is_some(),
        "settings": security,
        "blockedIps": blocked.unwrap_or(Value::Null),
        "whitelistedIps": allowed.unwrap_or(Value::Null),
        "note": "Ban thresholds are Stalwart's (x:Security.authBanRate etc.). Progressive escalation and geo-restriction are not configured on this instance.",
    }))
}
