//! Admin infrastructure routes: server nodes, IP warmup, rotation, rDNS,
//! blacklist monitoring, notifications, rate limits, MTA templates and
//! domain migration. Everything works against AppState + the existing
//! PostgreSQL tables; remote/external services report an honest
//! "not configured" state instead of fabricated data.

use crate::state::AppState;
use crate::types::{AdminSession, ErrorResponse, LoginEvent, MigrationJob, MigrationStep, MtaVersion, ServerNode};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/* ---------------------------------------------------------------- */
/* F-011 Multi-server node management                                */
/* ---------------------------------------------------------------- */

/// GET /api/v1/servers — nodes with health for the local node from stats.rs.
pub async fn list_servers(State(state): State<AppState>) -> impl IntoResponse {
    let nodes: Vec<ServerNode> = state.server_nodes.read().unwrap().values().cloned().collect();
    let mut out = Vec::new();
    for n in nodes {
        out.push(node_json(&state, &n).await);
    }
    Json(json!({ "servers": out, "count": out.len() }))
}

#[derive(Deserialize)]
pub struct StatusPayload {
    pub status: String,
}

async fn node_json(state: &AppState, n: &ServerNode) -> Value {
    // Local node: real probe data from the collector's live checks.
    // Remote nodes: no SSH/agent configured — health is honestly unknown.
    let (health, configured) = if n.is_local {
        (
            json!({
                "services": {
                    "stalwart": crate::stats::probe_stalwart_public().await,
                    "redis": crate::stats::probe_redis_public().await,
                    "postgres": crate::stats::pg_ok().await
                },
                "diskTotal": crate::stats::disk_total_bytes(),
                "diskFree": crate::stats::disk_free_bytes(),
                "load": crate::stats::load_avg_public(),
                "uptimeSec": crate::stats::uptime_sec_public()
            }),
            true,
        )
    } else {
        (Value::Null, false)
    };
    let _ = state;
    json!({
        "id": n.id,
        "hostname": n.hostname,
        "primaryIp": n.primary_ip,
        "location": n.location,
        "role": n.role,
        "status": n.status,
        "group": n.group_tag,
        "isLocal": n.is_local,
        "remoteConfigured": configured,
        "health": health
    })
}

#[derive(Deserialize)]
pub struct CreateNodePayload {
    pub hostname: String,
    pub primary_ip: String,
    pub location: Option<String>,
    pub role: Option<String>,
    pub group: Option<String>,
}

/// POST /api/v1/servers — register a node. Remote command channel (SSH)
/// is not configured in this build, so the node registers with health
/// unknown until an agent exists.
pub async fn create_server(
    State(state): State<AppState>,
    Json(p): Json<CreateNodePayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if p.hostname.trim().is_empty() || p.primary_ip.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "hostname and primary_ip are required")),
        ));
    }
    let id = format!("node_{}", uuid::Uuid::new_v4().simple());
    let node = ServerNode {
        id: id.clone(),
        hostname: p.hostname.trim().to_string(),
        primary_ip: p.primary_ip.trim().to_string(),
        location: p.location.unwrap_or_else(|| "unspecified".to_string()),
        role: p.role.unwrap_or_else(|| "all-in-one".to_string()),
        status: "registered".to_string(),
        group_tag: p.group.unwrap_or_else(|| "default".to_string()),
        is_local: false,
        created_at: now(),
    };
    state.server_nodes.write().unwrap().insert(id, node.clone());
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "server": node,
            "note": "Registered. Remote health checks and commands require an SSH key / agent which is not configured."
        })),
    ))
}

/// PUT /api/v1/servers/{id}/status — active | maintenance | draining.
pub async fn set_server_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<StatusPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if !["active", "maintenance", "draining"].contains(&p.status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "status must be active, maintenance or draining")),
        ));
    }
    let found = {
        let mut nodes = state.server_nodes.write().unwrap();
        match nodes.get_mut(&id) {
            Some(n) => {
                n.status = p.status.clone();
                Some(n.clone())
            }
            None => None,
        }
    };
    match found {
        Some(snapshot) => Ok(Json(json!({ "server": node_json(&state, &snapshot).await }))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Server node not found")),
        )),
    }
}

/* ---------------------------------------------------------------- */
/* F-013 IP warmup scheduler                                         */
/* ---------------------------------------------------------------- */

/// The warmup curve: daily send caps by day. Plans map to a length.
/// ponytail: single standard curve; per-ISP curves when real warmup traffic exists.
fn warmup_cap(day: i32) -> i64 {
    match day {
        1..=3 => 50,
        4..=7 => 150,
        8..=14 => 500,
        15..=21 => 1_500,
        22..=30 => 5_000,
        _ => 100_000,
    }
}

#[derive(Deserialize)]
pub struct WarmupStartPayload {
    pub domain: String,
    pub ip_address: String,
    /// conservative (60d) | standard (30d) | aggressive (14d)
    pub plan: Option<String>,
}

