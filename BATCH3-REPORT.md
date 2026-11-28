# Batch 3 Report — mig-batch3

## 1. What Was Built

### `server/src/mail_imap.rs` — IMAP + SMTP plumbing
Per-request async session handle keyed by email+password. All blocking imap/native-tls calls wrapped in `tokio::task::spawn_blocking`. Public API:
- `list_folders(email, password)` → `Vec<FolderEntry>` with role mapping (inbox/sent/drafts/trash/junk/archive/other)
- `list_messages(email, password, folder, limit, offset)` → newest-first `Vec<MessageEntry>` (uid/flags/from/to/subject/date/size)
- `fetch_message(email, password, folder, uid)` → `Vec<u8>` RFC822 bytes
- `search_basic(email, password, folder, query)` → UIDs filtered client-side from envelope text
- `append_message(email, password, folder, bytes)` → append RFC822 to a mailbox (Sent/Drafts)
- `send_message(email, password, from, to, subject, body)` → SMTP AUTH LOGIN via Postfix :587 STARTTLS (lettre)
- `folder_counts(email, password, folder)` → `(total, unseen)` via `uid_search ALL`/`UNSEEN` + `select`

Added `native-tls = "0.2"` to `Cargo.toml` for permissive cert acceptance (snakeoil).

### `server/src/jmap.rs` — JMAP layer answering webmail calls
Two endpoints registered in `lib.rs` without touching existing `/api` routes:
- `GET /jmap/session` → JmapSession (username, apiUrl `/jmap/`, uploadUrl `/jmap/upload/{accountId}/`, downloadUrl `/jmap/download/{accountId}/{blobId}/{name}?type={type}`, accounts, primaryAccounts, capabilities)
- `POST /jmap/` → dispatch methodCalls: `Mailbox/get`, `Identity/get`, `Email/query`, `Email/get`, `Thread/get`, `Email/set`, `EmailSubmission/set`, `Quota/get`

Per-account switch: email must exist in `mail_users` (DATABASE_URL) else 401. Other accounts keep existing in-memory behaviour.

Methods implemented:
| Method | What it does |
|---|---|
| `Mailbox/get` | Folders from `list_folders` + `folder_counts` (total/unread); `id=folder name`, `parentId=null`, `role=mapped`, `isSubscribed=true` |
| `Identity/get` | One identity: `id="1"`, `email`, `name`, `replyTo=null` |
| `Email/query` | `filter.inMailbox` → `mail_imap::search_basic`; `filter.text` same; `position`/`limit`; returns `accountId`, `queryState:"0"`, `canCalculateChanges:false`, `total`, `ids=<folder>:<uid>` |
| `Email/get` | Per id `<folder>:<uid>`: fetch RFC822 via `fetch_message`, parse with `mail-parser 0.9` → JmapEmail (subject, from/to/cc as Address lists, `receivedAt` ISO8601 UTC from Date header, keywords from IMAP flags, `mailboxIds{folder:true}`, `preview`, `hasAttachment`, `bodyValues{text/html}`, `textBody`/`htmlBody` part descriptors) |
| `Thread/get` | One thread per email: `emailIds:[id]` |
| `Email/set create` | Build RFC822 from mailboxIds+subject+from/to/bodyValues, `append_message` to target folder, return new uid via `search_basic`, `created { clientId: { id: "<folder>:<newuid>", threadId } }` |
| `Email/set update` | Keywords: `$seen`→`\Seen`, `$flagged`→`\Flagged`, `$draft`→`\Draft` via `mail_imap::set_flag`; mailboxIds change = move: `fetch_message`→`append_message(target)`→`delete_message(source)`. Returns `updated { id: null }` / `notUpdated` with `serverFail` per failure |
| `Email/set destroy` | `mail_imap::delete_message` per id; returns `destroyed [ids]` / `notDestroyed` on failure |
| `EmailSubmission/set` | Fetch draft RFC822 via `fetch_message`, send via `send_message`, append same bytes to `Sent`, delete draft. Returns `created { clientId: { id, emailId, threadId } }` / `notCreated` with `serverFail` on fetch/send failure |
| `Quota/get` | One entry: `{ id:"quota", resourceType:"octets", used, hardLimit (= quota_mb*1024*1024 or null), limit, free, scope:"account", types:["Email"] }`; message sizes summed via `list_messages` per folder (limit 100000) |

### Serde_json discipline observed
All Value accessor **methods**: `.as_str()`, `.as_u64()`, `.as_object()`, `.as_array()` — never pattern-match by value against `&Value`. All result maps (`created`, `updated`, `destroyed`, `notCreated`, `notUpdated`, `notDestroyed`) are `HashMap<String, Value>`. Build, rebuild, and re‑commit confirmed all 13 build errors from the prior round resolved.

### Remaining step (PM gate time)
Caddy `/jmap*` → `127.0.0.1:8090` (the Rust backend) — the PM deploys and verifies the gate at the end of Batch 3.

## 2. Test Results

| Suite | Tests | Passed | Failed | Notes |
|---|---|---|---|---|
| Library (`cargo test`) | 11 | 10 | 1 | `vault_decrypt_php_vector` — env‑dependent (needs `VAULT_KEY`), pre‑existing |
| Integration / API tests | — | — | — | Requires running server; 2 pre‑existing failures (`test_client_self_service_and_configs`, `test_admin_and_queue_operations`) are unchanged and were not run in this detached lib‑only invocation |

No new failures beyond the baseline.

## 3. Commit History (mig‑batch3)

| Commit | Message |
|---|---|
| `298ee50` | Initial mail_imap.rs plumbing (Batch 3 Step 2e) |
| `1dd3656` | batch3 step3b: Email/query + Email/get + Thread/get |
| `b2f4009` | batch3 step3c1: Email/set (create) |
| `5bb66fb` | batch3 step3c2: Email/set update+destroy |
| `7b94853` | batch3 step3c3: EmailSubmission/set + Quota/get |

## 4. To‑Do (PM deploys)

- Caddy `/jmap*` → `127.0.0.1:8090` (live binary gate — PM handles)
- Verify end‑to‑end: webmail login → inbox lists real messages → open → send → Sent → recipient receives.