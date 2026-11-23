# Running the AffinMail MCP Server (Rust)

The Rust binary (`mcp-server/`) speaks **MCP over stdin/stdout**. It is started by
the MCP client (Claude Desktop, Cursor, Antigravity, or an MCP gateway), which owns
its pipes — so a plain systemd unit does not fit. Use the client config below, or
supervise it behind a stdio proxy if you need it as a long-lived service.

## Build

```bash
cd /var/www/affinmail/mcp-server
cargo build --release
# binary: /var/www/affinmail/mcp-server/target/release/affinmail-mcp-server
```

## Environment

| Variable | Required | Default | Notes |
| :--- | :--- | :--- | :--- |
| `AFFINMAIL_API_TOKEN` | **yes** | — | JMAP credential. Contains `:` → sent as HTTP Basic (`email:password`, local Stalwart accounts). Otherwise sent as `Bearer`. Server exits with a fatal error if unset/empty. |
| `AFFINMAIL_JMAP_URL` | no | `http://127.0.0.1:8080/jmap` | JMAP base. Session is fetched from the sibling `/jmap/session`. |
| `AFFINMAIL_ADMIN_API_URL` | no | `http://127.0.0.1:8090/api/v1` | Admin REST base for `admin_*` tools. |
| `AFFINMAIL_ADMIN_TOKEN` | no | falls back to `AFFINMAIL_API_TOKEN` | Bearer token for admin API. |
| `AFFINMAIL_AGENT_ID` | no | `affinmail-mcp` | Sent as `X-Agent-ID` on every admin request. |
| `AFFINMAIL_AUDIT_LOG` | no | `/var/www/affinmail/logs/admin-agent-audit.log` | JSONL audit trail for admin calls (parent dir auto-created, failures ignored). |

Nothing in this server performs reputation lookups, DNSBL queries, or outbound mail.
`admin_check_ip_reputation` reports only locally stored `ip_pools` data.

## MCP client config

```json
{
  "mcpServers": {
    "affinmail": {
      "command": "/var/www/affinmail/mcp-server/target/release/affinmail-mcp-server",
      "env": {
        "AFFINMAIL_API_TOKEN": "admin@example.com:secret",
        "AFFINMAIL_JMAP_URL": "http://127.0.0.1:8080/jmap",
        "AFFINMAIL_ADMIN_API_URL": "http://127.0.0.1:8090/api/v1",
        "AFFINMAIL_ADMIN_TOKEN": "REPLACE_WITH_ADMIN_TOKEN",
        "AFFINMAIL_AGENT_ID": "affinmail-mcp"
      }
    }
  }
}
```

## Supervised deployment (optional)

If you must run it under systemd, put a stdio proxy in front of it (e.g.
`socat`/`ncat` bridging a unix socket to the binary's stdio) and point the unit at
that proxy; the binary itself needs no daemon flags.

```ini
[Unit]
Description=AffinMail MCP Server (Rust, stdio)
After=network.target affinmail-api.service stalwart.service

[Service]
User=root
WorkingDirectory=/var/www/affinmail/mcp-server
EnvironmentFile=-/var/www/affinmail/mcp-server/.env
Environment=AFFINMAIL_JMAP_URL=http://127.0.0.1:8080/jmap
Environment=AFFINMAIL_ADMIN_API_URL=http://127.0.0.1:8090/api/v1
Environment=AFFINMAIL_AGENT_ID=affinmail-mcp
ExecStart=/usr/bin/socat UNIX-LISTEN:/run/affinmail-mcp.sock,fork EXEC:/var/www/affinmail/mcp-server/target/release/affinmail-mcp-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
