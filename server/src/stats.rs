//! Platform observability: mail flow, IP reputation, service health.
//!
//! A background collector (spawned from `main`) runs every 5 minutes:
//!   1. Parses new Stalwart log lines into hourly counters — global
//!      (`stats_mail_events`) and per-domain (`stats_domain_events`).
//!   2. Samples queue depth (JMAP), billing-mirror sizes, host resources
//!      and service health into `stats_samples`.
//!   3. Runs DNSBL checks for every active IP pool into `ip_rbl_checks`
//!      and refreshes `ip_pools.reputation_score`.
//!
//! The handlers here shape that data for the admin Overview
//! (`GET /api/v1/stats`) and the customer self-service panel
//! (`GET /api/v1/client/domains/{domain}/stats`). PostgreSQL credentials
//! come from Stalwart's own store config, so no extra env is needed.

use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::time::Duration;

use chrono::Utc;
use serde_json::{json, Value};
use tokio_postgres::Client;

use crate::state::AppState;

const LOG_DIR: &str = "/var/log/stalwart";
const STATE_FILE: &str = "/var/www/affinmail/data/collector-state.json";
const STALWART_CONFIG: &str = "/etc/stalwart/config.json";
const SECRETS_FILE: &str = "/etc/stalwart/local-secrets.txt";
const BACKUP_DIR: &str = "/var/www/affinmail/backups";
const SERVER_IP: &str = "144.79.132.94";
const SERVER_RDNS: &str = "mail.hostaffin.com";
const RBL_LISTS: [&str; 3] = [
    "zen.spamhaus.org",
    "bl.spamcop.net",
    "b.barracudacentral.org",
];

/* ------------------------------------------------------------------ */
/* Connections & probes                                                */
/* ------------------------------------------------------------------ */

/// Connection parameters. Preferred source is the dedicated stats role
/// in /etc/affinmail-stats.env (root-only): Stalwart's own store secret
/// in config.json is encrypted, so the platform gets its own login.
fn pg_params() -> Option<(String, u16, String, String, String)> {
    if let Ok(raw) = std::fs::read_to_string("/etc/affinmail-stats.env") {
        let get = |key: &str| {
            raw.lines().find_map(|line| {
                line.split_once('=')
                    .filter(|(k, _)| k.trim() == key)
                    .map(|(_, v)| v.trim().to_string())
            })
        };
        if let (Some(user), Some(pass)) = (get("AFFINMAIL_PG_USER"), get("AFFINMAIL_PG_PASSWORD")) {
            return Some((
                get("AFFINMAIL_PG_HOST").unwrap_or_else(|| "127.0.0.1".to_string()),
                get("AFFINMAIL_PG_PORT")
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(5432),
                get("AFFINMAIL_PG_DB").unwrap_or_else(|| "affinmail".to_string()),
                user,
                pass,
            ));
        }
    }
    let raw = std::fs::read_to_string(STALWART_CONFIG).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let host = match v.get("host")? {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.first()?.as_str()?.to_string(),
        _ => return None,
    };
    let port = v.get("port").and_then(|p| p.as_u64()).unwrap_or(5432) as u16;
    let db = v.get("database")?.as_str()?.to_string();
    let user = v.get("authUsername")?.as_str()?.to_string();
    // Only usable when the stored secret is a plain string.
    let pass = v.get("authSecret")?.as_str()?.to_string();
    Some((host, port, db, user, pass))
}

pub async fn pg_connect() -> Option<Client> {
    let (host, port, db, user, pass) = pg_params()?;
    let esc = pass.replace('\\', "\\\\").replace('\'', "\\'");
    let conn = format!(
        "host={} port={} dbname={} user={} password='{}' connect_timeout=5",
        host, port, db, user, esc
    );
    let (client, connection) = tokio_postgres::connect(&conn, tokio_postgres::NoTls)
        .await
        .ok()?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    Some(client)
}

fn stalwart_admin() -> Option<(String, String)> {
    let raw = std::fs::read_to_string(SECRETS_FILE).ok()?;
    let (mut user, mut pass) = (None, None);
    for line in raw.lines() {
        if let Some((k, val)) = line.split_once('=') {
            match k.trim() {
                "ADMIN_USER" => user = Some(val.trim().to_string()),
                "ADMIN_PASSWORD" => pass = Some(val.trim().to_string()),
                _ => {}
            }
        }
    }
    Some((user?, pass?))
}