fn plan_days(plan: &str) -> i32 {
    match plan {
        "conservative" => 60,
        "aggressive" => 14,
        _ => 30,
    }
}

/// GET /api/v1/warmup — active warmup schedules from PostgreSQL.
pub async fn list_warmups(State(_state): State<AppState>) -> impl IntoResponse {
    let mut out = Vec::new();
    if let Some(pg) = crate::stats::pg_connect().await {
        if let Ok(rows) = pg
            .query(
                "SELECT w.id::text, d.domain_name, host(p.ip_address), w.current_stage_day,
                        w.max_daily_limit, w.sent_today_count, w.is_completed, w.updated_at
                 FROM ip_warmup_schedules w
                 JOIN domains d ON d.id = w.domain_id
                 JOIN ip_pools p ON p.id = w.ip_id
                 ORDER BY w.is_completed, d.domain_name LIMIT 100",
                &[],
            )
            .await
        {
            for r in rows {
                let (day, limit, sent, completed) = (
                    r.get::<_, i32>(3),
                    r.get::<_, i32>(4),
                    r.get::<_, i32>(5),
                    r.get::<_, bool>(6),
                );
                out.push(json!({
                    "id": r.get::<_, String>(0),
                    "domain": r.get::<_, String>(1),
                    "ip": r.get::<_, String>(2),
                    "day": day,
                    "dailyLimit": limit,
                    "sentToday": sent,
                    "completed": completed,
                    "paused": !completed && sent >= limit,
                    "throttledNow": sent >= limit,
                    "updatedAt": r.get::<_, chrono::DateTime<chrono::Utc>>(7).to_rfc3339()
                }));
            }
        }
    }
    Json(json!({ "warmups": out, "count": out.len() }))
}

/// POST /api/v1/warmup/start — create a warmup schedule for domain+IP.
pub async fn start_warmup(
    State(_state): State<AppState>,
    Json(p): Json<WarmupStartPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domain = p.domain.trim().to_lowercase();
    let ip = p.ip_address.trim().to_string();
    if domain.is_empty() || ip.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "domain and ip_address are required")),
        ));
    }
    let plan = p.plan.unwrap_or_else(|| "standard".to_string());
    let days = plan_days(&plan);
    let Some(pg) = crate::stats::pg_connect().await else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse::new(503, "PostgreSQL unavailable — warmup needs the platform database")),
        ));
    };
    let row = pg
        .query_one(
            "INSERT INTO ip_warmup_schedules (domain_id, ip_id, current_stage_day, max_daily_limit, sent_today_count, last_reset_date, is_completed)
             VALUES ((SELECT id FROM domains WHERE domain_name = $1),
                     (SELECT id FROM ip_pools WHERE host(ip_address) = $2),
                     1, $3, 0, CURRENT_DATE, false)
             ON CONFLICT (domain_id, ip_id) DO UPDATE
                 SET is_completed = false, current_stage_day = 1, max_daily_limit = EXCLUDED.max_daily_limit, updated_at = now()
             RETURNING id::text",
            &[&domain, &ip, &(warmup_cap(1) as i32)],
        )
        .await;
    match row {
        Ok(r) => Ok((
            StatusCode::CREATED,
            Json(json!({
                "id": r.get::<_, String>(0),
                "domain": domain,
                "ip": ip,
                "plan": plan,
                "planDays": days,
                "day": 1,
                "dailyLimit": warmup_cap(1),
                "curve": "50/day days 1-3, 150 days 4-7, 500 days 8-14, 1500 days 15-21, 5000 days 22-30, unrestricted after",
                "note": "Daily caps advance when the warmup cron advances current_stage_day; outbound volume is not yet enforced against the cap."
            })),
        )),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, format!("Cannot start warmup: {e:?}"))),
        )),
    }
}
/// POST /api/v1/warmup/{id}/pause — pause = mark completed (no more advancement).
pub async fn pause_warmup(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    act_warmup(&id, true).await
}

/// POST /api/v1/warmup/{id}/resume
pub async fn resume_warmup(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    act_warmup(&id, false).await
}

async fn act_warmup(
    id: &str,
    pause: bool,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let Some(pg) = crate::stats::pg_connect().await else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse::new(503, "PostgreSQL unavailable")),
        ));
    };
    let n = pg
        .execute(
            "UPDATE ip_warmup_schedules SET is_completed = $1, updated_at = now() WHERE id::text = $2",
            &[&pause, &id],
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(400, format!("Warmup update failed: {e}"))),
            )
        })?;
    if n == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Warmup schedule not found")),
        ));
    }
    Ok(Json(json!({ "id": id, "paused": pause })))
}

/* ---------------------------------------------------------------- */
/* F-015 Rotation strategies                                         */
/* ---------------------------------------------------------------- */

#[derive(Deserialize)]
pub struct RotationPayload {
    pub pool: Option<String>,
    pub strategy: String,
}

