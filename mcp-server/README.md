# AffinMail MCP Server (Rust)

Model Context Protocol (MCP) Server for programmatic automation of the **AffinMail User Panel** via JMAP (RFC 8620 / RFC 8621).

Allows AI assistants (Antigravity, Claude Desktop, Cursor, and autonomous agents) to interact with AffinMail directly over standard JSON-RPC 2.0 stdio.

---

## 🚀 Features & Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `affinmail_search_emails` | `query`, `folder?`, `limit?`, `unread_only?` | Search user emails across mailbox folders by query or filter |
| `affinmail_get_thread` | `thread_id` | Retrieve full message thread conversation history |
| `affinmail_send_email` | `to`, `subject`, `body`, `cc?`, `bcc?` | Send outbound email via JMAP submission |
| `affinmail_draft_email` | `to`, `subject`, `body`, `draft_id?` | Create or update draft in Drafts folder |
| `affinmail_update_labels` | `thread_id`, `add_labels?`, `remove_labels?` | Star, archive, mark spam, or tag emails |
| `affinmail_get_quota` | *none* | Check mailbox storage consumption and limit |

---

## 🛠️ Build & Run

### 1. Build Native Binary
```bash
cargo build --release
```
The compiled binary will be located at `target/release/affinmail-mcp-server` (or `.exe` on Windows).

### 2. Environment Variables
- `AFFINMAIL_JMAP_URL`: Target JMAP endpoint (defaults to `http://127.0.0.1:8080/jmap/api` or `https://mail.yourdomain.com:2083/jmap/api`)
- `AFFINMAIL_API_TOKEN`: User API token or JMAP Bearer credential

---

## 🤖 MCP Client Configuration

### Claude Desktop / Cursor / Antigravity
Add this entry to your `claude_desktop_config.json` or MCP settings:

```json
{
  "mcpServers": {
    "affinmail-user": {
      "command": "/path/to/affinmail-mcp-server",
      "env": {
        "AFFINMAIL_JMAP_URL": "https://mail.hostaffin.com:2083/jmap/api",
        "AFFINMAIL_API_TOKEN": "aff_user_tok_90812489"
      }
    }
  }
}
```
