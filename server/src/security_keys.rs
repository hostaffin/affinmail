//! Real DKIM keypair generation for domain provisioning (F-023/F-035).
//!
//! Uses the system `openssl` CLI — ring cannot generate RSA keys and adding
//! an RSA crate for one call is not worth it. Returns the PEM private key,
//! the base64 public key for DNS, and the ready-to-publish DNS records.

use serde_json::{json, Value};
use std::io;
use std::path::Path;

pub struct DkimKeypair {
    pub selector: String,
    pub public_key: String,
    pub private_key_pem: String,
    pub dns_records: Vec<Value>,
}

/// Format a DKIM TXT DNS record from the base64 public key.
pub fn dkim_dns_record(public_key: &str) -> String {
    format!("v=DKIM1; k=rsa; p={}", public_key)
}

/// Path where Rspamd expects the DKIM private key for a given domain and selector suffix.
pub fn dkim_key_file_path(domain: &str, selector_suffix: &str) -> String {
    format!("/var/lib/rspamd/dkim/{}.{}.key", domain, selector_suffix)
}

/// Write the PEM private key to the Rspamd DKIM key file.
/// Caller must ensure the directory /var/lib/rspamd/dkim/ exists and is writable.
/// If the write fails, the caller should log the error and continue — domain
/// creation must not fail because of permissions (PM handles deploy-time setup).
pub fn write_dkim_key_file(domain: &str, selector_suffix: &str, pem: &str) -> io::Result<()> {
    let path = dkim_key_file_path(domain, selector_suffix);
    std::fs::write(&path, pem)?;
    Ok(())
}

/// Delete the Rspamd DKIM key file for a given domain and selector suffix (best‑effort).
pub fn delete_dkim_key_file(domain: &str, selector_suffix: &str) -> io::Result<()> {
    let path = dkim_key_file_path(domain, selector_suffix);
    if Path::new(&path).exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// Best-effort: remove every DKIM key file for `domain` in the Rspamd DKIM dir.
/// The exact selector (with its date suffix) is not persisted, so scan the dir.
pub fn delete_all_dkim_keys_for_domain(domain: &str) -> io::Result<()> {
    let dir = "/var/lib/rspamd/dkim";
    let prefix = format!("{}.", domain);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(&prefix) && name.ends_with(".key") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

/// Generate a 2048-bit RSA keypair for `domain` with `label` as selector.
/// DNS records include the DKIM TXT plus the standard MX/SPF/DMARC/CNAME set
/// so the caller can render the full "copy all" table.
pub fn generate_dkim_keypair(domain: &str, label: &str) -> DkimKeypair {
    let selector = format!("{}-{}", label, chrono::Utc::now().format("%y%m%d"));

    // Private key via openssl CLI.
    let pem = std::process::Command::new("openssl")
        .args(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Public key DER → base64 (what goes into the TXT record).
    let public_key = if pem.is_empty() {
        String::new()
    } else {
        std::process::Command::new("openssl")
            .args(["rsa", "-pubout", "-outform", "DER"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                use std::io::Write;
                c.stdin.as_mut().unwrap().write_all(pem.as_bytes())?;
                let out = c.wait_with_output()?;
                Ok(out)
            })
            .ok()
            .filter(|o| o.status.success())
            .map(|o| {
                let der = o.stdout;
                // Strip the 24-byte RSA SubjectPublicKeyInfo header to get the
                // raw modulus+exponent blob that DKIM TXT records expect.
                let key = if der.len() > 24 && &der[..9] == [0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a] {
                    der[24..].to_vec()
                } else {
                    der
                };
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(key)
            })
            .unwrap_or_default()
    };

    let dns_records = vec![
        json!({ "type": "MX", "host": "@", "value": format!("mail.{}", domain), "priority": 10 }),
        json!({ "type": "TXT", "host": "@", "value": "v=spf1 a mx -all" }),
        json!({ "type": "TXT", "host": format!("{}._domainkey", selector),
                "value": format!("v=DKIM1; k=rsa; p={}", public_key) }),
        json!({ "type": "TXT", "host": "_dmarc",
                "value": format!("v=DMARC1; p=none; rua=mailto:postmaster@{}", domain) }),
        json!({ "type": "CNAME", "host": "autodiscover", "value": format!("mail.{}", domain) }),
        json!({ "type": "CNAME", "host": "autoconfig", "value": format!("mail.{}", domain) }),
    ];

    DkimKeypair {
        selector,
        public_key,
        private_key_pem: pem,
        dns_records,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dkim_dns_record_format() {
        let record = dkim_dns_record("MIIBIjANBggqK");
        assert_eq!(record, "v=DKIM1; k=rsa; p=MIIBIjANBggqK");
    }
}