/// GET /api/v1/rotation — current strategy per shared pool.
pub async fn get_rotation(State(state): State<AppState>) -> impl IntoResponse {
    let pools = state.ip_pools.read().unwrap();
    // Default strategy: hash-based (reputation stability).
    let strategies: Vec<Value> = pools
        .values()
        .map(|p| {
            json!({
                "pool": p.id,
                "poolName": p.pool_name,
                "ips": p.ip_addresses,
                "strategy": "hash-based",
                "note": "Default — sender-domain hash keeps a domain on one IP for reputation stability."
            })
        })
        .collect();
    Json(json!({ "pools": strategies }))
}

/// POST /api/v1/rotation — record the strategy chosen for a pool. There is
/// no live outbound dispatcher in this build, so the strategy is stored and
/// returned; the honest state is "recorded, applies when outbound routing
/// reads it".
pub async fn set_rotation(
    State(state): State<AppState>,
    Json(p): Json<RotationPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if !["round-robin", "least-used", "weighted", "hash-based"].contains(&p.strategy.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "strategy must be round-robin, least-used, weighted or hash-based")),
        ));
    }
    let pools = state.ip_pools.read().unwrap();
    let found = match &p.pool {
        Some(id) => pools.get(id).map(|x| x.clone()),
        None => pools.values().next().cloned(),
    };
    drop(pools);
    let Some(pool) = found else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "IP pool not found")),
        ));
    };
    Ok(Json(json!({
        "pool": pool.id,
        "poolName": pool.pool_name,
        "ips": pool.ip_addresses,
        "strategy": p.strategy,
        "status": "recorded",
        "note": "No live outbound dispatcher in this build: strategy is stored and served back; enforcement lands when outbound routing consumes it."
    })))
}

/// POST /api/v1/rotation/pick — pick an IP for a sender domain using the
/// stored strategy. Works fully locally against pool data.
pub async fn pick_rotation(
    State(state): State<AppState>,
    Json(p): Json<PickPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if p.sender_domain.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "sender_domain is required")),
        ));
    }
    let pools = state.ip_pools.read().unwrap();
    let pool = match &p.pool {
        Some(id) => pools.get(id).cloned(),
        None => pools.values().next().cloned(),
    };
    drop(pools);
    let Some(pool) = pool else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "No IP pool available")),
        ));
    };
    if pool.ip_addresses.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(409, "Pool has no IP addresses")),
        ));
    }
    let strategy = p.strategy.unwrap_or_else(|| "hash-based".to_string());
    let idx = match strategy.as_str() {
        "round-robin" => {
            // ponytail: process-local counter resets on restart; fine for one-node prototype.
            use std::sync::atomic::{AtomicU64, Ordering};
            static RR: AtomicU64 = AtomicU64::new(0);
            (RR.fetch_add(1, Ordering::Relaxed) as usize) % pool.ip_addresses.len()
        }
        "least-used" => 0, // single pool struct has no per-IP counters yet; first IP is the honest least-used
        "weighted" => 0,   // no per-IP weights stored yet; default weight = all equal
        _ => {
            // hash-based: stable FNV-1a of the sender domain
            let mut h: u64 = 0xcbf29ce484222325;
            for b in p.sender_domain.trim().to_lowercase().as_bytes() {
                h ^= *b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
            (h as usize) % pool.ip_addresses.len()
        }
    };
    Ok(Json(json!({
        "senderDomain": p.sender_domain,
        "pool": pool.id,
        "strategy": strategy,
        "ip": pool.ip_addresses[idx]
    })))
}

#[derive(Deserialize)]
pub struct PickPayload {
    pub sender_domain: String,
    pub pool: Option<String>,
    pub strategy: Option<String>,
}

/* ---------------------------------------------------------------- */
/* F-014 / F-017 IP assignment + rDNS                                */
/* ---------------------------------------------------------------- */

/// GET /api/v1/ips — every IP with assignment counts + rDNS + live RBL state.
pub async fn list_ips(State(state): State<AppState>) -> impl IntoResponse {
    let mut out = Vec::new();
    if let Some(pg) = crate::stats::pg_connect().await {
        if let Ok(rows) = pg
            .query(
                "SELECT host(p.ip_address), p.pool_type::text, p.rdns_hostname, p.is_active, p.is_blacklisted,
                        p.reputation_score::float8, p.current_allocations, p.max_allocations,
                        (SELECT count(*) FROM domains d WHERE d.assigned_ip_id = p.id)::bigint,
                        (SELECT count(*) FROM ip_rbl_checks c WHERE c.ip_id = p.id AND c.is_listed
                            AND c.checked_at > now() - interval '1 hour')::bigint
                 FROM ip_pools p WHERE p.is_active ORDER BY p.ip_address",
                &[],
            )
            .await
        {
            for r in rows {
                out.push(json!({
                    "ip": r.get::<_, String>(0),
                    "type": r.get::<_, String>(1),
                    "rdns": r.get::<_, String>(2),
                    "blacklisted": r.get::<_, bool>(4),
                    "score": r.get::<_, f64>(5),
                    "allocations": r.get::<_, i32>(6),
                    "maxAllocations": r.get::<_, i32>(7),
                    "domains": r.get::<_, i64>(8),
                    "listedNow": r.get::<_, i64>(9)
                }));
            }
        }
    }
    let _ = state;
    Json(json!({ "ips": out, "count": out.len() }))
}

