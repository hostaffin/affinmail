// mail_imap.rs — Batch 3 plumbing: IMAP (Dovecot) + SMTP submission (Postfix)
// for the Postfix/Dovecot/Rspamd stack. Per-request sessions: connect, LOGIN
// with the mailbox credentials supplied by the caller, do the work, logout.
// Blocking imap/native-tls calls are wrapped in spawn_blocking.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use tokio::task;

#[derive(Debug, Clone)]
pub struct FolderEntry {
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone)]
pub struct MessageSummary {
    pub uid: u32,
    pub flags: Vec<String>,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub date: String,
    pub size: u32,
}

type ImapSession = imap::Session<native_tls::TlsStream<TcpStream>>;

fn connect(email: &str, password: &str) -> Result<ImapSession, String> {
    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("tls builder: {e}"))?;
    let client = imap::connect(("127.0.0.1", 993), "127.0.0.1", &tls)
        .map_err(|e| format!("imap connect: {e}"))?;
    client
        .login(email, password)
        .map_err(|(e, _)| format!("imap login: {e}"))
}

fn role_for(name: &str) -> &'static str {
    match name.to_ascii_lowercase().as_str() {
        "inbox" => "inbox",
        "sent" | "sent items" | "sent mail" => "sent",
        "drafts" => "drafts",
        "trash" | "deleted items" | "bin" => "trash",
        "junk" | "spam" | "junk e-mail" => "junk",
        "archive" => "archive",
        _ => "other",
    }
}

fn flag_name(f: &imap::types::Flag) -> String {
    use imap::types::Flag::*;
    match f {
        Seen => "\\Seen".to_string(),
        Answered => "\\Answered".to_string(),
        Flagged => "\\Flagged".to_string(),
        Deleted => "\\Deleted".to_string(),
        Draft => "\\Draft".to_string(),
        Recent => "\\Recent".to_string(),
        MayCreate => "\\MayCreate".to_string(),
        Custom(c) => c.to_string(),
        _ => format!("{f:?}"),
    }
}

fn header_field(headers: &[u8], field: &str) -> String {
    let text = String::from_utf8_lossy(headers);
    let prefix = format!("{}:", field.to_ascii_lowercase());
    let mut out: Option<String> = None;
    for line in text.lines() {
        if (line.starts_with(' ') || line.starts_with('\t')) && out.is_some() {
            let cur = out.as_mut().unwrap();
            cur.push(' ');
            cur.push_str(line.trim());
            continue;
        }
        if out.is_some() {
            break;
        }
        if line.to_ascii_lowercase().starts_with(&prefix) {
            out = Some(line[field.len() + 1..].trim().to_string());
        }
    }
    out.unwrap_or_default()
}

// ---------- blocking implementations ----------

fn list_folders_b(email: &str, password: &str) -> Result<Vec<FolderEntry>, String> {
    let mut s = connect(email, password)?;
    let names = s
        .list(Some(""), Some("*"))
        .map_err(|e| format!("imap list: {e}"))?;
    let out = names
        .iter()
        .map(|n| {
            let name = n.name().to_string();
            FolderEntry {
                role: role_for(&name).to_string(),
                name,
            }
        })
        .collect();
    let _ = s.logout();
    Ok(out)
}

fn list_messages_b(
    email: &str,
    password: &str,
    folder: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<MessageSummary>, String> {
    let mut s = connect(email, password)?;
    s.select(folder)
        .map_err(|e| format!("imap select: {e}"))?;
    let mut uids: Vec<u32> = s
        .uid_search("ALL")
        .map_err(|e| format!("imap search: {e}"))?
        .into_iter()
        .collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));
    let page: Vec<u32> = uids.into_iter().skip(offset).take(limit).collect();
    if page.is_empty() {
        let _ = s.logout();
        return Ok(Vec::new());
    }
    let set = page
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let fetches = s
        .uid_fetch(
            &set,
            "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])",
        )
        .map_err(|e| format!("imap fetch: {e}"))?;
    let mut out = Vec::new();
    for f in fetches.iter() {
        let headers = f.header().unwrap_or(&[]);
        out.push(MessageSummary {
            uid: f.uid.unwrap_or(0),
            flags: f.flags().iter().map(flag_name).collect(),
            from: header_field(headers, "From"),
            to: header_field(headers, "To"),
            subject: header_field(headers, "Subject"),
            date: header_field(headers, "Date"),
            size: f.size.unwrap_or(0),
        });
    }
    out.sort_by(|a, b| b.uid.cmp(&a.uid));
    let _ = s.logout();
    Ok(out)
}

