# BATCH 4 Design — mig-batch4

Branch created from master `22c52d3`. No code changes in this step — design only.

## 1. Admin Queue
Current: `routes/admin.rs` — `list_queue`, `delete_queue_message`, `retry_queue_message` all operate on an in‑memory `state.queue: HashMap<String, QueueMessage>` (populated from admin UI, never persisted to Postfix). No Postfix integration.
Design: Replace the three handlers to invoke Postfix CLI commands that query/manipulate the real mail queue. Commands (run as user `muse` via a fixed sudoers rule):
- `postqueue -j` — list the queue as JSON lines (message-id, sender, recipient, size, status). Use for `list_queue`.
- `postsuper -d <id>` — delete a message by id. Use for `delete_queue_message`.
- `postqueue -i <id>` — force a retry/flush for a message id. Use for `retry_queue_message`.
Sudoers rule (PM step): `muse ALL = NOPASSWD: /usr/bin/postqueue, /usr/bin/postsuper`.
All three commands read/write the real Postfix queue; the in‑memory queue is removed.

## 2. Stats Collector
Current: `stats.rs` — `run_collector()` parses `/var/log/stalwart/` log files, calls `jmap_queue()` over JMAP to Stalwart `127.0.0.1:8080` (`svc_stalwart` column), and inserts `stats_samples` rows with columns `svc_stalwart, svc_pg, svc_redis` etc. Stalwart is absent here.
Design: Switch data sources to the Postfix/Dovecot/Rspamd stack:
- **Queue depth**: `postqueue -j` → parse JSON lines; insert `queue_count` into `stats_samples`.
- **Delivered / deferred / bounced**: parse `/var/log/mail.log` (Postfix smtp/smtpd/lmtp + Dovecot + Rspamd lines) for message completion events. Count per‑category totals and insert into new columns `delivered_count`, `deferred_count`, `bounced_count` (or reuse existing if schema permits).
- **Service health**: `systemctl is-active postfix.service`, `systemctl is-active dovecot.service`, `systemctl is-active rspamd.service` → boolean flags `svc_postfix`, `svc_dovecot`, `svc_rspamd` (inserted into `stats_samples` alongside or replacing `svc_stalwart`).
- **Retain** the existing `stats_samples` schema: keep `svc_stalwart` column but mark it deprecated (=0 always); keep `svc_pg` and `svc_redis` as they are (Postgres & Redis are still used). The `classify()` function and `stats_samples` INSERT can remain; just change the data‑filling logic.
- Fallback: if `/var/log/mail.log` does not exist, keep the `svc_stalwart` path disabled and set all health flags to 0.

## 3. Delivery Tracking
Design a new admin endpoint `GET /api/v1/admin/track-delivery` that searches `/var/log/mail.log` for a given message‑id, recipient, or sender and returns the relevant Postfix status lines.
- Query params: `recipient`, `sender`, `message_id` (any subset).
- Search `/var/log/mail.log` for lines containing the supplied value.
- Return a JSON array of the matching log entries (timestamp, status, sender, recipient, size, etc.).
- If no entries match, return an empty array (not an error).
- This re‑uses the same log‑parsing logic planned for the stats collector; it can share the mail.log reader.

## 4. SSO
Current flow (`/api/v1/auth/sso-token` + `/api/v1/auth/sso-exchange`):
- Admin calls `/auth/sso-token` with account email → gets a one‑time token + signed URL `/auth/sso?token=…`.
- Webmail opens the URL, the backend `sso_exchange` removes the token and returns `{status, session_token, account_id, email}`. **No password is returned.**
- Webmail then calls `login(email, password)` using stored credentials (sessionStorage `affinmail.auth` base64).

Problem: The admin does not know the mailbox password (it is bcrypt‑hashed in `mail_users`). The webmail expects `payload.data` with `{email, password}` (see `webmail/src/App.tsx` SSO effect — it destructures `{email, password}` from `payload.data`).
Design — Vault‑backed:
- Some mailboxes have a `secret_vault` encrypted blob in the `mailboxes` table (decryptable with the runtime vault key). When the account has a vault entry, `sso_exchange` should decrypt it and return `{..., password: <decrypted>}` in the payload so the webmail can log in directly.
- If no vault entry exists, the minimal alternative is: the sso exchange returns a **temporary password** that has just been set on the mailbox (via `POST /mailboxes/{id}/password`), or the admin manually sets one and the webmail logs in with it. The vault‑decrypted path is the preferred Batch‑3‑compatible version.

## 5. Spam Settings
Current: per‑user spam preferences are read/write via the client API (e.g. `set_spam_prefs`) but have no backend mapping — they are in‑memory placeholders.
Design — Map to Rspamd:
- Rspamd stores per‑user settings in `/etc/rspamd/local.d/spam.conf` (or via its HTTP API at `http://127.0.0.1:11334/settings`).
- Backend change: when a user’s spam pref is updated, rewrite the appropriate `spam.conf` fragment for that user (e.g. `user.conf` with `score`, `onebay*,` etc.) and send `rspamc client-learn` / reload signal.
- Feasible in this batch: add a `POST /api/v1/client/spam-prefs` handler that writes `/etc/rspamd/conf.d/spam-${user}.conf` and runs `systemctl reload rspamd` (or `rspamd-client reload`). If Rspamd is not reachable or the config path is unavailable, mark the feature as “deferred — write per‑user config file for later Rspamd integration; UI will show disabled state”.
- Honest scope: this batch adds the backend wiring only; UI changes may follow in a later batch.

## Committable artifacts
- `BATCH4-DESIGN.md` (this file) — design overview for PM & future implementation.
- No code changes are committed in this step; the PM will schedule the actual code work after the design review.