/// Live queue depth + first items from Stalwart over JMAP.
async fn jmap_queue() -> Option<(i64, Vec<Value>)> {
    let (user, pass) = stalwart_admin()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let body = json!({
        "using": ["urn:stalwart:jmap"],
        "methodCalls": [["x:QueuedMessage/query", {"calculateTotal": true}, "0"]]
    });
    let resp = client
        .post("http://127.0.0.1:8080/jmap")
        .basic_auth(&user, Some(&pass))
        .json(&body)
        .send()
        .await
        .ok()?;
    let v: Value = resp.json().await.ok()?;
    let r = v.get("methodResponses")?.get(0)?.get(1)?;
    let total = r.get("total")?.as_i64()?;
    let ids: Vec<String> = r
        .get("ids")?
        .as_array()?
        .iter()
        .filter_map(|i| i.as_str().map(|s| s.to_string()))
        .take(5)
        .collect();
    let mut items = Vec::new();
    if !ids.is_empty() {
        let body2 = json!({
            "using": ["urn:stalwart:jmap"],
            "methodCalls": [["x:QueuedMessage/get", {"ids": ids}, "0"]]
        });
        if let Ok(resp2) = client
            .post("http://127.0.0.1:8080/jmap")
            .basic_auth(&user, Some(&pass))
            .json(&body2)
            .send()
            .await
        {
            if let Ok(v2) = resp2.json::<Value>().await {
                if let Some(list) = v2
                    .get("methodResponses")
                    .and_then(|m| m.get(0))
                    .and_then(|m| m.get(1))
                    .and_then(|m| m.get("list"))
                    .and_then(|l| l.as_array())
                {
                    for it in list {
                        items.push(map_queue_item(it));
                    }
                }
            }
        }
    }
    Some((total, items))
}

fn map_queue_item(it: &Value) -> Value {
    let to = it
        .get("recipients")
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .map(|r| {
            if let Some(s) = r.as_str() {
                s.to_string()
            } else {
                r.get("address")
                    .or_else(|| r.get("email"))
                    .and_then(|s| s.as_str())
                    .unwrap_or_default()
                    .to_string()
            }
        })
        .unwrap_or_default();
    json!({
        "id": it.get("id").cloned().unwrap_or(Value::Null),
        "from": it.get("sender").or_else(|| it.get("from")).and_then(|s| s.as_str()).unwrap_or_default(),
        "to": to,
        "subject": it.get("subject").and_then(|s| s.as_str()).unwrap_or_default(),
        "sizeBytes": it.get("size").and_then(|s| s.as_i64()).unwrap_or(0),
        "nextRetry": it.get("nextRetry").cloned().unwrap_or(Value::Null),
        "retries": it.get("retryCount").and_then(|s| s.as_i64()).unwrap_or(0),
    })
}

async fn probe_stalwart() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client.get("http://127.0.0.1:8080/").send().await.is_ok()
}

async fn probe_redis() -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let work = async {
        let mut s = tokio::net::TcpStream::connect("127.0.0.1:6379").await.ok()?;
        s.write_all(b"PING\r\n").await.ok()?;
        let mut buf = [0u8; 16];
        let n = s.read(&mut buf).await.ok()?;
        Some(buf[..n].starts_with(b"+PONG"))
    };
    tokio::time::timeout(Duration::from_secs(2), work)
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
}

fn disk_space() -> (i64, i64) {
    let out = std::process::Command::new("df")
        .args(["-B1", "--output=size,avail", "/"])
        .output();
    if let Ok(o) = out {
        let text = String::from_utf8_lossy(&o.stdout);
        if let Some(line) = text.lines().nth(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 {
                return (
                    parts[0].parse().unwrap_or(0),
                    parts[1].parse().unwrap_or(0),
                );
            }
        }
    }
    (0, 0)
}

fn mem_info() -> (i64, i64) {
    let mut total = 0i64;
    let mut avail = 0i64;
    if let Ok(text) = std::fs::read_to_string("/proc/meminfo") {
        for line in text.lines() {
            if let Some(v) = line.strip_prefix("MemTotal:") {
                total = v.trim().trim_end_matches(" kB").trim().parse().unwrap_or(0);
            }
            if let Some(v) = line.strip_prefix("MemAvailable:") {
                avail = v.trim().trim_end_matches(" kB").trim().parse().unwrap_or(0);
            }
        }
    }
    (total, avail)
}

fn load_avg() -> [f64; 3] {
    if let Ok(text) = std::fs::read_to_string("/proc/loadavg") {
        let p: Vec<f64> = text
            .split_whitespace()
            .take(3)
            .filter_map(|s| s.parse().ok())
            .collect();
        if p.len() == 3 {
            return [p[0], p[1], p[2]];
        }
    }
    [0.0, 0.0, 0.0]
}

