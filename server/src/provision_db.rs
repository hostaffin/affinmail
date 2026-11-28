use bcrypt::{hash, verify, DEFAULT_COST};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use tokio_postgres::{Client, NoTls, Row};

pub type DbResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// True when DATABASE_URL is configured — the migration layer is active and
/// mail_* tables are the source of truth. When unset the handlers fall back to
/// the original in-memory behaviour.
pub fn database_configured() -> bool {
    std::env::var("DATABASE_URL").is_ok()
}

/// Connect to PostgreSQL using the DATABASE_URL environment variable.
/// The caller must ensure the returned connection task is driven; this helper
/// spawns it on the tokio runtime so the returned `Client` is immediately usable.
pub async fn connect_db() -> DbResult<Client> {
    let database_url = std::env::var("DATABASE_URL")?;
    let (client, connection) = tokio_postgres::connect(&database_url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("postgres connection error: {}", e);
        }
    });
    Ok(client)
}

/// Ensure the `secret_vault` column exists on `mail_users`. Idempotent: safe to
/// call repeatedly. Should be invoked once (e.g. at startup or on first
/// password‑set) before any operation that reads/writes this column.
pub async fn ensure_vault_column(client: &Client) -> DbResult<()> {
    client
        .execute(
            "ALTER TABLE mail_users ADD COLUMN IF NOT EXISTS secret_vault TEXT",
            &[],
        )
        .await?;
    Ok(())
}

/// Hash a plaintext password with bcrypt, prefixed with `{BLF-CRYPT}`.
pub fn hash_password(password: &str) -> DbResult<String> {
    let hashed = hash(password, DEFAULT_COST)?;
    Ok(format!("{{BLF-CRYPT}}{}", hashed))
}

/// Verify a plaintext password against a stored `{BLF-CRYPT}`-prefixed hash.
pub fn verify_password(password: &str, stored: &str) -> DbResult<bool> {
    let hash = stored.strip_prefix("{BLF-CRYPT}").unwrap_or(stored);
    Ok(verify(password, hash)?)
}

/// Encrypt a password with AES-256-GCM using the VAULT_KEY process env var.
/// Output format: base64(iv).base64(tag).base64(ciphertext) — mirrors
/// routes/import_mail.rs `encrypt_with_key` (same algorithm/format).
pub fn vault_encrypt_password(password: &str) -> Result<String, String> {
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
    use ring::digest::{digest, SHA256};
    use ring::rand::{SecureRandom, SystemRandom};

    let key = std::env::var("VAULT_KEY").map_err(|_| "VAULT_KEY not set".to_string())?;
    let key = if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
        (0..64)
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&key[i..i + 2], 16).ok())
            .collect::<Vec<u8>>()
    } else {
        digest(&SHA256, key.as_bytes()).as_ref().to_vec()
    };

    let unbound = UnboundKey::new(&AES_256_GCM, &key).map_err(|e| e.to_string())?;
    let sealing = LessSafeKey::new(unbound);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    SystemRandom::new().fill(&mut nonce_bytes).map_err(|_| "rng failed".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut in_out = password.as_bytes().to_vec();
    let tag = sealing
        .seal_in_place_separate_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "encryption failed".to_string())?;
    let b64 = |bytes: &[u8]| STANDARD.encode(bytes);
    Ok(format!("{}.{}.{}", b64(&nonce_bytes), b64(tag.as_ref()), b64(&in_out)))
}

/// Derive the key bytes from VAULT_KEY env var (same derivation as PHP-era key).
pub fn vault_key_from_env() -> Option<Vec<u8>> {
    use ring::digest::{digest, SHA256};
    let key = std::env::var("VAULT_KEY").ok()?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    Some(if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
        (0..64)
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&key[i..i + 2], 16).ok())
            .collect::<Vec<u8>>()
    } else {
        digest(&SHA256, key.as_bytes()).as_ref().to_vec()
    })
}

