# AffinMail MCP Server (Rust)

Model Context Protocol (MCP) Server for programmatic automation of the **AffinMail
User Panel** via JMAP (RFC 8620 / RFC 8621) and the **Admin REST API** (`/api/v1`).

Supports canonical user tools (F-076), backward-compatible `affinmail_*` aliases,
cluster administration tools, MCP Resources, MCP Prompts, Token Scopes (F-077),
and MCP Audit Logging (F-078).

Transport is JSON-RPC 2.0 over stdio.

---

## 🚀 Tools

### 1. User Tools (Canonical + Aliases)

| Tool | Parameters | Description | Required Scope |
| :--- | :--- | :--- | :--- |
| `search_emails` / `affinmail_search_emails` | `query?`, `folder?`, `sender?`, `limit?`, `unread_only?`, `before?`, `after?` | Search emails across mailbox by keyword, folder, sender, status, or date range | `mcp:read` |
| `read_email` | `email_id` (or `id`) | Read full email content (subject, from, to, cc, date, body_text, body_html, attachments) | `mcp:read` |
| `list_folders` | *none* | List all mail folders with unread and total email/thread counts | `mcp:read` |
| `compose_draft` / `affinmail_draft_email` | `to`, `subject`, `body`, `cc?`, `bcc?`, `draft_id?` | Create or update editable draft in Drafts folder | `mcp:write` |
| `send_email` / `affinmail_send_email` | `to`, `subject`, `body`, `cc?`, `bcc?` | Send outbound email via JMAP EmailSubmission | `mcp:send` |
| `move_emails` | `email_ids` (or `email_id`), `target_folder` | Move email IDs to a target folder (e.g. `archive`, `trash`, `inbox`) | `mcp:write` |
| `flag_emails` / `affinmail_update_labels` | `email_ids`, `action?`, `flagged?`, `read?`, `archive?`, `add_labels?`, `remove_labels?` | Update flags (flag, unflag, read, unread, archive) or labels | `mcp:write` |
| `list_contacts` | `query?`, `limit?` | List or search contacts from address book and recent email correspondents | `mcp:read` |
| `get_mailbox_stats` / `affinmail_get_quota` | *none* | Returns `total_emails`, `unread`, `storage_used_mb`, `storage_quota_mb`, `sent_today` | `mcp:read` |
| `affinmail_get_thread` | `thread_id` | Retrieve full conversation thread and messages by thread ID | `mcp:read` |

### 2. Cluster Admin Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `admin_get_system_health` | *none* | `GET /health` |
| `admin_create_domain` | `domain`, `storage_quota_mb`, `max_mailboxes?`, `max_attachment_mb?` | `POST /domains` (`storage_quota_mb` → `diskQuotaMb`) |
| `admin_provision_mailbox` | `email`, `quota_mb`, `password`, `display_name?` | `POST /mailboxes` (`quota_mb` → `quotaLimitMb`) |
| `admin_assign_egress_ip` | `domain`, `ip_address` | `POST /ippools/assign` |
| `admin_check_ip_reputation` | `ip_address?` | `GET /ip-pools` only; local reputation score / allocations |
| `admin_switch_storage_tier` | `tier` | `POST /storage/switch` |
| `admin_trigger_auto_repair` | *none* | `POST /system/auto-repair` (fallback to `/system/restart` on 404) |
| `admin_create_backup` | *none* | `POST /system/backup` |

---

## 📂 MCP Resources (`resources/list`, `resources/read`)

| URI | Name | Description |
| :--- | :--- | :--- |
| `mailbox://inbox/recent` | Recent Inbox Emails | Last 20 emails in the user inbox |
| `mailbox://stats` | Mailbox Statistics | Current mailbox statistics including email counts and storage usage |
| `mailbox://folders` | Mailbox Folders | Folder structure with unread and total email counts |

---

## 💬 MCP Prompts (`prompts/list`, `prompts/get`)

| Prompt Name | Arguments | Description |
| :--- | :--- | :--- |
| `summarize_inbox` | `limit?` (integer, default: 20) | Summarize recent emails and identify high-priority messages |
| `draft_reply` | `email_id` (required string), `instructions?` (string) | Draft a context-aware professional reply to a specific email |
| `find_action_items` | `limit?` (integer, default: 20) | Scan recent emails to find pending tasks, action items, and deadlines |

---

## 🔒 Token Scopes & Security (F-077)

Enforced via `AFFINMAIL_MCP_SCOPES` (defaults to `mcp:read,mcp:write,mcp:send`):
* `mcp:read`: Required for searching, reading emails, folders, contacts, stats, resources, and prompt context generation.
* `mcp:write`: Required for drafting, moving, and flagging emails.
* `mcp:send`: Required for outbound email transmission.

Calls lacking required scope return `isError: true` with `"Permission denied: operation requires scope '...'"` and code `-32003`.

---

## 📝 MCP Audit Logging (F-078)

Every tool call is recorded to `AFFINMAIL_MCP_AUDIT_LOG` (defaults to `/var/www/affinmail/logs/mcp-audit.log`) in JSON Lines:
```json
{"ts":1795521600,"timestamp":"2026-11-24T12:00:00Z","tool":"send_email","status":"success","agent":"affinmail-mcp","detail":null}
```

---

## 🛠️ Build & Run

```bash
cargo build --release
cargo test
```
Binary: `target/release/affinmail-mcp-server` (`.exe` on Windows).
