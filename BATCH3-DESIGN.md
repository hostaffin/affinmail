# AffinMail Migration — Batch 3 Design (Step 1 of several)

Branch: `mig-batch3`. Base: master `070eed4`. No code changes in this step.

## 1. Goal

Mail operations the webmail frontend performs today (folder list, message list,
open, send, reply, sent copy, search) must run over **IMAP + submission against
Dovecot/Postfix** behind the **same HTTP endpoints the webmail already calls**.
Accounts present in `mail_users` go live; accounts absent from `mail_users` keep
current behaviour.

## 2. Current endpoint map (webmail → HTTP → backing)

Webmail calls only these four shapes for mail (verified in `webmail/src/lib/jmap.ts`):

| # | Webmail call | Frontend code | Current backing | Batch 3 IMAP backing |
|---|-------------|---------------|-----------------|---------------------|
| 1 | `GET /jmap/session` | `getSession()` | Caddy `/jmap*` → **Stalwart 127.0.0.1:8080** JMAP | Rust IMAP client → **Dovecot :993** |
| 2 | `POST /jmap/` `{using, methodCalls}` | `request()` (Mailbox/get, Email/query, Email/get, Thread/get, Email/set, EmailSubmission/set, Quota/get, Identity/get) | Caddy `/jmap*` → **Stalwart 127.0.0.1:8080** JMAP | Translate to **IMAP** ops → **Dovecot :993** |
| 3 | `POST /jmap/upload/{accountId}/` | `uploadBlob()` | Caddy `/jmap*` → **Stalwart 127.0.0.1:8080** JMAP | **IMAP** → `/drafts` append or `Drafts` via IMAP |
| 4 | `GET /jmap/download/...` | `downloadBlob()` | Caddy `/jmap*` → **Stalwart 127.0.0.1:8080** JMAP | **IMAP** `FETCH`/`BODY` fetch → Maildir → return RFC822 |

Supporting (not IMAP-backed; state only, not moved):

| # | Webmail call | Purpose | Batch 3 status |
|---|-------------|---------|----------------|
| A | `GET/POST /api/v1/auth/*`, `/api/v1/client/*`, `/api/v1/admin/*` | Panel/auth/SSO/MCP/etc — not mail-read/send | Unchanged |

Notes:

- Webmail mail traffic path today: browser → Caddy (`/jmap*`) → **Stalwart :8080**. Vite dev proxies `/jmap` → `127.0.0.1:8080`. Caddyfile confirmed in `deploy/Caddyfile`.
- Backend Rust API (`affinmail-server`, port 2087/8090) holds NO `/jmap` routes today — the whole JMAP surface is answered by Stalwart directly through Caddy.
- Folder = JMAP `Mailbox/get` with `role` field; role→folder map in webmail `App.tsx` (`inbox`, `sent`, `drafts`, `trash`, `junk`, `archive`). `Drafts` role mailbox, `Sent` role mailbox, `Archive`/`Trash` via `Mailbox/set`.
- Message identity: JMAP message `id` (hex blob) + `threadId`. Batch 3 must keep the same request/response shapes so frontend unchanged.
- Send flow: `createAndSubmit` = `Email/set` (create draft in `Drafts`) → `EmailSubmission/set` (submit, `onSuccessUpdateEmail` moves to `Sent`) → reply = same path with `to: [senderEmail]`, subject `Re:`.
- Search: `Email/query` with `text/from/to/subject/keyword` filters.
- Quota: `Quota/get`.

## 3. Session credential approach

- Webmail login: `login(email, password)` in `webmail/src/lib/jmap.ts` → stores
  `{ email, basic: base64(email:password) }` in **sessionStorage** key
  `affinmail.auth`, then `GET /jmap/session` with `Authorization: Basic <basic>`.
- The browser session already holds the mailbox login password (base64 in
  sessionStorage). No new token needed for IMAP/SMTP — the Basic creds can be
  reused directly for Dovecot/Postfix auth.
- Backend design (to be written in Batch 3 steps 2–5):
  - Accept Basic-auth-backed JMAP session per active mailbox.
  - Resolve mailbox by email (`mail_users.email`) → get `mail_users` row
    (id, `{BLF-CRYPT}` password hash — Dovecot already reads same table with
    `BCRYPT` scheme, so IMAP login = verify against that hash via Dovecot).
  - For IMAP: use the verified plaintext password for an IMAP LOGIN against
    Dovecot `:993` (or `:143` TLS). Server-side keeps only per-session handle;
    never persists plaintext beyond session lifetime.
  - For submission: SMTP AUTH via **Postfix :587 STARTTLS (Dovecot SASL)** using
    the same mailbox credentials (Dovecot SASL backend reads same `mail_users`).
  - Accounts not in `mail_users` (in-memory `AppState` mailboxes) → keep existing
    behaviour (Stalwart/in-memory path or fail loudly).

## 4. IMAP client crate choice

Recommended: **`imap` crate (imap-rs) with `rustls` feature** for IMAP, plus
**`lettre`** for SMTP submission.

Why this fits the existing set:

- Existing server deps already use **rustls** (via `reqwest` features
  `default-features = false, features = ["json", "rustls-tls"]`) → `imap` with
  `rustls` feature drops into the same TLS posture; no native-tls addition.
- `imap` (imap-rs) is the most mature, RFC-compliant async/sync IMAP client in
  Rust; supports LOGIN, SELECT, LIST, FETCH, SEARCH, MOVE, STORE, APPEND — all
  required for JMAP→IMAP translation and Sent/Drafts handling.
- `lettre` is the de-facto async SMTP client for Rust submission; supports
  tokio runtime and TLS; speaks AUTH PLAIN/LOGIN which Dovecot SASL accepts.

Alternatives rejected (for now): hand-rolled IMAP over TLS socket (more work,
error-prone), Stalwart as backend while keeping JMAP (reverts Batch 3 goal).

## 5. Step breakdown (steps 2–5)

- **Step 2 — IMAP client + session plumbing**: add `imap` (+`rustls`) and
  `lettre` deps to `server/Cargo.toml`; new module
  `server/src/mail_imap.rs` holding IMAP/SMTP client session handle keyed by
  mailbox/email (per-user connection or shared). Unit test: credential
  exchange against a stub? (No — no live infra in unit tests; at minimum a
  connect-timeout + auth-failure path).
- **Step 3 — JMAP endpoint translation layer**: serve `/jmap/session` and
  `/jmap/` (and upload/download) on the **Rust backend** behind same paths, or
  re-route Caddy `/jmap*` to backend. Map JMAP methods → IMAP ops per mailbox.
- **Step 4 — Send/reply/Sent**: SMTP AUTH submission via Postfix :587; Sent
  copy = IMAP message copy/append to Sent mailbox; Drafts save via IMAP
  append.
- **Step 5 — Gate wiring**: webmail login → IMAP → real inbox list → open →
  send → Sent → recipient receives (Batch 2 fixtures: batch3.local +
  gate@batch3.local), plus fallback for accounts not in `mail_users`.

## 6. Risks / notes

- JMAP↔IMAP mapping is the hard part (Thread/get grouping, Email/query search
  filters incl. `hasKeyword`, collapsed threads, draft handling).
- Session store currently in-memory `AppState`; Batch 3 adds per-mailbox
  active IMAP connections or on-demand connect-per-request (lazy connect first
  connection, keep alive).
- No internet outbound mail — keep test sends local (batch3.local).
- Do not touch live binary restart / deploy in this batch; PM deploys & verifies gate.
