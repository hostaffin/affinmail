# AffinMail Migration — Batch 2 Brief (worker: OpenCode, default FREE model)

Repo: /var/www/affinmail (master cbc9d85). Work on a NEW branch `mig-batch2`; push the branch when done. Do NOT merge to master, do NOT restart the `affinmail-api` service, do NOT replace the live binary — the PM verifies the gate and deploys.

## Context (Batch 1 is DONE and verified)
- Mail stack live: Postfix 3.10 + Dovecot 2.4 + Rspamd 3.8 + PostgreSQL 18, Maildir /var/mail/vhosts/<domain>/<localpart>/.
- PG db `affinmail` already has tables mail_domains / mail_users / mail_aliases. Credentials: /root/.affinmail-secrets (PG_USER, PG_PASSWORD, PG_DB).
- Seeded: domain affinmail.local, mailbox test1@affinmail.local ({BLF-CRYPT} hash), alias hello@affinmail.local -> test1.
- Dovecot auth reads mail_users via SQL with default_password_scheme BLF-CRYPT — password hashes you write MUST be `{BLF-CRYPT}`-prefixed bcrypt ($2b$) so Dovecot accepts them.
- Rspamd DKIM signing config: /etc/rspamd/local.d/dkim_signing.conf — selector `affin`, key path /var/lib/rspamd/dkim/$domain.$selector.key.
- The Rust backend (server/, binary affinmail-server, API under /api/v1/) currently keeps panel state IN MEMORY. Backend env: /etc/affinmail/backend.env.

## Task — Batch 2: provisioning integration
1. Wire domain / mailbox / alias CRUD in the Rust backend to the mail_* SQL tables (create, suspend/activate, password set/reset, quota, delete) — behind the EXISTING /api/v1 endpoints, same request/response shapes the panel already uses. In-memory demo state must no longer be the source of truth for these entities.
2. Password writes store {BLF-CRYPT} bcrypt hashes Dovecot can verify.
3. Domain creation also generates a DKIM keypair for the domain, stored at the Rspamd path above (private key file, correct ownership/permissions for _rspamd), and records the public key so the panel can show the DNS record.
4. Creating a mailbox must produce a working Postfix/Dovecot record: mail delivered to it lands in its Maildir and IMAP login with the set password works.

## Hard constraints
- NO live outbound mail (rDNS is not set) — local/internal testing only.
- Test with a NEW domain (e.g. batch2.local) + mailbox you create through the API; do not disturb test1@affinmail.local.
- 2 failing tests in server/tests/api_test.rs are PRE-EXISTING — do not make the suite worse; report their status.

## Deliverable
- Branch `mig-batch2` pushed, code builds (`cargo build --release`), test suite run and results noted.
- /var/www/affinmail/BATCH2-REPORT.md: what was built, files changed, test results, and the exact steps the PM can run to verify the gate: create domain+mailbox via API -> IMAP login -> local delivery.