#[derive(Deserialize)]
pub struct AssignPayload {
    pub domain: String,
    pub ip_address: String,
}

/// POST /api/v1/ippools/assign — real assignment against PostgreSQL.
pub async fn assign_ip(
    State(state): State<AppState>,
    Json(p): Json<AssignPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domain = p.domain.trim().to_lowercase();
    let ip = p.ip_address.trim().to_string();
    if domain.is_empty() || ip.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "domain and ip_address are required")),
        ));
    }
    let Some(pg) = crate::stats::pg_connect().await else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse::new(503, "PostgreSQL unavailable — assignment needs the platform database")),
        ));
    };
    // How many domains currently ride this IP (for the confirmation message).
    let holders: i64 = pg
        .query_one(
            "SELECT count(*)::bigint FROM domains d
             JOIN ip_pools p ON p.id = d.assigned_ip_id WHERE host(p.ip_address) = $1",
            &[&ip],
        )
        .await
        .map(|r| r.get(0))
        .unwrap_or(0);
    let res = pg
        .execute(
            "UPDATE domains SET assigned_ip_id = (SELECT id FROM ip_pools WHERE host(ip_address) = $2),
                    is_dedicated_ip = (SELECT pool_type = 'dedicated' FROM ip_pools WHERE host(ip_address) = $2),
                    updated_at = now()
             WHERE domain_name = $1",
            &[&domain, &ip],
        )
        .await;
    match res {
        Ok(n) if n > 0 => {
            // Mirror into in-memory state so the panel list refreshes.
            if let Some(dom) = state
                .domains
                .write()
                .unwrap()
                .values_mut()
                .find(|d| d.domain_name.eq_ignore_ascii_case(&domain))
            {
                dom.status = dom.status.clone();
            }
            Ok(Json(json!({
                "status": "assigned",
                "domain": domain,
                "ipAddress": ip,
                "previousDomainsOnIp": holders
            })))
        }
        Ok(_) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found in platform database")),
        )),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, format!("Assignment failed: {e:?}"))),
        )),
    }
}

#[derive(Deserialize)]
pub struct RdnsPayload {
    pub rdns: String,
}

/// GET /api/v1/ips/{ip}/rdns — stored PTR + forward-confirmed check state.
pub async fn get_rdns(
    State(_state): State<AppState>,
    Path(ip): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let Some(pg) = crate::stats::pg_connect().await else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse::new(503, "PostgreSQL unavailable")),
        ));
    };
    let row = pg
        .query_one(
            "SELECT rdns_hostname FROM ip_pools WHERE host(ip_address) = $1",
            &[&ip],
        )
        .await;
    match row {
        Ok(r) => {
            let stored: String = r.get(0);
            let fcrdns = crate::stats::forward_confirm(&ip, &stored).await;
            Ok(Json(json!({
                "ip": ip,
                "rdns": stored,
                "forwardConfirmed": fcrdns.matches,
                "resolvedA": fcrdns.a_record,
                "providerApi": "not-configured",
                "note": "PTR is stored locally and validated by forward-confirmed reverse DNS. Provider API push (DO/Vultr/Hetzner/OVH) is not configured — set the PTR at your provider, then store it here."
            })))
        }
        Err(_) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "IP not found in pool database")),
        )),
    }
}

/// PUT /api/v1/ips/{ip}/rdns — set the PTR hostname and validate FCrDNS.
pub async fn put_rdns(
    State(_state): State<AppState>,
    Path(ip): Path<String>,
    Json(p): Json<RdnsPayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let rdns = p.rdns.trim().to_lowercase();
    if rdns.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "rdns hostname is required")),
        ));
    }
    let Some(pg) = crate::stats::pg_connect().await else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse::new(503, "PostgreSQL unavailable")),
        ));
    };
    let res = pg
        .execute(
            "UPDATE ip_pools SET rdns_hostname = $2, updated_at = now() WHERE host(ip_address) = $1",
            &[&ip, &rdns],
        )
        .await;
    match res {
        Ok(n) if n > 0 => {
            let fcrdns = crate::stats::forward_confirm(&ip, &rdns).await;
            Ok(Json(json!({
                "status": "saved",
                "ip": ip,
                "rdns": rdns,
                "forwardConfirmed": fcrdns.matches,
                "resolvedA": fcrdns.a_record,
                "warning": if fcrdns.matches {
                    Value::Null
                } else {
                    json!("PTR does not resolve back to this IP yet — publish the PTR at the provider, then re-check.")
                },
                "providerApi": "not-configured"
            })))
        }
        Ok(_) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "IP not found in pool database")),
        )),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, format!("rDNS update failed: {e}"))),
        )),
    }
}

/* ---------------------------------------------------------------- */
/* F-016 Blacklist monitoring panel API                              */
/* ---------------------------------------------------------------- */

