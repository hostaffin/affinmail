//! :2083 domain panel data layer (post-migration batch 4,
//! BATCH7-DESIGN.md): domain owners + domain API keys.

use tokio_postgres::Client;

pub async fn ensure_tables(client: &Client) -> Result<(), String> {
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS domain_owners (
                domain_id integer PRIMARY KEY REFERENCES mail_domains(id) ON DELETE CASCADE,
                email text NOT NULL,
                password_hash text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS domain_api_keys (
                id serial PRIMARY KEY,
                domain_id integer NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
                name text NOT NULL DEFAULT '',
                key_hash text UNIQUE NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_used_at timestamptz
            )",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn set_owner(
    client: &Client,
    domain_id: i32,
    email: &str,
    password: &str,
) -> Result<(), String> {
    ensure_tables(client).await?;
    let hash = bcrypt::hash(password, 10).map_err(|e| e.to_string())?;
    client
        .execute(
            "INSERT INTO domain_owners (domain_id, email, password_hash) VALUES ($1, $2, $3)
             ON CONFLICT (domain_id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash",
            &[&domain_id, &email, &hash],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Verify owner credentials; returns (domain_id, domain name).
pub async fn verify_owner(
    client: &Client,
    email: &str,
    password: &str,
) -> Option<(i32, String)> {
    ensure_tables(client).await.ok()?;
    let row = client
        .query_opt(
            "SELECT o.domain_id, o.password_hash, d.domain FROM domain_owners o
             JOIN mail_domains d ON d.id = o.domain_id WHERE o.email = $1",
            &[&email],
        )
        .await
        .ok()??;
    let hash: String = row.get(1);
    if bcrypt::verify(password, &hash).unwrap_or(false) {
        Some((row.get(0), row.get(2)))
    } else {
        None
    }
}

pub fn hash_api_key(raw: &str) -> String {
    use ring::digest::{digest, SHA256};
    digest(&SHA256, raw.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Create a key; returns (id, raw key). The raw key is shown once.
pub async fn create_api_key(
    client: &Client,
    domain_id: i32,
    name: &str,
) -> Result<(i32, String), String> {
    ensure_tables(client).await?;
    let raw = format!(
        "affkey_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let row = client
        .query_one(
            "INSERT INTO domain_api_keys (domain_id, name, key_hash) VALUES ($1, $2, $3) RETURNING id",
            &[&domain_id, &name, &hash_api_key(&raw)],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok((row.get(0), raw))
}

/// Verify a raw API key; returns (domain_id, domain name) and stamps use.
pub async fn verify_api_key(client: &Client, raw: &str) -> Option<(i32, String)> {
    ensure_tables(client).await.ok()?;
    let row = client
        .query_opt(
            "SELECT k.domain_id, d.domain FROM domain_api_keys k
             JOIN mail_domains d ON d.id = k.domain_id WHERE k.key_hash = $1",
            &[&hash_api_key(raw)],
        )
        .await
        .ok()??;
    let domain_id: i32 = row.get(0);
    let _ = client
        .execute(
            "UPDATE domain_api_keys SET last_used_at = now() WHERE key_hash = $1",
            &[&hash_api_key(raw)],
        )
        .await;
    Some((domain_id, row.get(1)))
}

pub async fn list_api_keys(
    client: &Client,
    domain_id: i32,
) -> Result<Vec<(i32, String, String, Option<String>)>, String> {
    ensure_tables(client).await?;
    let rows = client
        .query(
            "SELECT id, name, created_at::text, last_used_at::text FROM domain_api_keys WHERE domain_id = $1 ORDER BY id",
            &[&domain_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| (r.get(0), r.get(1), r.get(2), r.get(3)))
        .collect())
}

pub async fn delete_api_key(client: &Client, domain_id: i32, key_id: i32) -> Result<bool, String> {
    ensure_tables(client).await?;
    let n = client
        .execute(
            "DELETE FROM domain_api_keys WHERE id = $1 AND domain_id = $2",
            &[&key_id, &domain_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}
