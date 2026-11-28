use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Utc};
use tokio_postgres::{Client, NoTls, Row};

pub type DbResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

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

/// Mailboxes
pub async fn create_mailbox(
    client: &Client,
    domain_id: Option<i32>,
    email: &str,
    password: &str,
    quota_mb: i32,
) -> DbResult<Mailbox> {
    let password_hash = hash_password(password)?;
    let row = client
        .query_one(
            "INSERT INTO mail_users (domain_id, email, password, quota_mb)
             VALUES ($1, $2, $3, $4)
             RETURNING id, domain_id, email, password, quota_mb, active, created_at",
            &[&domain_id, &email, &password_hash, &quota_mb],
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
    client
        .execute(
            "UPDATE mail_users SET password = $1 WHERE id = $2",
            &[&password_hash, &mailbox_id],
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