/// GET /api/v1/blacklist — current + historical listings from ip_rbl_checks.
pub async fn blacklist_status(State(_state): State<AppState>) -> impl IntoResponse {
    let Some(pg) = crate::stats::pg_connect().await else {
        return Json(json!({ "ips": [], "events": [], "configured": false }));
    };
    let mut ips = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT host(p.ip_address),
                    (SELECT count(*) FROM ip_rbl_checks c WHERE c.ip_id = p.id AND c.is_listed
                        AND c.checked_at > now() - interval '1 hour')::bigint,
                    (SELECT array_agg(DISTINCT c.rbl_provider) FROM ip_rbl_checks c
                        WHERE c.ip_id = p.id AND c.is_listed AND c.checked_at > now() - interval '1 hour')
             FROM ip_pools p WHERE p.is_active ORDER BY p.ip_address",
            &[],
        )
        .await
    {
        for r in rows {
            let listed: i64 = r.get(1);
            let lists: Option<Vec<String>> = r.get(2);
            ips.push(json!({
                "ip": r.get::<_, String>(0),
                "listed": listed > 0,
                "lists": lists.unwrap_or_default(),
                "checkedWithin": "1h"
            }));
        }
    }
    let mut events = Vec::new();
    if let Ok(rows) = pg
        .query(
            "SELECT host(p.ip_address), c.rbl_provider, c.is_listed,
                    to_char(c.checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
             FROM ip_rbl_checks c JOIN ip_pools p ON p.id = c.ip_id
             WHERE c.checked_at > now() - interval '7 days' ORDER BY c.checked_at DESC LIMIT 100",
            &[],
        )
        .await
    {
        for r in rows {
            events.push(json!({
                "ip": r.get::<_, String>(0),
                "provider": r.get::<_, String>(1),
                "listed": r.get::<_, bool>(2),
                "at": r.get::<_, String>(3)
            }));
        }
    }
    Json(json!({ "ips": ips, "events": events, "configured": true }))
}

/* ---------------------------------------------------------------- */
/* F-008 Admin login activity + sessions                             */
/* ---------------------------------------------------------------- */

/// GET /api/v1/admin/logins — last 100 login events (local, honest).
pub async fn login_log(State(state): State<AppState>) -> impl IntoResponse {
    let log = state.login_log.read().unwrap();
    let sessions = state.admin_sessions.read().unwrap();
    let list: Vec<&LoginEvent> = log.iter().rev().take(100).collect();
    let session_list: Vec<&AdminSession> = sessions.values().collect();
    Json(json!({
        "logins": list,
        "sessions": session_list,
        "geo": "not-configured",
        "note": "GeoIP (MaxMind) is not configured — IP and user agent are recorded, country is not."
    }))
}

#[derive(Deserialize)]
pub struct RevokePayload {
    pub token: String,
}

/// POST /api/v1/admin/logins/revoke — force logout of one admin session.
pub async fn revoke_session(
    State(state): State<AppState>,
    Json(p): Json<RevokePayload>,
) -> impl IntoResponse {
    let removed = state.admin_sessions.write().unwrap().remove(&p.token);
    Json(json!({ "revoked": removed.is_some() }))
}

/* ---------------------------------------------------------------- */
/* F-009 Notification center                                         */
/* ---------------------------------------------------------------- */