fn uptime_sec() -> i64 {
    if let Ok(text) = std::fs::read_to_string("/proc/uptime") {
        if let Some(first) = text.split_whitespace().next() {
            return first.parse::<f64>().unwrap_or(0.0) as i64;
        }
    }
    0
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/* ------------------------------------------------------------------ */
/* Log parsing                                                         */
/* ------------------------------------------------------------------ */

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Skip until the terminating letter of the escape sequence.
            for n in chars.by_ref() {
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn extract_event(line: &str) -> Option<String> {
    let mut rest = line;
    while let Some(open) = rest.find('(') {
        let after = &rest[open + 1..];
        if let Some(close) = after.find(')') {
            let token = &after[..close];
            if !token.is_empty()
                && token
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
                && (token.contains('.') || token.starts_with("queue"))
            {
                return Some(token.to_string());
            }
        }
        rest = &rest[open + 1..];
    }
    None
}

fn extract_quoted(line: &str, key: &str) -> Option<String> {
    let pat = format!("{} = \"", key);
    let start = line.find(&pat)? + pat.len();
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

fn extract_first_recipient(line: &str) -> Option<String> {
    let start = line.find("to = [\"")? + 7;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

fn addr_domain(addr: &str) -> Option<String> {
    let d = addr.rsplit('@').next()?.trim().to_lowercase();
    // Bare hostnames without a dot are noise, not mail domains.
    if d.is_empty() || !d.contains('.') {
        return None;
    }
    Some(d)
}

/// Global counter kind for an event name (admin Overview taxonomy).
fn classify(event: &str) -> Option<&'static str> {
    match event {
        "queue.message-queued" | "queue.authenticated-message-queued" | "queue.autogenerated-queued" => {
            Some("queued")
        }
        "message-ingest.ham" => Some("delivered"),
        "message-ingest.spam" => Some("spam"),
        _ if event.starts_with("delivery.") => {
            if event.contains("fail") {
                Some("failed")
            } else if event.contains("defer") || event.contains("temp") {
                Some("deferred")
            } else if event.ends_with("delivered") {
                Some("delivered")
            } else {
                None
            }
        }
        _ => None,
    }
}

/* ------------------------------------------------------------------ */
/* Collector                                                           */
/* ------------------------------------------------------------------ */

#[derive(Default)]
struct CollectorState {
    files: HashMap<String, u64>,
}

fn load_state() -> CollectorState {
    if let Ok(raw) = std::fs::read_to_string(STATE_FILE) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            let mut files = HashMap::new();
            if let Some(obj) = v.get("files").and_then(|f| f.as_object()) {
                for (k, val) in obj {
                    if let Some(n) = val.as_u64() {
                        files.insert(k.clone(), n);
                    }
                }
            }
            return CollectorState { files };
        }
    }
    CollectorState::default()
}

fn save_state(state: &CollectorState) {
    let files: serde_json::Map<String, Value> = state
        .files
        .iter()
        .map(|(k, v)| (k.clone(), json!(v)))
        .collect();
    let _ = std::fs::write(
        STATE_FILE,
        serde_json::to_string(&json!({ "files": files })).unwrap_or_default(),
    );
}

pub async fn run_collector() {
    let mut first_run = !std::path::Path::new(STATE_FILE).exists();
    loop {
        if let Some(pg) = pg_connect().await {
            collect_logs(&pg, first_run).await;
            collect_sample(&pg).await;
            collect_rbl(&pg).await;
        }
        first_run = false;
        tokio::time::sleep(Duration::from_secs(300)).await;
    }
}

async fn collect_logs(pg: &Client, first_run: bool) {
    let _ = pg
        .execute(
            "CREATE TABLE IF NOT EXISTS stats_domain_events (
                hour timestamptz NOT NULL,
                domain text NOT NULL,
                kind text NOT NULL,
                count integer NOT NULL DEFAULT 0,
                PRIMARY KEY (hour, domain, kind)
            )",
            &[],
        )
        .await;

    let mut state = load_state();
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let yesterday = (Utc::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    let mut global: HashMap<(String, &'static str), i64> = HashMap::new();
    let mut domain: HashMap<(String, String, &'static str), i64> = HashMap::new();

    for day in [yesterday, today] {
        let name = format!("stalwart.log.{}", day);
        let path = format!("{}/{}", LOG_DIR, name);
        let data = match std::fs::read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let size = data.len() as u64;
        let stored = state.files.get(&name).copied();
        // On the very first run the global counters for these lines are
        // already in PostgreSQL (the previous collector wrote them), so
        // global parsing starts at EOF — but per-domain history is new,
        // so domain parsing backfills the whole file once.
        let (global_from, domain_from) = match stored {
            Some(off) if off <= size => (off, off),
            _ if first_run => (size, 0),
            _ => (0, 0),
        };

        let parse_range = |from: u64, global_side: bool, domain_side: bool,
                           global: &mut HashMap<(String, &'static str), i64>,
                           domain: &mut HashMap<(String, String, &'static str), i64>| {
            if from >= size {
                return;
            }
            let text = String::from_utf8_lossy(&data[from as usize..]);
            for raw_line in text.lines() {
                let line = strip_ansi(raw_line);
                if line.len() < 20 || !line.starts_with("20") {
                    continue;
                }
                let hour = format!("{}:00:00Z", &line[..13]);
                let event = match extract_event(&line) {
                    Some(e) => e,
                    None => continue,
                };
                if global_side {
                    if let Some(kind) = classify(&event) {
                        *global.entry((hour.clone(), kind)).or_insert(0) += 1;
                    }
                }
                if domain_side {
                    let from_d = extract_quoted(&line, "from")
                        .and_then(|a| addr_domain(&a));
                    let to_d = extract_first_recipient(&line)
                        .and_then(|a| addr_domain(&a));
                    let (dom, kind): (Option<String>, Option<&'static str>) = match event.as_str() {
                        "queue.message-queued"
                        | "queue.authenticated-message-queued"
                        | "queue.autogenerated-queued" => (from_d.clone(), Some("sent")),
                        "message-ingest.ham" => (to_d.clone(), Some("received")),
                        "message-ingest.spam" => (to_d.clone(), Some("spam")),
                        _ if event.starts_with("delivery.") => {
                            if event.contains("fail") {
                                (from_d.clone(), Some("failed"))
                            } else if event.contains("defer") || event.contains("temp") {
                                (from_d.clone(), Some("deferred"))
                            } else if event.ends_with("delivered") {
                                (from_d.clone(), Some("delivered"))
                            } else {
                                (None, None)
                            }
                        }
                        _ => (None, None),
                    };
                    if let (Some(d), Some(k)) = (dom, kind) {
                        *domain.entry((hour, d, k)).or_insert(0) += 1;
                    }
                }
            }
        };

        if first_run && stored.is_none() {
            parse_range(domain_from, false, true, &mut global, &mut domain);
            parse_range(global_from, true, false, &mut global, &mut domain);
        } else {
            parse_range(global_from, true, true, &mut global, &mut domain);
        }
        state.files.insert(name, size);
    }

    for ((hour, kind), count) in &global {
        let ts = chrono::DateTime::parse_from_rfc3339(hour)
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        if let Err(e) = pg
            .execute(
                "INSERT INTO stats_mail_events (hour, kind, count) VALUES ($1, $2, $3)
                 ON CONFLICT (hour, kind) DO UPDATE SET count = stats_mail_events.count + EXCLUDED.count",
                &[&ts, kind, &(*count as i32)],
            )
            .await
        {
            eprintln!("collector: global upsert failed: {e}");
        }
    }
    for ((hour, dom, kind), count) in &domain {
        let ts = chrono::DateTime::parse_from_rfc3339(hour)
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        if let Err(e) = pg
            .execute(
                "INSERT INTO stats_domain_events (hour, domain, kind, count) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (hour, domain, kind) DO UPDATE SET count = stats_domain_events.count + EXCLUDED.count",
                &[&ts, &dom.as_str(), kind, &(*count as i32)],
            )
            .await
        {
            eprintln!("collector: domain upsert failed: {e}");
        }
    }
    save_state(&state);
}

async fn mirror_totals(pg: &Client) -> (i64, i64, i64) {
    let row = pg
        .query_one(
            "SELECT (SELECT count(*) FROM domains),
                    (SELECT count(*) FROM mailboxes),
                    (SELECT coalesce(sum(quota_used_bytes), 0)::bigint FROM mailboxes)",
            &[],
        )
        .await;
    match row {
        Ok(r) => (r.get(0), r.get(1), r.get(2)),
        Err(_) => (0, 0, 0),
    }
}

async fn collect_sample(pg: &Client) {
    let queue_count: Option<i64> = match jmap_queue().await {
        Some((total, _)) => Some(total),
        None => None,
    };
    let (domains, mailboxes, storage) = mirror_totals(pg).await;
    let (disk_total, disk_free) = disk_space();
    let disk_pct: i32 = if disk_total > 0 {
        (((disk_total - disk_free) * 100) / disk_total) as i32
    } else {
        0
    };
    let (mem_total, mem_avail) = mem_info();
    let mem_pct: i32 = if mem_total > 0 {
        (((mem_total - mem_avail) * 100) / mem_total) as i32
    } else {
        0
    };
    let load1 = load_avg()[0];
    let svc_stalwart = probe_stalwart().await;
    let svc_redis = probe_redis().await;
    let rep: Option<f64> = pg
        .query_one(
            "SELECT reputation_score::float8 FROM ip_pools WHERE host(ip_address) = $1",
            &[&SERVER_IP],
        )
        .await
        .ok()
        .map(|r| r.get(0));
    // stats_samples columns are int / bigint / numeric / smallint, and
    // tokio-postgres has no numeric serializer — so interpolate these
    // internally-computed numbers directly (never user input).
    let num = |x: Option<f64>| x.map(|v| format!("{v}")).unwrap_or_else(|| "NULL".to_string());
    let sql = format!(
        "INSERT INTO stats_samples (queue_count, domains, mailboxes, storage_bytes, disk_pct, mem_pct, load1, rep_score, svc_stalwart, svc_pg, svc_redis)
         VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {}, 1, {})",
        num(queue_count.map(|q| q as f64)),
        domains,
        mailboxes,
        storage,
        disk_pct,
        mem_pct,
        load1,
        num(rep),
        if svc_stalwart { 1 } else { 0 },
        if svc_redis { 1 } else { 0 },
    );
    if let Err(e) = pg.execute(&sql, &[]).await {
        eprintln!("collector: sample insert failed: {e}");
    }
}

async fn collect_rbl(pg: &Client) {
    // Make sure the server's own sending IP has a pool row.
    let own: i64 = pg
        .query_one(
            "SELECT count(*) FROM ip_pools WHERE host(ip_address) = $1",
            &[&SERVER_IP],
        )
        .await
        .map(|r| r.get(0))
        .unwrap_or(0);
    if own == 0 {
        let _ = pg
            .execute(
                "INSERT INTO ip_pools (id, ip_address, ip_version, pool_type, rdns_hostname, is_active, reputation_score)
                 VALUES (gen_random_uuid(), inet($1), 4, 'dedicated', $2, true, 99.9)",
                &[&SERVER_IP, &SERVER_RDNS],
            )
            .await;
    }

    let rows = match pg
        .query("SELECT id::text, host(ip_address) FROM ip_pools WHERE is_active", &[])
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("collector: ip_pools query failed: {e}");
            return;
        }
    };
    for row in rows {
        let pool_id: String = row.get(0);
        let ip: String = row.get(1);
        let reversed = ip
            .split('.')
            .rev()
            .collect::<Vec<&str>>()
            .join(".");
        let mut listed_in: Vec<String> = Vec::new();
        for list in RBL_LISTS {
            let host = format!("{}.{}", reversed, list);
            let lookup = tokio::task::spawn_blocking(move || {
                (host.as_str(), 0u16)
                    .to_socket_addrs()
                    .ok()
                    .and_then(|mut it| it.next())
                    .map(|addr| addr.ip().to_string())
            })
            .await
            .ok()
            .flatten();
            // 127.255.255.x answers are resolver error codes, not listings.
            let (listed, code) = match lookup {
                Some(ref ip_str) if ip_str.starts_with("127.255.255.") => {
                    (false, Some(ip_str.clone()))
                }
                Some(ref ip_str) => (true, Some(ip_str.clone())),
                None => (false, None),
            };
            if listed {
                listed_in.push(list.to_string());
            }
            if let Err(e) = pg
                .execute(
                    "INSERT INTO ip_rbl_checks (ip_id, rbl_provider, is_listed, response_code) VALUES (($1 || '')::uuid, $2, $3, $4)",
                    &[&pool_id, &list, &listed, &code],
                )
                .await
            {
                eprintln!("collector: rbl check insert failed: {e:?}");
            }
        }
        let score = (99.9 - 25.0 * listed_in.len() as f64).clamp(0.0, 99.9);
        let blacklisted = !listed_in.is_empty();
        // blacklist_details is jsonb — pass a JSON value, not a string.
        let details: Option<Value> = if blacklisted {
            Some(json!(listed_in))
        } else {
            None
        };
        if let Err(e) = pg
            .execute(
                "UPDATE ip_pools SET reputation_score = $1::float8::numeric, is_blacklisted = $2, blacklist_details = $3, updated_at = now() WHERE id = ($4 || '')::uuid",
                &[&score, &blacklisted, &details, &pool_id],
            )
            .await
        {
            eprintln!("collector: pool update failed: {e:?}");
        }
    }
}

/* ------------------------------------------------------------------ */
/* Admin Overview payload (GET /api/v1/stats)                          */
/* ------------------------------------------------------------------ */

fn last_backup() -> Value {
    let mut best: Option<(std::time::SystemTime, String, u64)> = None;
    if let Ok(entries) = std::fs::read_dir(BACKUP_DIR) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".sql.gz") {
                continue;
            }
            if let Ok(meta) = e.metadata() {
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                if best.as_ref().map(|(t, _, _)| mtime > *t).unwrap_or(true) {
                    best = Some((mtime, name, meta.len()));
                }
            }
        }
    }
    match best {
        Some((t, name, size)) => {
            let at: chrono::DateTime<Utc> = t.into();
            json!({ "file": name, "sizeBytes": size, "at": at.to_rfc3339() })
        }
        None => Value::Null,
    }
}

