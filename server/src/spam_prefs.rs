//! Per-mailbox spam preferences (post-migration batch 2, BATCH5-DESIGN.md).
//!
//! Storage: PG table `mail_spam_prefs`. Enforcement: this module renders
//! all saved prefs into /var/lib/rspamd/user-settings.ucl (Rspamd settings
//! groups matched by envelope recipient) and reloads Rspamd. A group is
//! rendered only for mailboxes that have a saved row; everyone else keeps
//! the server defaults.

use serde::{Deserialize, Serialize};
use tokio_postgres::Client;

pub const SETTINGS_PATH: &str = "/var/lib/rspamd/user-settings.ucl";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpamPrefs {
    pub email: String,
    pub enabled: bool,
    pub reject_threshold: Option<f64>,
    pub header_threshold: Option<f64>,
    #[serde(default)]
    pub whitelist: Vec<String>,
    #[serde(default)]
    pub blacklist: Vec<String>,
}

impl SpamPrefs {
    pub fn defaults(email: &str) -> Self {
        Self {
            email: email.to_string(),
            enabled: true,
            reject_threshold: None,
            header_threshold: None,
            whitelist: Vec::new(),
            blacklist: Vec::new(),
        }
    }
    fn is_default(&self) -> bool {
        self.enabled
            && self.reject_threshold.is_none()
            && self.header_threshold.is_none()
            && self.whitelist.is_empty()
            && self.blacklist.is_empty()
    }
}

pub async fn ensure_table(client: &Client) -> Result<(), String> {
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS mail_spam_prefs (
                email text PRIMARY KEY,
                enabled boolean NOT NULL DEFAULT true,
                reject_threshold double precision,
                header_threshold double precision,
                whitelist text[] NOT NULL DEFAULT '{}',
                blacklist text[] NOT NULL DEFAULT '{}',
                updated_at timestamptz NOT NULL DEFAULT now()
            )",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn get_prefs(client: &Client, email: &str) -> Result<SpamPrefs, String> {
    ensure_table(client).await?;
    let row = client
        .query_opt(
            "SELECT enabled, reject_threshold, header_threshold, whitelist, blacklist FROM mail_spam_prefs WHERE email = $1",
            &[&email],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(match row {
        Some(r) => SpamPrefs {
            email: email.to_string(),
            enabled: r.get(0),
            reject_threshold: r.get(1),
            header_threshold: r.get(2),
            whitelist: r.get(3),
            blacklist: r.get(4),
        },
        None => SpamPrefs::defaults(email),
    })
}

pub async fn set_prefs(client: &Client, prefs: &SpamPrefs) -> Result<(), String> {
    ensure_table(client).await?;
    client
        .execute(
            "INSERT INTO mail_spam_prefs (email, enabled, reject_threshold, header_threshold, whitelist, blacklist, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (email) DO UPDATE SET enabled = EXCLUDED.enabled,
                reject_threshold = EXCLUDED.reject_threshold,
                header_threshold = EXCLUDED.header_threshold,
                whitelist = EXCLUDED.whitelist,
                blacklist = EXCLUDED.blacklist,
                updated_at = now()",
            &[
                &prefs.email,
                &prefs.enabled,
                &prefs.reject_threshold,
                &prefs.header_threshold,
                &prefs.whitelist,
                &prefs.blacklist,
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn all_prefs(client: &Client) -> Result<Vec<SpamPrefs>, String> {
    ensure_table(client).await?;
    let rows = client
        .query(
            "SELECT email, enabled, reject_threshold, header_threshold, whitelist, blacklist FROM mail_spam_prefs ORDER BY email",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| SpamPrefs {
            email: r.get(0),
            enabled: r.get(1),
            reject_threshold: r.get(2),
            header_threshold: r.get(3),
            whitelist: r.get(4),
            blacklist: r.get(5),
        })
        .collect())
}

pub fn validate(prefs: &SpamPrefs) -> Result<(), String> {
    for (name, v) in [
        ("reject_threshold", prefs.reject_threshold),
        ("header_threshold", prefs.header_threshold),
    ] {
        if let Some(t) = v {
            if !(0.0..=1000.0).contains(&t) {
                return Err(format!("{name} must be between 0 and 1000"));
            }
        }
    }
    for (name, list) in [("whitelist", &prefs.whitelist), ("blacklist", &prefs.blacklist)] {
        if list.len() > 100 {
            return Err(format!("{name} is limited to 100 entries"));
        }
        for entry in list {
            let e = entry.trim();
            if e.is_empty() || e.len() > 254 || e.chars().any(|c| c.is_control() || c == '"' || c == '\\') {
                return Err(format!("invalid {name} entry: {entry:?}"));
            }
        }
    }
    Ok(())
}

fn ucl_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn fmt_threshold(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

fn addr_list(list: &[String]) -> String {
    list.iter()
        .map(|e| format!("\"{}\"", ucl_escape(e.trim())))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Render the Rspamd settings file. Groups match by envelope recipient
/// (inbound semantics: prefs govern mail delivered TO the mailbox).
pub fn render_settings(all: &[SpamPrefs]) -> String {
    let mut out = String::from("# Generated by affinmail-server from mail_spam_prefs. Do not edit.\n");
    for p in all {
        if p.is_default() {
            continue;
        }
        let email = ucl_escape(&p.email);
        out.push_str(&format!("\n\"{email}\" {{\n    priority = 10;\n    rcpt = \"{email}\";\n    apply {{\n"));
        if !p.enabled {
            out.push_str("        actions {\n            reject = null;\n            add_header = null;\n            greylist = null;\n        }\n");
        } else {
            if p.reject_threshold.is_some() || p.header_threshold.is_some() {
                out.push_str("        actions {\n");
                if let Some(t) = p.reject_threshold {
                    out.push_str(&format!("            reject = {};\n", fmt_threshold(t)));
                }
                if let Some(t) = p.header_threshold {
                    out.push_str(&format!("            add_header = {};\n", fmt_threshold(t)));
                }
                out.push_str("        }\n");
            }
            if !p.whitelist.is_empty() {
                out.push_str(&format!("        whitelist_from = [{}];\n", addr_list(&p.whitelist)));
            }
            if !p.blacklist.is_empty() {
                out.push_str(&format!("        blacklist_from = [{}];\n", addr_list(&p.blacklist)));
            }
        }
        out.push_str("    }\n}\n");
    }
    out
}

/// Write the settings file and reload Rspamd (sudoers: affinmail-rspamd).
pub fn write_and_reload(all: &[SpamPrefs]) -> Result<(), String> {
    std::fs::write(SETTINGS_PATH, render_settings(all)).map_err(|e| format!("write settings: {e}"))?;
    let status = std::process::Command::new("sudo")
        .args(["-n", "/usr/bin/systemctl", "reload", "rspamd"])
        .status()
        .map_err(|e| format!("reload rspamd: {e}"))?;
    if !status.success() {
        return Err(format!("rspamd reload failed with {status}"));
    }
    Ok(())
}