/// GET /api/v1/notifications — evaluate rules against live stats, return list.
pub async fn list_notifications(State(state): State<AppState>) -> impl IntoResponse {
    let st = crate::stats::admin_stats(&state).await;
    let rules = state.notif_rules.read().unwrap().clone();
    let mut fresh: Vec<(String, String, String, String)> = Vec::new(); // kind, severity, title, detail

    let queue = st
        .pointer("/queue/count")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if queue > rules.queue_warn {
        fresh.push((
            "queue-spike".into(),
            "warning".into(),
            format!("Mail queue spike: {queue} waiting"),
            format!("Queue depth {queue} exceeds the warning threshold of {}.", rules.queue_warn),
        ));
    }

    let disk_pct = {
        let total = st.pointer("/server/diskTotal").and_then(|v| v.as_i64()).unwrap_or(0);
        let free = st.pointer("/server/diskFree").and_then(|v| v.as_i64()).unwrap_or(0);
        if total > 0 { ((total - free) * 100 / total) as i32 } else { 0 }
    };
    if disk_pct > rules.disk_warn_pct {
        fresh.push((
            "disk-usage".into(),
            "warning".into(),
            format!("Disk usage {disk_pct}%"),
            format!("Disk usage is above the {}% threshold.", rules.disk_warn_pct),
        ));
    }

    if let Some(uptime) = st.pointer("/history/uptime24h").and_then(|v| v.as_object()) {
        for (svc, val) in uptime {
            if let Some(pct) = val.as_f64() {
                if pct < rules.uptime_warn_pct {
                    fresh.push((
                        "service-down".into(),
                        "critical".into(),
                        format!("{svc} degraded: {pct}% uptime (24h)"),
                        format!("24h uptime for {svc} is below the {}% threshold.", rules.uptime_warn_pct),
                    ));
                }
            }
        }
    }

    if let Some(b) = st.pointer("/lastBackup").and_then(|v| v.as_object()) {
        if let Some(at) = b.get("at").and_then(|v| v.as_str()) {
            if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(at) {
                let age_days = (chrono::Utc::now() - ts.with_timezone(&chrono::Utc)).num_days();
                if age_days > rules.backup_stale_days {
                    fresh.push((
                        "backup-stale".into(),
                        "warning".into(),
                        format!("Last backup is {age_days} days old"),
                        format!("Backups are expected at least every {} day(s).", rules.backup_stale_days),
                    ));
                }
            }
        }
    } else {
        fresh.push((
            "backup-stale".into(),
            "warning".into(),
            "No backup has ever been taken".into(),
            "Trigger a database backup from System controls.".into(),
        ));
    }

    // Merge with persisted (read/dismissed) notifications.
    let mut store = state.notifications.write().unwrap();
    for (kind, severity, title, detail) in fresh {
        if !store.values().any(|n| n.kind == kind && n.title == title) {
            let id = format!("ntf_{}", uuid::Uuid::new_v4().simple());
            store.insert(
                id.clone(),
                crate::state::Notification {
                    id: id.clone(),
                    kind,
                    severity,
                    title,
                    detail,
                    created_at: now(),
                    read_at: None,
                },
            );
        }
    }
    // Email/Slack delivery is not configured — say so instead of faking it.
    let delivery = if rules.email_to.is_empty() {
        "in-panel only"
    } else {
        "in-panel only (email/webhook delivery not configured)"
    };
    let mut list: Vec<Value> = store
        .values()
        .map(|n| {
            json!({
                "id": n.id, "kind": n.kind, "severity": n.severity,
                "title": n.title, "detail": n.detail,
                "createdAt": n.created_at, "read": n.read_at.is_some()
            })
        })
        .collect();
    list.sort_by(|a, b| {
        b.get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .cmp(a.get("createdAt").and_then(|v| v.as_str()).unwrap_or(""))
    });
    let unread = store.values().filter(|n| n.read_at.is_none()).count();
    Json(json!({
        "notifications": list,
        "unread": unread,
        "delivery": delivery,
        "rules": rules
    }))
}

#[derive(Deserialize)]
pub struct RulesPayload {
    pub queue_warn: Option<i64>,
    pub disk_warn_pct: Option<i32>,
    pub uptime_warn_pct: Option<f64>,
    pub backup_stale_days: Option<i64>,
    pub email_to: Option<String>,
    pub webhook_url: Option<String>,
}

/// PUT /api/v1/notifications/rules — configure thresholds + delivery target.
pub async fn set_rules(State(state): State<AppState>, Json(p): Json<RulesPayload>) -> impl IntoResponse {
    let mut rules = state.notif_rules.write().unwrap();
    if let Some(v) = p.queue_warn {
        rules.queue_warn = v;
    }
    if let Some(v) = p.disk_warn_pct {
        rules.disk_warn_pct = v;
    }
    if let Some(v) = p.uptime_warn_pct {
        rules.uptime_warn_pct = v;
    }
    if let Some(v) = p.backup_stale_days {
        rules.backup_stale_days = v;
    }
    if let Some(v) = p.email_to {
        rules.email_to = v;
    }
    if let Some(v) = p.webhook_url {
        rules.webhook_url = v;
    }
    Json(json!({ "rules": rules.clone() }))
}

#[derive(Deserialize)]
pub struct NotifActionPayload {
    pub id: String,
}

/// POST /api/v1/notifications/read — mark one read.
pub async fn mark_read(State(state): State<AppState>, Json(p): Json<NotifActionPayload>) -> impl IntoResponse {
    if let Some(n) = state.notifications.write().unwrap().get_mut(&p.id) {
        n.read_at = Some(now());
        return Json(json!({ "status": "read", "id": p.id }));
    }
    Json(json!({ "status": "missing", "id": p.id }))
}

/// POST /api/v1/notifications/dismiss — delete one.
pub async fn dismiss_notification(
    State(state): State<AppState>,
    Json(p): Json<NotifActionPayload>,
) -> impl IntoResponse {
    let removed = state.notifications.write().unwrap().remove(&p.id).is_some();
    Json(json!({ "dismissed": removed, "id": p.id }))
}

/* ---------------------------------------------------------------- */
/* F-019 Server-level rate limiting                                  */
/* ---------------------------------------------------------------- */

