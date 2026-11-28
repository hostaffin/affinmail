# Batch 4 Report — Admin on the real stack: queue, stats, tracking, SSO (2026-11-28)

Branch `mig-batch4` (ea86cd0 design, 92f02af queue, 74a1965 stats+tracking,
410dd90 vault, 3710cbc SSO) merged to master as cc6b79e. PM gate fixes on
master: e41a471, 726fe2e (superseded), 89a8d22, 7367f6f. Master HEAD at gate
close: 7367f6f.

## What shipped
- **Admin mail queue = real Postfix.** list_queue parses `postqueue -j`;
  delete validates the id and runs `sudo -n postsuper -d`; retry runs
  `postqueue -i`. Sudoers: /etc/sudoers.d/affinmail-queue (muse NOPASSWD
  postqueue/postsuper only).
- **Stats collector = real sources.** Every 300s: incremental mail.log
  classification into stats_mail_events / stats_domain_events (watermark in
  data/collector-state.json), queue depth from postqueue, service health via
  systemctl (postfix/dovecot/rspamd) written to stats_samples.
- **Delivery tracking.** GET /api/v1/admin/track-delivery?q= greps mail.log,
  returns queue_id/status/dsn/relay/timestamp records (cap 200).
- **SSO password recovery.** AES-256-GCM vault (PHP-format compatible):
  vault_encrypt added next to vault_decrypt; VAULT_KEY read env-first
  (/etc/affinmail/backend.env), api/.env fallback. New mail_users.secret_vault
  column written by every password path (create, panel/API set/reset, client
  change). sso_exchange returns data.{email,password,password_available} in
  the exact shape webmail App.tsx consumes; no vault row -> success with
  password_available:false.

## PM gate (Lily, live, 2026-11-28 evening) — PASSED
- Queue: a deliberately deferred message (defer_transports) listed via the API
  with correct sender/recipient/status; retry forced a REAL delivery
  (postqueue -i bypasses defer_transports — Postfix semantics); a second
  fixture was deleted via the API and gone from postqueue. defer_transports
  reverted afterwards.
- Stats: /api/v1/stats returns 200 with live data; stats_samples rows show
  svc_postfix/dovecot/rspamd/pg = 1; zero panics after the type fixes.
- Track-delivery: found the fixture's records incl. dsn 4.3.2 deferred line.
- SSO: admin-created admin@affinmail.local -> exchange returned its true
  (random-UUID) password -> JMAP login 200 with it, 401 with a wrong one;
  after a password change, a fresh exchange returned the NEW password ->
  JMAP login 200. Full chain proven.

## Gate defects found and fixed by the PM
1. stats_samples / stats_mail_events were never CREATEd anywhere — the
   collector ALTERed/INSERTed into missing tables and swallowed the errors.
   CREATE TABLE IF NOT EXISTS added in run_collector (e41a471).
2. The collector was silently dead since the Stalwart era: stats.rs
   pg_params() reads /etc/affinmail-stats.env or the Stalwart config JSON —
   neither existed, and stats.rs ignores DATABASE_URL. Server fix (no code
   change): created /etc/affinmail-stats.env (600, muse) with the affinmail
   PG credentials. Follow-up worth doing: make stats.rs use DATABASE_URL
   like the rest of the backend and retire the stats.env path.
3. mail.log was unreadable by the backend (syslog:adm 640) — track-delivery
   returned "log file not accessible". Fixed by adding muse to the adm group.
4. track-delivery never extracted queue ids (the token carries a trailing
   colon, failing its alnum test). Parser now takes the token after the
   "proc[pid]: " tag (e41a471).
5. Mixed integer widths on stats_samples.queue_count (code reads it as i32
   in queueSeries, i64 in the overview fallback) panicked tokio-postgres.
   Column is integer; the fallback casts ::bigint in SQL (89a8d22, 7367f6f).

## Honest limitations / deferred
- Spam settings: design scoped as backend-wiring/deferred — client spam
  prefs remain placeholders; no Rspamd settings files are written yet.
- svc_redis samples 0: the stats probe connects without auth, the Redis
  requires a password. rep_score populates from the second collector cycle.
- Retry endpoint's response message object is a stub (empty fields) — the
  action is real; the shape is pre-existing.
- Panel auth remains prototype-grade; the :2083 standalone domain panel and
  production auth are outside Batch 4 (unchanged from the plan).
- Test baseline held throughout: lib 11 passed / 1 failed — the failure is
  vault_decrypt_php_vector, expected and permanent (the PHP-era VAULT_KEY
  was lost with the old VPS; a fresh key was generated 2026-11-28).
