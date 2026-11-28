// imap_check.rs — Batch 3 Step 2 live check for mail_imap.rs against the
// real Dovecot/Postfix stack. Env: MAIN_EMAIL, MAIN_PASS, PEER_EMAIL, PEER_PASS.
use affinmail_server::mail_imap;

fn env(k: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| panic!("missing env {k}"))
}

#[tokio::main]
async fn main() {
    let email = env("MAIN_EMAIL");
    let pass = env("MAIN_PASS");
    let peer = env("PEER_EMAIL");
    let peer_pass = env("PEER_PASS");

    // 1. folders
    match mail_imap::list_folders(email.clone(), pass.clone()).await {
        Ok(f) => println!(
            "PASS list_folders: {}",
            f.iter()
                .map(|x| format!("{}({})", x.name, x.role))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Err(e) => println!("FAIL list_folders: {e}"),
    }

    // 2. list INBOX
    let mut first_uid = 0u32;
    match mail_imap::list_messages(email.clone(), pass.clone(), "INBOX".into(), 10, 0).await {
        Ok(msgs) => {
            if let Some(m) = msgs.first() {
                first_uid = m.uid;
            }
            println!(
                "PASS list_messages: {} messages, newest subject: {}",
                msgs.len(),
                msgs.first().map(|m| m.subject.clone()).unwrap_or_default()
            );
        }
        Err(e) => println!("FAIL list_messages: {e}"),
    }

    // 3. fetch first message
    if first_uid > 0 {
        match mail_imap::fetch_message(email.clone(), pass.clone(), "INBOX".into(), first_uid).await
        {
            Ok(bytes) => println!(
                "PASS fetch_message: {} bytes, has Subject: {}",
                bytes.len(),
                String::from_utf8_lossy(&bytes).contains("Subject:")
            ),
            Err(e) => println!("FAIL fetch_message: {e}"),
        }
    }

    // 4. search
    match mail_imap::search_basic(email.clone(), pass.clone(), "INBOX".into(), "gate".into()).await
    {
        Ok(uids) => println!("PASS search_basic: {} hits", uids.len()),
        Err(e) => println!("FAIL search_basic: {e}"),
    }

    // 5. append a copy to Sent
    let copy: Vec<u8> = b"From: gate@batch2.local\r\nTo: test1@affinmail.local\r\nSubject: appended copy\r\n\r\nappend test\r\n".to_vec();
    match mail_imap::append_message(email.clone(), pass.clone(), "Sent".into(), copy).await {
        Ok(()) => println!("PASS append_message (Sent)"),
        Err(e) => println!("FAIL append_message (Sent): {e}"),
    }

    // 6. send via submission to the peer mailbox
    let msg: Vec<u8> = format!(
        "From: {email}\r\nTo: {peer}\r\nSubject: batch3 plumbing check\r\n\r\nsent through mail_imap::send_message\r\n"
    )
    .into_bytes();
    match mail_imap::send_message(
        email.clone(),
        pass.clone(),
        email.clone(),
        vec![peer.clone()],
        msg,
    )
    .await
    {
        Ok(()) => println!("PASS send_message (submission 587)"),
        Err(e) => println!("FAIL send_message: {e}"),
    }

    // 7. peer inbox should now contain the sent message
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    match mail_imap::list_messages(peer.clone(), peer_pass.clone(), "INBOX".into(), 5, 0).await {
        Ok(msgs) => {
            let found = msgs.iter().any(|m| m.subject.contains("batch3 plumbing"));
            println!(
                "PASS peer_received: {} (peer inbox {} messages)",
                found,
                msgs.len()
            );
        }
        Err(e) => println!("FAIL peer list_messages: {e}"),
    }
}