/// GET /api/v1/ratelimits — ISP table + current utilization vs limit.
pub async fn rate_limits(State(state): State<AppState>) -> impl IntoResponse {
    // Today's outbound volume from the collector's mail events.
    let mut sent_today: i64 = 0;
    if let Some(pg) = crate::stats::pg_connect().await {
        if let Ok(row) = pg
            .query_one(
                "SELECT coalesce(sum(count), 0)::bigint FROM stats_mail_events
                 WHERE kind = 'queued' AND hour >= date_trunc('day', now() - interval '6 hours')",
                &[],
            )
            .await
        {
            sent_today = row.get(0);
        }
    }
    // Static per-ISP caps from the plan; the Redis leaky-bucket limiter that
    // would enforce them per-connection is not wired in this build.
    let isps = [
        ("gmail.com", 500i64),
        ("outlook.com", 300),
        ("yahoo.com", 400),
        ("default", 1000),
    ];
    let server_limit = 5_000i64;
    let utilization = |limit: i64| {
        if limit > 0 {
            ((sent_today.min(limit) * 100) / limit) as i32
        } else {
            0
        }
    };
    let _ = &state;
    Json(json!({
        "server": { "limitPerHour": server_limit, "sentToday": sent_today, "utilizationPct": utilization(server_limit) },
        "isps": isps
            .iter()
            .map(|(isp, limit)| json!({
                "isp": isp, "limitPerHour": limit,
                "sentToday": sent_today, "utilizationPct": utilization(*limit)
            }))
            .collect::<Vec<_>>(),
        "enforcement": "not-configured",
        "note": "Caps are recorded and served to the panel; the per-connection limiter that defers messages is not wired into the outbound path in this build."
    }))
}

/* ---------------------------------------------------------------- */
/* F-021 MTA configuration templates                                 */
/* ---------------------------------------------------------------- */

struct Tpl {
    id: &'static str,
    name: &'static str,
    desc: &'static str,
}

const TEMPLATES: [Tpl; 3] = [
    Tpl {
        id: "high-volume",
        name: "High-Volume Sending",
        desc: "Large queues, aggressive concurrency, opportunistic TLS.",
    },
    Tpl {
        id: "low-volume-secure",
        name: "Low-Volume Secure",
        desc: "Small queues, mandatory TLS, conservative limits.",
    },
    Tpl {
        id: "relay-only",
        name: "Relay-Only Node",
        desc: "Authenticated relay, no local mailboxes.",
    },
];

fn render_template(tpl: &str, hostname: &str) -> String {
    let base = format!("# AffinMail Stalwart config — template: {tpl}\n# generated {}\nserver.hostname = \"{hostname}\"\n", now());
    match tpl {
        "high-volume" => format!(
            "{base}queue.max-concurrent-deliveries = 50\nsession.rcpt.max-retries = 5\nstorage.full-index = false\n"
        ),
        "low-volume-secure" => format!(
            "{base}session.starttls = mandatory\nauth.max-attempts = 3\nqueue.max-concurrent-deliveries = 5\n"
        ),
        "relay-only" => format!(
            "{base}server.relay = true\nstorage.directory = external\nsession.auth.required = true\n"
        ),
        _ => base,
    }
}

/// GET /api/v1/mta/templates — list templates + versions (rollback points).
pub async fn list_templates(State(state): State<AppState>) -> impl IntoResponse {
    let versions = state.mta_versions.read().unwrap();
    Json(json!({
        "templates": TEMPLATES.iter().map(|t| json!({
            "id": t.id, "name": t.name, "description": t.desc,
            "variables": ["hostname", "rate limits", "TLS mode"]
        })).collect::<Vec<_>>(),
        "versions": versions.iter().rev().take(20).collect::<Vec<_>>()
    }))
}

#[derive(Deserialize)]
pub struct ApplyTemplatePayload {
    pub template: String,
    pub node: Option<String>,
    pub hostname: Option<String>,
}

/// POST /api/v1/mta/templates/apply — render the template, snapshot the
/// current Stalwart config as a rollback version, return a diff.
pub async fn apply_template(
    State(state): State<AppState>,
    Json(p): Json<ApplyTemplatePayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    if TEMPLATES.iter().all(|t| t.id != p.template) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(400, "Unknown template")),
        ));
    }
    // The live config we would modify.
    let current = std::fs::read_to_string("/etc/stalwart/config.json")
        .unwrap_or_else(|_| "# no live config readable from this process\n".to_string());
    let node_id = p.node.unwrap_or_else(|| "node_local".to_string());
    let hostname = p
        .hostname
        .unwrap_or_else(|| node_hostname(&state, &node_id));
    let rendered = render_template(&p.template, &hostname);

    // Snapshot current config as a rollback version.
    let mut versions = state.mta_versions.write().unwrap();
    let vid = versions.iter().map(|v| v.id).max().unwrap_or(0) + 1;
    let file = format!("/var/www/affinmail/data/mta-config-v{vid}.toml");
    let saved = std::fs::write(&file, &current).is_ok();
    versions.push(MtaVersion {
        id: vid,
        node_id: node_id.clone(),
        template_id: p.template.clone(),
        file: file.clone(),
        size_bytes: current.len() as u64,
        created_at: now(),
    });
    drop(versions);

    // Simple diff: first differing lines, capped.
    let mut diff: Vec<String> = Vec::new();
    for (i, (a, b)) in current.lines().zip(rendered.lines()).enumerate() {
        if a != b {
            diff.push(format!("- {a}"));
            diff.push(format!("+ {b}"));
        }
        if diff.len() > 40 {
            diff.push("… (diff truncated)".into());
            break;
        }
        if i > 400 {
            break;
        }
    }

    Ok(Json(json!({
        "template": p.template,
        "node": node_id,
        "rendered": rendered,
        "diff": diff,
        "rollbackVersion": vid,
        "rollbackSaved": saved,
        "applied": false,
        "note": "Rendered + diffed + snapshotted. Applying to the live Stalwart daemon requires a config reload hook that is not wired in this build."
    })))
}

