# AffinMail MCP Server (Rust)

Model Context Protocol (MCP) Server for programmatic automation of the **AffinMail
User Panel** via JMAP (RFC 8620 / RFC 8621) and the **Admin REST API** (`/api/v1`).

14 tools: 6 `affinmail_*` (mailbox) + 8 `admin_*` (cluster administration).
Transport is JSON-RPC 2.0 over stdio.

---

## 🚀 Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `affinmail_search_emails` | `query`, `folder?`, `limit?`, `unread_only?` | `Mailbox/get` resolves the folder name/role to an ID, `Email/query`, then `Email/get` for real message bodies |
| `affinmail_get_thread` | `thread_id` | `Thread/get` conversation history |
| `affinmail_send_email` | `to`, `subject`, `body`, `cc?`, `bcc?` | `Email/set` into the resolved Sent mailbox + `EmailSubmission/set` |
| `affinmail_draft_email` | `to`, `subject`, `body`, `draft_id?` | `Email/set` create, or update keyed by `draft_id`, in the resolved Drafts mailbox |
| `affinmail_update_labels` | `thread_id`, `add_labels?`, `remove_labels?` | `Thread/get` → keyword patch on each email ID |
| `affinmail_get_quota` | *none* | `Quota/get` + `Mailbox/get` counts (`used`, `limit`, `totalEmails`, `totalThreads`, unread, raw responses) |
| `admin_get_system_health` | *none* | `GET /health` |
| `admin_create_domain` | `domain`, `storage_quota_mb`, `max_mailboxes?`, `max_attachment_mb?` | `POST /domains` (`storage_quota_mb` → `diskQuotaMb`) |
| `admin_provision_mailbox` | `email`, `quota_mb`, `password`, `display_name?` | `POST /mailboxes` (`quota_mb` → `quotaLimitMb`) |
| `admin_assign_egress_ip` | `domain`, `ip_address` | `POST /ippools/assign` |
| `admin_check_ip_reputation` | `ip_address?` | `GET /ip-pools` only; reputation graded **locally** from stored `reputation_score` / `is_blacklisted` / allocations. No DNSBL, no network |
| `admin_switch_storage_tier` | `tier` | `POST /storage/switch`; a 404 is returned as the API's own error text, never faked as success |
| `admin_trigger_auto_repair` | *none* | `POST /system/auto-repair`; on 404 falls back to `POST /system/restart` and notes the fallback |
| `admin_create_backup` | *none* | `POST /system/backup` |

Every admin request sends `Authorization: Bearer`, `X-Agent-ID`, and appends
`{ts,agent,method,path,status}` to the audit log.

---

## 🛠️ Build & Run

### 1. Build Native Binary
```bash
cargo build --release
```
Binary: `target/release/affinmail-mcp-server` (`.exe` on Windows).

### 2. Environment Variables

| Variable | Required | Default |
| :--- | :--- | :--- |
| `AFFINMAIL_API_TOKEN` | **yes** | — (fatal exit if unset/empty) |
| `AFFINMAIL_JMAP_URL` | no | `http://127.0.0.1:8080/jmap` |
| `AFFINMAIL_ADMIN_API_URL` | no | `http://127.0.0.1:8090/api/v1` |
| `AFFINMAIL_ADMIN_TOKEN` | no | falls back to `AFFINMAIL_API_TOKEN` |
| `AFFINMAIL_AGENT_ID` | no | `affinmail-mcp` |
| `AFFINMAIL_AUDIT_LOG` | no | `/var/www/affinmail/logs/admin-agent-audit.log` |

`AFFINMAIL_API_TOKEN` semantics:
* contains `:` → sent as **HTTP Basic** (`email:password`, local Stalwart accounts)
* otherwise → sent as **Bearer**

The JMAP session is fetched from `{base}` with trailing `/jmap` replaced by
`/jmap/session`; `accountId` comes from `primaryAccounts["urn:ietf:params:jmap:mail"]`
(falling back to the first account key) and is injected into every JMAP method call.

Deployment notes: `deploy/systemd/affinmail-mcp.md`.

---

## 🤖 MCP Client Configuration

### Claude Desktop / Cursor / Antigravity
```json
{
  "mcpServers": {
    "affinmail": {
      "command": "/var/www/affinmail/mcp-server/target/release/affinmail-mcp-server",
      "env": {
        "AFFINMAIL_JMAP_URL": "http://127.0.0.1:8080/jmap",
        "AFFINMAIL_API_TOKEN": "user@example.com:password",
        "AFFINMAIL_ADMIN_API_URL": "http://127.0.0.1:8090/api/v1",
        "AFFINMAIL_ADMIN_TOKEN": "REPLACE_WITH_ADMIN_TOKEN",
        "AFFINMAIL_AGENT_ID": "affinmail-mcp"
      }
    }
  }
}
```