fn empty_history() -> Value {
    json!({
        "mailDaily": [],
        "queueSeries": [],
        "repSeries": [],
        "uptime24h": { "stalwart": null, "postgres": null, "redis": null },
        "ips": []
    })
}

pub async fn admin_stats(state: &AppState) -> Value {
    let pg = match pg_connect().await {
        Some(p) => p,
        None => {
            return json!({
                "overview": {
                    "total_domains": state.domains.read().unwrap().len(),
                    "total_mailboxes": state.mailboxes.read().unwrap().len(),
                    "queue_depth": state.queue.read().unwrap().len(),
                    "ip_pools_count": state.ip_pools.read().unwrap().len()
                },
                "history": empty_history(),
                "byDomain": [],
                "topMailboxes": [],
                "recentMailboxes": [],
                "recentDomains": [],
                "newMailboxes7d": 0,
                "queue": { "count": 0, "items": [] },
                "server": { "diskTotal": 0, "diskFree": 0, "memTotalKb": 0, "memAvailKb": 0, "load": [0.0, 0.0, 0.0], "uptimeSec": 0 },
                "lastBackup": Value::Null
            });
        }
    };

    // --- mail flow, last 8 Dhaka days ---------------------------------
    let mut per_day: HashMap<String, HashMap<String, i64>> = HashMap::new();
    if let Ok(rows) = pg
        .query(
            "SELECT to_char((hour + interval '6 hours')::date, 'YYYY-MM-DD') AS day, kind, sum(count)::bigint AS c
             FROM stats_mail_events WHERE hour >= now() - interval '9 days' GROUP BY 1, 2",
            &[],
        )
        .await
    {
        for r in rows {
            let day: String = r.get(0);
            let kind: String = r.get(1);
            let c: i64 = r.get(2);
            *per_day.entry(day).or_default().entry(kind).or_insert(0) += c;
        }
    }
    let today_dhaka = (Utc::now() + chrono::Duration::hours(6)).date_naive();
    let mut mail_daily: Vec<Value> = Vec::new();
    for back in (0..8).rev() {
        let day = (today_dhaka - chrono::Duration::days(back)).format("%Y-%m-%d").to_string();
        let kinds = per_day.get(&day);
        let get = |k: &str| kinds.and_then(|m| m.get(k)).copied().unwrap_or(0);
        let (queued, delivered, failed, deferred, spam) = (
            get("queued"),
            get("delivered"),
            get("failed"),
            get("deferred"),
            get("spam"),
        );
        let rate = if delivered + failed > 0 {
            json!(round1(delivered as f64 * 100.0 / (delivered + failed) as f64))
        } else {
            Value::Null
        };
        mail_daily.push(json!({
            "day": day, "queued": queued, "delivered": delivered,
            "failed": failed, "deferred": deferred, "spam": spam, "rate": rate
        }));
    }
    let today_kinds = per_day
        .get(&today_dhaka.format("%Y-%m-%d").to_string())
        .cloned()
        .unwrap_or_default();

    // --- queue + service series, last 25h ------------------------------
    let mut queue_series: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS ts,
                    queue_count, svc_stalwart, svc_pg, svc_redis
             FROM stats_samples WHERE ts > now() - interval '25 hours' ORDER BY ts",
            &[],
        )
        .await
    {
        for r in rows {
            let ts: String = r.get(0);
            let q: Option<i32> = r.get(1);
            // svc_* columns are smallint 0/1, not boolean.
            let s1: Option<i16> = r.get(2);
            let s2: Option<i16> = r.get(3);
            let s3: Option<i16> = r.get(4);
            queue_series.push(json!({
                "ts": ts, "queue": q,
                "svc": [
                    s1.unwrap_or(0) != 0,
                    s2.unwrap_or(0) != 0,
                    s3.unwrap_or(0) != 0
                ]
            }));
        }
    }

    // --- reputation series + 24h uptime --------------------------------
    let mut rep_series: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT to_char((ts + interval '6 hours')::date, 'YYYY-MM-DD') AS day, avg(rep_score)::float8 AS s
             FROM stats_samples WHERE ts > now() - interval '7 days' AND rep_score IS NOT NULL GROUP BY 1 ORDER BY 1",
            &[],
        )
        .await
    {
        for r in rows {
            let day: String = r.get(0);
            let s: f64 = r.get(1);
            rep_series.push(json!({ "ts": day, "score": round1(s) }));
        }
    }
    let mut uptime = json!({ "stalwart": null, "postgres": null, "redis": null });
    if let Ok(rows) = pg
        .query(
            "SELECT (avg(CASE WHEN svc_stalwart <> 0 THEN 1.0 ELSE 0.0 END) * 100)::float8,
                    (avg(CASE WHEN svc_pg <> 0 THEN 1.0 ELSE 0.0 END) * 100)::float8,
                    (avg(CASE WHEN svc_redis <> 0 THEN 1.0 ELSE 0.0 END) * 100)::float8
             FROM stats_samples WHERE ts > now() - interval '24 hours'",
            &[],
        )
        .await
    {
        if let Some(r) = rows.into_iter().next() {
            let a: Option<f64> = r.get(0);
            let b: Option<f64> = r.get(1);
            let c: Option<f64> = r.get(2);
            uptime = json!({
                "stalwart": a.map(round1),
                "postgres": b.map(round1),
                "redis": c.map(round1)
            });
        }
    }

    // --- IP pools -------------------------------------------------------
    let mut ips: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT host(p.ip_address), p.reputation_score::float8, p.is_blacklisted,
                    (SELECT count(*) FROM ip_rbl_checks c WHERE c.ip_id = p.id AND c.is_listed AND c.checked_at > now() - interval '1 hour')::bigint,
                    (SELECT to_char(max(c.checked_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM ip_rbl_checks c WHERE c.ip_id = p.id)
             FROM ip_pools p WHERE p.is_active ORDER BY p.ip_address",
            &[],
        )
        .await
    {
        for r in rows {
            ips.push(json!({
                "ip": r.get::<_, String>(0),
                "score": round1(r.get::<_, f64>(1)),
                "blacklisted": r.get::<_, bool>(2),
                "listedNow": r.get::<_, i64>(3),
                "lastChecked": r.get::<_, Option<String>>(4)
            }));
        }
    }

    // --- storage by domain / top mailboxes ------------------------------
    let mut by_domain: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT d.domain_name, count(m.id)::bigint, coalesce(sum(m.quota_used_bytes), 0)::bigint, d.disk_quota_mb::bigint
             FROM domains d LEFT JOIN mailboxes m ON m.domain_id = d.id
             GROUP BY d.domain_name, d.disk_quota_mb ORDER BY 3 DESC",
            &[],
        )
        .await
    {
        for r in rows {
            by_domain.push(json!({
                "domain": r.get::<_, String>(0),
                "mailboxes": r.get::<_, i64>(1),
                "usedBytes": r.get::<_, i64>(2),
                "quotaMb": r.get::<_, i64>(3)
            }));
        }
    }
    let mut top_mailboxes: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT m.email, d.domain_name, m.quota_used_bytes::bigint, m.quota_limit_mb::bigint
             FROM mailboxes m JOIN domains d ON d.id = m.domain_id
             ORDER BY m.quota_used_bytes DESC LIMIT 8",
            &[],
        )
        .await
    {
        for r in rows {
            top_mailboxes.push(json!({
                "email": r.get::<_, String>(0),
                "domain": r.get::<_, String>(1),
                "usedBytes": r.get::<_, i64>(2),
                "quotaMb": r.get::<_, i64>(3)
            }));
        }
    }
    let mut recent_mailboxes: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT m.email, d.domain_name, to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             FROM mailboxes m JOIN domains d ON d.id = m.domain_id ORDER BY m.created_at DESC LIMIT 6",
            &[],
        )
        .await
    {
        for r in rows {
            recent_mailboxes.push(json!({
                "email": r.get::<_, String>(0),
                "domain": r.get::<_, String>(1),
                "createdAt": r.get::<_, String>(2)
            }));
        }
    }
    let mut recent_domains: Vec<Value> = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT domain_name, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             FROM domains ORDER BY created_at DESC LIMIT 6",
            &[],
        )
        .await
    {
        for r in rows {
            recent_domains.push(json!({
                "domain": r.get::<_, String>(0),
                "createdAt": r.get::<_, String>(1)
            }));
        }
    }
    let new_mailboxes_7d: i64 = pg
        .query_one(
            "SELECT count(*) FROM mailboxes WHERE created_at > now() - interval '7 days'",
            &[],
        )
        .await
        .map(|r| r.get(0))
        .unwrap_or(0);
    let (domains_total, mailboxes_total, storage_total) = mirror_totals(&pg).await;
    let pools_total: i64 = pg
        .query_one("SELECT count(*) FROM ip_pools WHERE is_active", &[])
        .await
        .map(|r| r.get(0))
        .unwrap_or(0);

    // --- live queue ------------------------------------------------------
    let (queue_count, queue_items) = match jmap_queue().await {
        Some((t, items)) => (t, items),
        None => {
            let last: Option<i64> = pg
                .query_one(
                    "SELECT queue_count FROM stats_samples ORDER BY ts DESC LIMIT 1",
                    &[],
                )
                .await
                .ok()
                .and_then(|r| r.get(0));
            (last.unwrap_or(0), Vec::new())
        }
    };

    let (disk_total, disk_free) = disk_space();
    let (mem_total, mem_avail) = mem_info();
    let load = load_avg();

    json!({
        "overview": {
            "total_domains": domains_total,
            "total_mailboxes": mailboxes_total,
            "total_accounts": mailboxes_total,
            "active_users": mailboxes_total,
            "queue_depth": queue_count,
            "ip_pools_count": pools_total,
            "storage_consumed_mb": storage_total / 1_048_576,
            "emails_sent_today": today_kinds.get("queued").copied().unwrap_or(0),
            "emails_received_today": today_kinds.get("delivered").copied().unwrap_or(0)
        },
        "history": {
            "mailDaily": mail_daily,
            "queueSeries": queue_series,
            "repSeries": rep_series,
            "uptime24h": uptime,
            "ips": ips
        },
        "byDomain": by_domain,
        "topMailboxes": top_mailboxes,
        "recentMailboxes": recent_mailboxes,
        "recentDomains": recent_domains,
        "newMailboxes7d": new_mailboxes_7d,
        "queue": { "count": queue_count, "items": queue_items },
        "server": {
            "diskTotal": disk_total,
            "diskFree": disk_free,
            "memTotalKb": mem_total,
            "memAvailKb": mem_avail,
            "load": [load[0], load[1], load[2]],
            "uptimeSec": uptime_sec()
        },
        "lastBackup": last_backup()
    })
}