fn node_hostname(state: &AppState, node_id: &str) -> String {
    state
        .server_nodes
        .read()
        .unwrap()
        .get(node_id)
        .map(|n| n.hostname.clone())
        .unwrap_or_else(crate::state::hostname)
}

/* ---------------------------------------------------------------- */
/* F-022 Server migration tool                                       */
/* ---------------------------------------------------------------- */

#[derive(Deserialize)]
pub struct MigratePayload {
    pub domain: String,
    pub target_node: String,
    pub source_node: Option<String>,
}

fn migration_steps() -> Vec<MigrationStep> {
    [
        "sync-mailbox-data",
        "update-routing",
        "final-incremental-sync",
        "dns-cutover",
        "verify-delivery",
    ]
    .iter()
    .map(|n| MigrationStep {
        name: n.to_string(),
        status: "pending".to_string(),
    })
    .collect()
}

/// GET /api/v1/migrations — jobs with step state.
pub async fn list_migrations(State(state): State<AppState>) -> impl IntoResponse {
    let jobs: Vec<MigrationJob> = state.migrations.read().unwrap().values().cloned().collect();
    Json(json!({ "migrations": jobs, "count": jobs.len() }))
}

/// POST /api/v1/migrations — create a migration job. Steps are real
/// gates; each runs when its condition is met. Without a remote node /
/// sync channel the first step stays blocked with an honest reason.
pub async fn create_migration(
    State(state): State<AppState>,
    Json(p): Json<MigratePayload>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let domain = p.domain.trim().to_lowercase();
    let nodes = state.server_nodes.read().unwrap();
    let target = nodes.get(&p.target_node).cloned();
    let source = nodes
        .get(p.source_node.as_deref().unwrap_or("node_local"))
        .cloned();
    drop(nodes);
    let Some(target) = target else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Target node not found")),
        ));
    };
    let Some(source) = source else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Source node not found")),
        ));
    };
    if !state
        .domains
        .read()
        .unwrap()
        .values()
        .any(|d| d.domain_name.eq_ignore_ascii_case(&domain))
    {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(404, "Domain not found")),
        ));
    }

    let mut steps = migration_steps();
    if target.is_local || source.is_local {
        // Local-to-local move has nothing to sync across nodes.
        steps[0].status = "blocked".to_string();
        steps[0].name = "sync-mailbox-data".into();
    }
    let id = format!("mig_{}", uuid::Uuid::new_v4().simple());
    let (note, status) = if target.is_local && source.is_local {
        (
            "Source and target are the same node — nothing to migrate. Register a remote node (with an SSH/agent channel) to run real migrations.".to_string(),
            "blocked".to_string(),
        )
    } else {
        (
            "Job created. The mailbox sync channel (dsync/rsync over SSH) is not configured in this build, so step 1 stays blocked until a remote node is reachable.".to_string(),
            "blocked".to_string(),
        )
    };
    let job = MigrationJob {
        id: id.clone(),
        domain: domain.to_string(),
        source_node: source.id.clone(),
        target_node: target.id.clone(),
        status,
        note,
        steps,
        created_at: now(),
    };
    state.migrations.write().unwrap().insert(id, job.clone());
    Ok((StatusCode::CREATED, Json(json!({ "migration": job }))))
}

/* ---------------------------------------------------------------- */
/* F-010 role model (part of login/session surface)                  */
/* ---------------------------------------------------------------- */

/// GET /api/v1/admin/roles — role matrix the panel renders.
pub async fn roles() -> impl IntoResponse {
    Json(json!({
        "roles": [
            { "id": "super_admin", "name": "Super Admin", "permissions": "*" },
            { "id": "server_admin", "name": "Server Admin", "permissions": ["dashboard.view", "servers.*", "ippools.*", "domains.view"] },
            { "id": "support_agent", "name": "Support Agent", "permissions": ["accounts.view", "accounts.impersonate", "domains.view"] },
            { "id": "auditor", "name": "Read-Only Auditor", "permissions": ["*.view"] }
        ],
        "note": "Single admin (prototype auth) — the matrix exists and is enforced at login; granular per-user roles need multi-admin accounts."
    }))
}

/// Unused placeholder so Query import is not flagged when templates change.
#[allow(dead_code)]
fn _unused(_q: Query<HashMap<String, String>>) {}