/// mail_domains row.
#[derive(Debug, Clone)]
pub struct Domain {
    pub id: i32,
    pub domain: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

/// mail_users row.
#[derive(Debug, Clone)]
pub struct Mailbox {
    pub id: i32,
    pub domain_id: Option<i32>,
    pub email: String,
    pub quota_mb: i32,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

/// mail_aliases row.
#[derive(Debug, Clone)]
pub struct Alias {
    pub id: i32,
    pub domain_id: Option<i32>,
    pub source: String,
    pub destination: String,
    pub active: bool,
}

/// Map a mail_domains row onto the existing API Domain shape (unchanged JSON).
impl Domain {
    pub fn to_api(&self) -> crate::types::Domain {
        crate::types::Domain {
            id: format!("dom_{}", self.id),
            account_id: None,
            domain_name: self.domain.clone(),
            status: if self.active { "active" } else { "suspended" }.to_string(),
            hostaffin_service_id: None,
            max_mailboxes: 25,
            max_attachment_size_mb: 50,
            disk_quota_mb: 51200,
            dkim_selector: String::new(),
            dkim_public_key: String::new(),
            dkim_private_key: String::new(),
            catch_all_mailbox_id: None,
            hourly_send_limit: 200,
            daily_send_limit: 1000,
            send_limit_action: "defer".to_string(),
            suspend_reason: None,
            terminated_at: None,
            created_at: self.created_at.to_rfc3339(),
        }
    }
}

/// Map a mail_users row onto the existing API Mailbox shape (unchanged JSON).
impl Mailbox {
    pub fn to_api(&self, domain_name: &str) -> crate::types::Mailbox {
        crate::types::Mailbox {
            id: format!("mb_{}", self.id),
            domain_id: self
                .domain_id
                .map(|d| format!("dom_{}", d))
                .unwrap_or_default(),
            domain_name: domain_name.to_string(),
            email: self.email.clone(),
            display_name: "User".to_string(),
            quota_limit_mb: self.quota_mb as i64,
            quota_used_mb: 0,
            hourly_rate_limit: 200,
            is_active: self.active,
            is_suspended: !self.active,
            forward_to: None,
            forward_keep_copy: true,
            vacation_enabled: false,
            vacation_subject: None,
            vacation_body: None,
            vacation_start: None,
            vacation_end: None,
            totp_secret: None,
            totp_enabled: false,
            recovery_codes: Vec::new(),
            created_at: self.created_at.to_rfc3339(),
        }
    }
}

/// Map a mail_aliases row onto the existing API Alias shape (unchanged JSON).
impl Alias {
    pub fn to_api(&self) -> crate::types::Alias {
        crate::types::Alias {
            id: format!("al_{}", self.id),
            domain_id: self
                .domain_id
                .map(|d| format!("dom_{}", d))
                .unwrap_or_default(),
            source_email: self.source.clone(),
            destination_email: self.destination.clone(),
            is_list: false,
            destinations: vec![self.destination.clone()],
            reply_to: None,
            who_can_post: None,
            max_message_size_kb: None,
            footer: None,
            created_at: String::new(),
        }
    }
}

fn row_to_domain(row: &Row) -> Domain {
    Domain {
        id: row.get("id"),
        domain: row.get("domain"),
        active: row.get("active"),
        created_at: row.get("created_at"),
    }
}

fn row_to_mailbox(row: &Row) -> Mailbox {
    Mailbox {
        id: row.get("id"),
        domain_id: row.get("domain_id"),
        email: row.get("email"),
        quota_mb: row.get("quota_mb"),
        active: row.get("active"),
        created_at: row.get("created_at"),
    }
}

fn row_to_alias(row: &Row) -> Alias {
    Alias {
        id: row.get("id"),
        domain_id: row.get("domain_id"),
        source: row.get("source"),
        destination: row.get("destination"),
        active: row.get("active"),
    }
}

/// Domains
pub async fn create_domain(client: &Client, domain: &str, active: bool) -> DbResult<Domain> {
    let row = client
        .query_one(
            "INSERT INTO mail_domains (domain, active) VALUES ($1, $2)
             RETURNING id, domain, active, created_at",
            &[&domain, &active],
        )
        .await?;
    Ok(row_to_domain(&row))
}

pub async fn list_domains(client: &Client) -> DbResult<Vec<Domain>> {
    let rows = client
        .query(
            "SELECT id, domain, active, created_at FROM mail_domains ORDER BY domain",
            &[],
        )
        .await?;
    Ok(rows.iter().map(|r| row_to_domain(r)).collect())
}

pub async fn get_domain_by_id(client: &Client, id: i32) -> DbResult<Option<Domain>> {
    let row = client
        .query_opt(
            "SELECT id, domain, active, created_at FROM mail_domains WHERE id = $1",
            &[&id],
        )
        .await?;
    Ok(row.map(|r| row_to_domain(&r)))
}

pub async fn get_domain_by_name(client: &Client, domain: &str) -> DbResult<Option<Domain>> {
    let row = client
        .query_opt(
            "SELECT id, domain, active, created_at FROM mail_domains WHERE domain = $1",
            &[&domain],
        )
        .await?;
    Ok(row.map(|r| row_to_domain(&r)))
}

pub async fn delete_domain_by_id(client: &Client, id: i32) -> DbResult<()> {
    client.execute("DELETE FROM mail_domains WHERE id = $1", &[&id]).await?;
    Ok(())
}

/// Mailboxes
pub async fn create_mailbox(
    client: &Client,
    domain_id: Option<i32>,
    email: &str,
    password: &str,
    quota_mb: i32,
) -> DbResult<Mailbox> {
    let password_hash = hash_password(password)?;
    let secret_vault = vault_encrypt_password(password).ok();
    let _ = client
        .execute(
            "ALTER TABLE mail_users ADD COLUMN IF NOT EXISTS secret_vault TEXT",
            &[],
        ).await;
    let row = client
        .query_one(
            "INSERT INTO mail_users (domain_id, email, password, quota_mb, secret_vault)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, domain_id, email, password, quota_mb, active, created_at",
            &[&domain_id, &email, &password_hash, &quota_mb, &secret_vault],
        )
        .await?;
    Ok(row_to_mailbox(&row))
}

pub async fn get_mailbox(client: &Client, mailbox_id: i32) -> DbResult<Option<Mailbox>> {
    let row = client
        .query_opt(
            "SELECT id, domain_id, email, password, quota_mb, active, created_at
             FROM mail_users WHERE id = $1",
            &[&mailbox_id],
        )
        .await?;
    Ok(row.map(|r| row_to_mailbox(&r)))
}

pub async fn list_mailboxes(
    client: &Client,
    domain_id: Option<i32>,
) -> DbResult<Vec<Mailbox>> {
    let rows = match domain_id {
        Some(did) => client
            .query(
                "SELECT id, domain_id, email, password, quota_mb, active, created_at
                 FROM mail_users WHERE domain_id = $1 ORDER BY email",
                &[&did],
            )
            .await?,
        None => client
            .query(
                "SELECT id, domain_id, email, password, quota_mb, active, created_at
                 FROM mail_users ORDER BY email",
                &[],
            )
            .await?,
    };
    Ok(rows.iter().map(|r| row_to_mailbox(r)).collect())
}

pub async fn set_mailbox_password(client: &Client, mailbox_id: i32, password: &str) -> DbResult<()> {
    let password_hash = hash_password(password)?;
    let secret_vault = vault_encrypt_password(password).ok();
    let _ = client
        .execute(
            "ALTER TABLE mail_users ADD COLUMN IF NOT EXISTS secret_vault TEXT",
            &[],
        ).await;
    client
        .execute(
            "UPDATE mail_users SET password = $1, secret_vault = $2 WHERE id = $3",
            &[&password_hash, &secret_vault, &mailbox_id],
        )
        .await?;
    Ok(())
}

pub async fn set_mailbox_quota(client: &Client, mailbox_id: i32, quota_mb: i32) -> DbResult<()> {
    client
        .execute(
            "UPDATE mail_users SET quota_mb = $1 WHERE id = $2",
            &[&quota_mb, &mailbox_id],
        )
        .await?;
    Ok(())
}

pub async fn set_mailbox_active(client: &Client, mailbox_id: i32, active: bool) -> DbResult<()> {
    client
        .execute(
            "UPDATE mail_users SET active = $1 WHERE id = $2",
            &[&active, &mailbox_id],
        )
        .await?;
    Ok(())
}

pub async fn delete_mailbox(client: &Client, mailbox_id: i32) -> DbResult<()> {
    client
        .execute("DELETE FROM mail_users WHERE id = $1", &[&mailbox_id])
        .await?;
    Ok(())
}

/// Aliases
pub async fn create_alias(
    client: &Client,
    domain_id: Option<i32>,
    source: &str,
    destination: &str,
) -> DbResult<Alias> {
    let row = client
        .query_one(
            "INSERT INTO mail_aliases (domain_id, source, destination)
             VALUES ($1, $2, $3)
             RETURNING id, domain_id, source, destination, active",
            &[&domain_id, &source, &destination],
        )
        .await?;
    Ok(row_to_alias(&row))
}

pub async fn list_aliases(client: &Client, domain_id: Option<i32>) -> DbResult<Vec<Alias>> {
    let rows = match domain_id {
        Some(did) => client
            .query(
                "SELECT id, domain_id, source, destination, active
                 FROM mail_aliases WHERE domain_id = $1 ORDER BY source",
                &[&did],
            )
            .await?,
        None => client
            .query(
                "SELECT id, domain_id, source, destination, active
                 FROM mail_aliases ORDER BY source",
                &[],
            )
            .await?,
    };
    Ok(rows.iter().map(|r| row_to_alias(r)).collect())
}

pub async fn delete_alias(client: &Client, alias_id: i32) -> DbResult<()> {
    client
        .execute("DELETE FROM mail_aliases WHERE id = $1", &[&alias_id])
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_password_format_and_verify_roundtrip() {
        let hashed = hash_password("hunter2").unwrap();
        assert!(hashed.starts_with("{BLF-CRYPT}"));
        assert!(verify_password("hunter2", &hashed).unwrap());
        assert!(!verify_password("wrong", &hashed).unwrap());
    }
}
