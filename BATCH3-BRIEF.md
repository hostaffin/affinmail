# AffinMail Migration — Batch 3 Brief (worker: OpenCode, default FREE model; PM drives step-by-step)

Repo: /var/www/affinmail (master 070eed4, Batch 2 merged). Work on branch `mig-batch3`; push it. Do NOT merge, do NOT restart affinmail-api, do NOT replace the live binary — the PM deploys and verifies the gate.

## Context
- Batch 2 is DONE: panel/API provisioning writes real PostgreSQL mail_* tables; mailboxes are real Dovecot accounts. DATABASE_URL is set in /etc/affinmail/backend.env.
- Mail stack: Dovecot IMAP 993 (TLS) / 143 on localhost, Postfix submission 587 STARTTLS (Dovecot SASL), Maildir /var/mail/vhosts.
- The webmail's mail screens today run on the old (Stalwart-era / in-memory) backend path — mail_users accounts cannot actually read/send their real mail in the webmail yet.

## Goal — Batch 3: IMAP bridge for webmail
For accounts that exist in mail_users, the mail operations the webmail uses (folder list, message list, open message, send, reply, sent copy in Sent, basic search) must run over IMAP + submission against Dovecot/Postfix, behind the SAME HTTP endpoints the webmail already calls. Accounts NOT in mail_users keep the existing behaviour (per-account switch based on mail_users membership).

## Test fixtures you may create yourself
Use the Batch 2 API (admin token from /etc/affinmail/backend.env, base http://127.0.0.1:8090/api/v1): create your own domain (e.g. batch3.local) + mailboxes, set passwords via PUT /api/v1/client/mailboxes/:id/password, deliver local mail via SMTP 25. Admin-created mailboxes start with a random password — always set one before IMAP tests.

## Hard constraints
- NO internet outbound mail (rDNS unset) — local .local domains only for tests.
- Non-interactive commands only; PostgreSQL via PGPASSWORD extracted from /root/.affinmail-secrets (never bare psql — it hangs on a password prompt); every bash command under 120s except cargo builds/tests (timeout 600).
- Known pre-existing test failures (do not worsen): vault_decrypt_php_vector, test_client_self_service_and_configs, test_admin_and_queue_operations.

## Gate (PM will verify)
Webmail/API login as a Batch-2 mailbox -> inbox lists real messages -> open works -> send/reply works -> sent copy lands in Sent -> recipient mailbox receives it.