/* ------------------------------------------------------------------ */
/* Self-service payload (GET /api/v1/client/domains/{domain}/stats)    */
/* ------------------------------------------------------------------ */

pub async fn domain_stats(domain: &str) -> Value {
    let domain = domain.to_lowercase();
    let pg = match pg_connect().await {
        Some(p) => p,
        None => {
            return json!({
                "domain": domain,
                "days": [],
                "totals": { "sent": 0, "received": 0, "delivered": 0, "failed": 0, "deferred": 0, "spam": 0, "rate": null },
                "mailboxes": 0, "storageBytes": 0, "storageQuotaBytes": 0,
                "reputation": null
            });
        }
    };

    let mut per_day: HashMap<String, HashMap<String, i64>> = HashMap::new();
    if let Ok(rows) = pg
        .query(
            "SELECT to_char((hour + interval '6 hours')::date, 'YYYY-MM-DD') AS day, kind, sum(count)::bigint AS c
             FROM stats_domain_events WHERE domain = $1 AND hour >= now() - interval '8 days' GROUP BY 1, 2",
            &[&domain],
        )
        .await
    {
        for r in rows {
            let day: String = r.get(0);
            let kind: String = r.get(1);
            let c: i64 = r.get(2);
            *per_day.entry(day).or_default().entry(kind).or_insert(0) += c;
        }
    }
    let today_dhaka = (Utc::now() + chrono::Duration::hours(6)).date_naive();
    let mut days: Vec<Value> = Vec::new();
    let mut totals: HashMap<String, i64> = HashMap::new();
    for back in (0..7).rev() {
        let day = (today_dhaka - chrono::Duration::days(back))
            .format("%Y-%m-%d")
            .to_string();
        let kinds = per_day.get(&day);
        let get = |k: &str| kinds.and_then(|m| m.get(k)).copied().unwrap_or(0);
        let row = json!({
            "day": day,
            "sent": get("sent"),
            "received": get("received"),
            "delivered": get("delivered"),
            "failed": get("failed"),
            "deferred": get("deferred"),
            "spam": get("spam")
        });
        for k in ["sent", "received", "delivered", "failed", "deferred", "spam"] {
            *totals.entry(k.to_string()).or_insert(0) += get(k);
        }
        days.push(row);
    }
    let (delivered, failed) = (
        totals.get("delivered").copied().unwrap_or(0),
        totals.get("failed").copied().unwrap_or(0),
    );
    let rate = if delivered + failed > 0 {
        json!(round1(delivered as f64 * 100.0 / (delivered + failed) as f64))
    } else {
        Value::Null
    };

    let (mailboxes, storage_bytes, storage_quota_bytes) = pg
        .query_one(
            "SELECT count(*)::bigint, coalesce(sum(m.quota_used_bytes), 0)::bigint,
                    coalesce(sum(m.quota_limit_mb), 0)::bigint * 1048576
             FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE d.domain_name = $1",
            &[&domain],
        )
        .await
        .map(|r| {
            (
                r.get::<_, i64>(0),
                r.get::<_, i64>(1),
                r.get::<_, i64>(2),
            )
        })
        .unwrap_or((0, 0, 0));

    let reputation = pg
        .query_opt(
            "SELECT p.reputation_score::float8, p.is_blacklisted FROM domains d
             JOIN ip_pools p ON p.id = d.assigned_ip_id WHERE d.domain_name = $1",
            &[&domain],
        )
        .await
        .ok()
        .flatten()
        .map(|r| json!({ "score": round1(r.get::<_, f64>(0)), "blacklisted": r.get::<_, bool>(1) }));

    // Fall back to the server's own sending-IP reputation when the domain
    // has no dedicated pool assigned.
    let reputation = match reputation {
        Some(rep) => rep,
        None => pg
            .query_one(
                "SELECT reputation_score::float8, is_blacklisted FROM ip_pools WHERE host(ip_address) = $1",
                &[&SERVER_IP],
            )
            .await
            .map(|r| json!({ "score": round1(r.get::<_, f64>(0)), "blacklisted": r.get::<_, bool>(1) }))
            .unwrap_or(Value::Null),
    };

    json!({
        "domain": domain,
        "days": days,
        "totals": {
            "sent": totals.get("sent").copied().unwrap_or(0),
            "received": totals.get("received").copied().unwrap_or(0),
            "delivered": delivered,
            "failed": failed,
            "deferred": totals.get("deferred").copied().unwrap_or(0),
            "spam": totals.get("spam").copied().unwrap_or(0),
            "rate": rate
        },
        "mailboxes": mailboxes,
        "storageBytes": storage_bytes,
        "storageQuotaBytes": storage_quota_bytes,
        "reputation": reputation
    })
}
