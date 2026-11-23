# AffinMail: AI Agent Admin API Automation Plan

---

## 1. Executive Summary & Vision

AffinMail's dual-panel architecture cleanly decouples concerns:
* **User Panel (`:2083` / `:443`):** Automated by end-user AI assistants via the **Model Context Protocol (MCP)** Rust Server.
* **Admin Panel (`:2087` / `/api/v1`):** Automated by autonomous **DevOps / SysOps AI Agents** via the **Admin REST API**.

This document outlines the complete architectural plan, endpoint specifications, and tool schemas required for an AI Agent to perform zero-touch server management, client domain onboarding, IP warm-up orchestration, and automated fault recovery.

---

## 2. Authentication & Governance

### 2.1 Security Model
* **Transport:** TLS 1.3 encrypted HTTPS on port `2087` (proxied by Caddy).
* **Header:** `Authorization: Bearer <STALWART_ADMIN_SECRET>`
* **Audit Trail:** Every action executed by the AI Agent must pass an `X-Agent-ID: <agent_name>` header and is logged to `/opt/affinmail/logs/admin-agent-audit.log`.
* **Rate Limiting:** Managed natively via Redis 7 Leaky-Bucket (120 req/minute per agent token).

```
[ AI Agent Engine ] ──── (HTTPS :2087 + Bearer Token) ────> [ Caddy Reverse Proxy ]
                                                                     │
                                                        [ Stalwart Admin API :8080 ]
                                                                     │
                                                   ┌─────────────────┴─────────────────┐
                                                   ▼                                   ▼
                                            [ PostgreSQL 16 ]                   [ Redis 7 Cache ]
```

---

## 3. Agent Toolset & REST Endpoint Mapping

An autonomous AI Agent receives the following standardized tools to govern the cluster:

| AI Agent Tool Name | Admin REST Endpoint | Method | Operational Purpose |
| :--- | :--- | :--- | :--- |
| `admin_get_system_health` | `/api/v1/system/health` | `GET` | Returns CPU, RAM, disk usage, active connections, and daemon states. |
| `admin_create_domain` | `/api/v1/domains` | `POST` | Provisions a new domain, generates 2048-bit DKIM keys, and assigns IP pool. |
| `admin_provision_mailbox` | `/api/v1/mailboxes` | `POST` | Creates client mailbox with plan-enforced quota (MB) and password. |
| `admin_assign_egress_ip` | `/api/v1/ippools/assign` | `POST` | Binds a domain to a dedicated egress IPv4 address or shared pool. |
| `admin_check_ip_reputation` | `/api/v1/ippools/reputation` | `GET` | Queries Spamhaus DNSBL and PTR status for all server IP addresses. |
| `admin_switch_storage_tier` | `/api/v1/storage/switch` | `POST` | Hot-swaps blob backend between local NVMe, S3 (Cloudflare R2), and SFTP. |
| `admin_trigger_auto_repair` | `/api/v1/system/auto-repair` | `POST` | Executes automated schema sync, permission repair, and service restarts. |
| `admin_create_backup` | `/api/v1/system/backup` | `POST` | Triggers compressed PostgreSQL + configuration snapshot to `/opt/affinmail/backups/`. |

---

## 4. OpenAPI / Function Calling Tool Schemas

AI Agents (such as Gemini 1.5/2.0, Claude 3.5, or GPT-4o) consume JSON schemas to trigger function calls:

### 4.1 `admin_create_domain`
```json
{
  "name": "admin_create_domain",
  "description": "Provisions a new domain on the AffinMail cluster and generates its cryptographic DNS records (DKIM, SPF, DMARC).",
  "parameters": {
    "type": "object",
    "properties": {
      "domain": {
        "type": "string",
        "description": "Fully qualified domain name (e.g. 'company.com')"
      },
      "storage_quota_mb": {
        "type": "integer",
        "description": "Total aggregated storage quota allocated to domain in MB"
      },
      "use_dedicated_ip": {
        "type": "boolean",
        "description": "Whether to allocate a clean dedicated IPv4 or use shared pool"
      }
    },
    "required": ["domain", "storage_quota_mb"]
  }
}
```

### 4.2 `admin_provision_mailbox`
```json
{
  "name": "admin_provision_mailbox",
  "description": "Provisions an individual user mailbox under an existing domain with quota limits.",
  "parameters": {
    "type": "object",
    "properties": {
      "email": {
        "type": "string",
        "description": "Full email address (e.g. 'alice@company.com')"
      },
      "display_name": {
        "type": "string",
        "description": "User full name"
      },
      "quota_mb": {
        "type": "integer",
        "description": "Mailbox storage quota in Megabytes (e.g. 5000)"
      },
      "password": {
        "type": "string",
        "description": "Initial argon2id hashed or plaintext secure password"
      }
    },
    "required": ["email", "quota_mb", "password"]
  }
}
```

### 4.3 `admin_assign_egress_ip`
```json
{
  "name": "admin_assign_egress_ip",
  "description": "Assigns outbound IP routing to guarantee 10/10 deliverability and isolate marketing vs transactional traffic.",
  "parameters": {
    "type": "object",
    "properties": {
      "domain": {
        "type": "string",
        "description": "Domain to route"
      },
      "ip_address": {
        "type": "string",
        "description": "Assigned IPv4 address from server pool"
      },
      "warmup_daily_limit": {
        "type": "integer",
        "description": "Current throttling limit during progressive IP warm-up phase"
      }
    },
    "required": ["domain", "ip_address"]
  }
}
```

---

## 5. Autonomous Agent Workflows

### 5.1 Workflow A: Zero-Touch Client Onboarding
```
[ Trigger: New Client Order ]
           │
           ▼
1. AI Agent calls: `admin_create_domain("client.com", quota=50000)`
           │
           ├─ Returns: DKIM public key, SPF string, DMARC policy
           │
2. AI Agent calls: `admin_provision_mailbox("admin@client.com", ...)`
           │
3. AI Agent verifies DNS propagation via dig / DNS-over-HTTPS
           │
           ▼
[ Status: Active & Ready ]
```

### 5.2 Workflow B: Autonomic IP Warm-Up Schedule
When a new dedicated IPv4 is deployed, the AI Agent monitors outbound volume daily:
* **Day 1–3:** Cap at 500 messages/day. Query Spamhaus & Barracuda reputation.
* **Day 4–7:** Increase limit to 2,500 messages/day.
* **Day 8–14:** Increase limit to 10,000 messages/day.
* **Day 15+:** Uncapped production routing.
* **If blacklisted:** Agent automatically routes non-critical outbound mail to SmartHost relay (SES/SendGrid) and alerts administrator.

### 5.3 Workflow C: Self-Healing & Anomaly Recovery
* Agent polls `admin_get_system_health` every 60 seconds.
* If PostgreSQL disk usage > 90%: Agent triggers `admin_switch_storage_tier("s3")` to offload blobs to Cloudflare R2 immediately.
* If Port 25 listener stalls: Agent calls `admin_trigger_auto_repair()` to restart Stalwart unit and verifies socket binding.

---

## 6. Implementation Summary

1. **User Panel Automation:** Powered by the Rust MCP server (`mcp-server/`) over JMAP.
2. **Admin Panel Automation:** Powered by the Admin REST API endpoints (`/api/v1/*`) with standard JSON function-calling schemas.
3. **Billing Integration:** HostAffin PHP server driver (`driver/AffinMail/`) acts as the billing consumer of these identical REST endpoints.
