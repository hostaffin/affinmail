# AffinMail Batch 2 Report

Branch: `mig-batch2` (4 steps, 4 commits)

## What Batch 2 built

**Step 1 — PostgreSQL + bcrypt dependencies** (`89e29ee`)
- Created branch `mig-batch2` from `master`.
- Added `tokio-postgres 0.7` (already present, kept) + `bcrypt 0.15` to `server/Cargo.toml`.
- `cd server && cargo build` clean. Committed `Cargo.toml` + `Cargo.lock`.

**Step 2 — SQL provisioning layer** (`ec581ac`)
- New module `server/src/provision_db.rs`, declared in `lib.rs`.
- `connect_db()` — reads `DATABASE_URL` env, returns tokio-postgres `Client` (NoTls).
- `hash_password()` — bcrypt, `{BLF-CRYPT}`-prefixed; `verify_password()` roundtrip.
- 12 async CRUD functions matching the live `mail_domains` / `mail_users` / `mail_aliases` schema: `create_domain`, `list_domains`, `get_domain_by_id`, `get_domain_by_name`, `delete_domain_by_id`, `create_mailbox`, `get_mailbox`, `list_mailboxes`, `set_mailbox_password`, `set_mailbox_quota`, `set_mailbox_active`, `delete_mailbox`, `create_alias`, `list_aliases`, `delete_alias`.
- Unit test `hash_password_format_and_verify_roundtrip` (format prefix + verify roundtrip + wrong-password rejection).

**Step 3 — Wire HTTP provisioning routes to SQL layer** (`6360b70`)
- `server/src/routes/admin.rs`: `GET/POST/GET/:id/DELETE /api/v1/domains`, `GET/POST/GET/:id/DELETE /api/v1/mailboxes`, `PATCH /api/v1/mailboxes/:id/quota`, `PUT /api/v1/mailboxes/:id/status`, `GET/POST /api/v1/aliases` — all wired to provision_db when `DATABASE_URL` set.
- `server/src/routes/client.rs`: `GET/POST /api/v1/client/domains/:domain/mailboxes`, `PUT/DELETE /api/v1/client/mailboxes/:id`, `PUT /api/v1/client/mailboxes/:id/password`, `GET/POST /api/v1/client/domains/:domain/aliases`, `DELETE /api/v1/client/aliases/:id` — same dual-path.
- Fallback: each handler checks `provision_db::database_configured()`; if `DATABASE_URL` unset → original in-memory `AppState` behaviour (binary safe to run anywhere). No HTTP routes were added/removed; JSON shapes unchanged.

**Step 4 — DKIM key generation on domain create** (`77d1349`)
- Reused existing `security_keys::generate_dkim_keypair` (openssl 2048-bit RSA, selector `affinmail-YYMMDD`) — no parallel system.
- On DB-path domain create: private key written to `/var/lib/rspamd/dkim/<domain>.<selector>.key` (matches Rspamd config `/etc/rspamd/local.d/dkim_signing.conf`: `path = "/var/lib/rspamd/dkim/$domain.$selector.key"`); failure logged, domain creation still succeeds.
- Public key DNS TXT `{selector}._domainkey.<domain>` `v=DKIM1; k=rsa; p=<b64>` returned in `dnsRecords`.
- Domain delete best-effort removes all `*.key` files for the domain in `/var/lib/rspamd/dkim`.
- Added pure formatter `dkim_dns_record(public_key)` + unit test `dkim_dns_record_format`.

## Files changed

- `server/Cargo.toml` — added `bcrypt = "0.15"` (tokio-postgres 0.7 already present)
- `server/Cargo.lock` — regenerated
- `server/src/lib.rs` — `pub mod provision_db;`
- `server/src/provision_db.rs` — new
- `server/src/routes/admin.rs` — dual-path domain/mailbox/alias handlers
- `server/src/routes/client.rs` — dual-path mailbox/alias handlers
- `server/src/security_keys.rs` — `dkim_dns_record`, `dkim_key_file_path`, `write_dkim_key_file`, `delete_all_dkim_keys_for_domain`, unit test
- `BATCH2-REPORT.md` — this file

## Test results (release build)

`cargo build --release`: clean (pre-existing unused-import warnings only).

`cargo test --no-fail-fast`:
- lib tests: **9 passed; 1 failed** — `routes::import_mail::tests::vault_decrypt_php_vector` (`VAULT_KEY not configured`), pre-existing / unrelated.
- main tests: 0 tests.
- integration `tests/api_test.rs`: **7 passed; 2 failed** — `test_client_self_service_and_configs` and `test_admin_and_queue_operations`, both pre-existing per user.
- No NEW failures.

Gate-clearing additions passed: `provision_db::tests::hash_password_format_and_verify_roundtrip`, `security_keys::tests::dkim_dns_record_format`.

## Gate-verification steps for the PM

1. Add `DATABASE_URL` to `/etc/affinmail/backend.env` (do not touch this file during Batch 2 dev; deployment is PMs job).
2. Deploy the release binary (`target/release/affinmail-server`).
3. Restart `affinmail-api`.
4. Verify:
   - `POST /api/v1/domains` with `{"name":"batch2.local", ...}` using the admin token → 201, row present in `mail_domains`.
   - `POST /api/v1/mailboxes` `{"domain_name":"batch2.local","email":"user@batch2.local", ...}` → row present in `mail_users`, password column `{BLF-CRYPT}`-prefixed.
   - IMAP login with mailbox credentials succeeds.
   - Local SMTP delivery to `user@batch2.local` works.
   - DKIM key file present: `/var/lib/rspamd/dkim/batch2.local.<selector>.key`.
   - `DELETE /api/v1/domains/{id}` removes row + best-effort key-file removal.

## Release artifacts

- Binary: `server/target/release/affinmail-server` (requires `openssl` CLI at runtime for DKIM keypair generation).
- No config changes committed; `/etc/affinmail/backend.env` untouched by this batch.