fn fetch_message_b(
    email: &str,
    password: &str,
    folder: &str,
    uid: u32,
) -> Result<Vec<u8>, String> {
    let mut s = connect(email, password)?;
    s.select(folder)
        .map_err(|e| format!("imap select: {e}"))?;
    let fetches = s
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(|e| format!("imap fetch: {e}"))?;
    let body = fetches
        .first()
        .and_then(|f| f.body())
        .ok_or_else(|| "message not found".to_string())?
        .to_vec();
    let _ = s.logout();
    Ok(body)
}

fn search_b(
    email: &str,
    password: &str,
    folder: &str,
    query: &str,
) -> Result<Vec<u32>, String> {
    let mut s = connect(email, password)?;
    s.select(folder)
        .map_err(|e| format!("imap select: {e}"))?;
    let criteria = if query.trim().is_empty() {
        "ALL".to_string()
    } else {
        let esc = query.replace('\\', "\\\\").replace('"', "\\\"");
        format!("TEXT \"{esc}\"")
    };
    let mut uids: Vec<u32> = s
        .uid_search(&criteria)
        .map_err(|e| format!("imap search: {e}"))?
        .into_iter()
        .collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));
    let _ = s.logout();
    Ok(uids)
}

fn folder_counts_b(email: &str, password: &str, folder: &str) -> Result<(u64, u64), String> {
    let mut s = connect(email, password)?;
    s.select(folder)
        .map_err(|e| format!("imap select: {e}"))?;
    let total = s
        .uid_search("ALL")
        .map_err(|e| format!("imap search all: {e}"))?
        .len() as u64;
    let unseen = s
        .uid_search("UNSEEN")
        .map_err(|e| format!("imap search unseen: {e}"))?
        .len() as u64;
    let _ = s.logout();
    Ok((total, unseen))
}

fn append_b(email: &str, password: &str, folder: &str, content: &[u8]) -> Result<(), String> {
    let mut s = connect(email, password)?;
    if s.append(folder, content).is_err() {
        // Folder may not exist yet (Dovecot does not auto-create specials):
        // create it and retry once.
        let _ = s.create(folder);
        s.append(folder, content)
            .map_err(|e| format!("imap append: {e}"))?;
    }
    let _ = s.logout();
    Ok(())
}

fn create_folder_b(email: &str, password: &str, folder: &str) -> Result<(), String> {
    let mut s = connect(email, password)?;
    s.create(folder)
        .map_err(|e| format!("imap create: {e}"))?;
    let _ = s.logout();
    Ok(())
}

fn set_flag_b(
    email: &str,
    password: &str,
    folder: &str,
    uid: u32,
    flag: &str,
    add: bool,
) -> Result<(), String> {
    let mut s = connect(email, password)?;
    s.select(folder)
        .map_err(|e| format!("imap select: {e}"))?;
    let op = if add { "+FLAGS" } else { "-FLAGS" };
    s.uid_store(uid.to_string(), format!("{op} ({flag})"))
        .map_err(|e| format!("imap store: {e}"))?;
    let _ = s.logout();
    Ok(())
}

fn delete_b(email: &str, password: &str, folder: &str, uid: u32) -> Result<(), String> {
    let mut s = connect(email, password)?;
    s.select(folder)
        .map_err(|e| format!("imap select: {e}"))?;
    s.uid_store(uid.to_string(), "+FLAGS (\\Deleted)")
        .map_err(|e| format!("imap store: {e}"))?;
    s.expunge().map_err(|e| format!("imap expunge: {e}"))?;
    let _ = s.logout();
    Ok(())
}

// ---------- SMTP submission (hand-rolled, STARTTLS + AUTH PLAIN) ----------

fn b64encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b = [
            chunk[0] as u32,
            *chunk.get(1).unwrap_or(&0) as u32,
            *chunk.get(2).unwrap_or(&0) as u32,
        ];
        let n = (b[0] << 16) | (b[1] << 8) | b[2];
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

struct Smtp<S: Read + Write> {
    reader: BufReader<S>,
}

impl<S: Read + Write> Smtp<S> {
    fn read_reply(&mut self) -> Result<u32, String> {
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("smtp read: {e}"))?;
            if n == 0 {
                return Err("smtp: connection closed".to_string());
            }
            let code: u32 = line
                .get(0..3)
                .and_then(|c| c.parse().ok())
                .ok_or_else(|| format!("smtp: bad reply {line:?}"))?;
            if line.chars().nth(3) != Some('-') {
                return Ok(code);
            }
        }
    }

    fn cmd(&mut self, cmd: &str, expect: u32) -> Result<(), String> {
        self.reader
            .get_mut()
            .write_all(format!("{cmd}\r\n").as_bytes())
            .map_err(|e| format!("smtp write: {e}"))?;
        let code = self.read_reply()?;
        if code != expect {
            return Err(format!("smtp: expected {expect}, got {code} for {cmd:?}"));
        }
        Ok(())
    }
}

fn send_b(
    email: &str,
    password: &str,
    from: &str,
    to: &[String],
    rfc822: &[u8],
) -> Result<(), String> {
    let tcp = TcpStream::connect(("127.0.0.1", 587)).map_err(|e| format!("smtp connect: {e}"))?;
    let mut s = Smtp {
        reader: BufReader::new(tcp),
    };
    if s.read_reply()? != 220 {
        return Err("smtp: no greeting".to_string());
    }
    s.cmd("EHLO affinmail.local", 250)?;
    s.cmd("STARTTLS", 220)?;
    let tcp = s.reader.into_inner();
    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("tls builder: {e}"))?;
    let tls_stream = tls
        .connect("127.0.0.1", tcp)
        .map_err(|e| format!("smtp tls: {e}"))?;
    let mut s = Smtp {
        reader: BufReader::new(tls_stream),
    };
    s.cmd("EHLO affinmail.local", 250)?;
    let auth = b64encode(format!("\0{email}\0{password}").as_bytes());
    s.cmd(&format!("AUTH PLAIN {auth}"), 235)?;
    s.cmd(&format!("MAIL FROM:<{from}>"), 250)?;
    for rcpt in to {
        s.cmd(&format!("RCPT TO:<{rcpt}>"), 250)?;
    }
    s.cmd("DATA", 354)?;
    // dot-stuff lines beginning with '.'
    let text = String::from_utf8_lossy(rfc822);
    let mut stuffed = String::new();
    for line in text.lines() {
        if line.starts_with('.') {
            stuffed.push('.');
        }
        stuffed.push_str(line);
        stuffed.push_str("\r\n");
    }
    stuffed.push_str(".\r\n");
    s.reader
        .get_mut()
        .write_all(stuffed.as_bytes())
        .map_err(|e| format!("smtp write data: {e}"))?;
    if s.read_reply()? != 250 {
        return Err("smtp: message not accepted".to_string());
    }
    let _ = s.cmd("QUIT", 221);
    Ok(())
}

// ---------- async wrappers ----------

pub async fn list_folders(email: String, password: String) -> Result<Vec<FolderEntry>, String> {
    task::spawn_blocking(move || list_folders_b(&email, &password))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn list_messages(
    email: String,
    password: String,
    folder: String,
    limit: usize,
    offset: usize,
) -> Result<Vec<MessageSummary>, String> {
    task::spawn_blocking(move || list_messages_b(&email, &password, &folder, limit, offset))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn fetch_message(
    email: String,
    password: String,
    folder: String,
    uid: u32,
) -> Result<Vec<u8>, String> {
    task::spawn_blocking(move || fetch_message_b(&email, &password, &folder, uid))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn search_basic(
    email: String,
    password: String,
    folder: String,
    query: String,
) -> Result<Vec<u32>, String> {
    task::spawn_blocking(move || search_b(&email, &password, &folder, &query))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn folder_counts(
    email: String,
    password: String,
    folder: String,
) -> Result<(u64, u64), String> {
    task::spawn_blocking(move || folder_counts_b(&email, &password, &folder))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn append_message(
    email: String,
    password: String,
    folder: String,
    content: Vec<u8>,
) -> Result<(), String> {
    task::spawn_blocking(move || append_b(&email, &password, &folder, &content))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn create_folder(
    email: String,
    password: String,
    folder: String,
) -> Result<(), String> {
    task::spawn_blocking(move || create_folder_b(&email, &password, &folder))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn set_flag(
    email: String,
    password: String,
    folder: String,
    uid: u32,
    flag: String,
    add: bool,
) -> Result<(), String> {
    task::spawn_blocking(move || set_flag_b(&email, &password, &folder, uid, &flag, add))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn delete_message(
    email: String,
    password: String,
    folder: String,
    uid: u32,
) -> Result<(), String> {
    task::spawn_blocking(move || delete_b(&email, &password, &folder, uid))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub async fn send_message(
    email: String,
    password: String,
    from: String,
    to: Vec<String>,
    rfc822: Vec<u8>,
) -> Result<(), String> {
    task::spawn_blocking(move || send_b(&email, &password, &from, &to, &rfc822))
        .await
        .map_err(|e| format!("join: {e}"))?
}
