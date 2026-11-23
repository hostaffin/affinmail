# AffinMail: API Specifications (JMAP, REST & WebSockets)

---

## 1. Overview
AffinMail integrates three primary API surfaces:
1. **JMAP (RFC 8620 & RFC 8621):** Client-to-server email sync protocol for the React Webmail SPA.
2. **Hostaffin Management REST API:** Server-to-server administrative endpoint for provisioning, quota adjustments, and SSO token issuance.
3. **WebSocket Push Gateway:** Real-time push channel for instant UI updates.

---

## 2. JMAP Protocol (RFC 8620 / RFC 8621)

### 2.1 Session Discovery
* **Endpoint:** `GET /jmap/session`
* **Headers:** `Authorization: Bearer <JWT_OR_APP_PASSWORD>`
* **Response (Sample):**
```json
{
  "capabilities": {
    "urn:ietf:params:jmap:core": {
      "maxSizeUpload": 26214400,
      "maxConcurrentUpload": 4,
      "maxSizeRequest": 10000000,
      "maxConcurrentRequests": 8
    },
    "urn:ietf:params:jmap:mail": {
      "maxMailboxesPerEmail": 1000,
      "maxMailboxDepth": 10,
      "maxSizeMailboxName": 100,
      "mayCreateTopLevelMailbox": true
    },
    "urn:ietf:params:jmap:submission": {
      "maxDelayedSend": 0,
      "submissionExtensions": []
    }
  },
  "accounts": {
    "acc_user_102": {
      "name": "marcus@apexlogistics.com",
      "isPersonal": true,
      "isReadOnly": false,
      "accountCapabilities": {
        "urn:ietf:params:jmap:mail": {}
      }
    }
  },
  "primaryAccounts": {
    "urn:ietf:params:jmap:mail": "acc_user_102"
  },
  "apiUrl": "https://mail.apexlogistics.com/jmap/api",
  "downloadUrl": "https://mail.apexlogistics.com/jmap/download/{accountId}/{blobId}/{name}",
  "uploadUrl": "https://mail.apexlogistics.com/jmap/upload/{accountId}",
  "eventSourceUrl": "https://mail.apexlogistics.com/jmap/events"
}
```

### 2.2 Batched Request (Email/get + Thread/get)
* **Endpoint:** `POST /jmap/api`
* **Payload:**
```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    [
      "Email/query",
      {
        "accountId": "acc_user_102",
        "filter": { "inMailbox": "inbox" },
        "sort": [{ "property": "receivedAt", "isAscending": false }],
        "limit": 50
      },
      "call-query-1"
    ],
    [
      "Email/get",
      {
        "accountId": "acc_user_102",
        "#ids": {
          "resultOf": "call-query-1",
          "name": "Email/query",
          "path": "/ids"
        },
        "properties": ["id", "threadId", "from", "to", "subject", "receivedAt", "preview", "hasAttachment", "keywords"]
      },
      "call-get-2"
    ]
  ]
}
```

### 2.3 JMAP Blob Upload (Plan-Driven Attachment Guard)
* **Endpoint:** `POST /jmap/upload/{accountId}`
* **Headers:**
  * `Content-Type: application/pdf` (or binary MIME type)
  * `Authorization: Bearer <JWT>`
* **Server Verification:**
  * If body size > plan limit (e.g. 25MB): returns `413 Payload Too Large` or `552 5.3.4 Message size exceeds fixed limit`.
  * If valid:
```json
{
  "accountId": "acc_user_102",
  "blobId": "b19c8f94a284...",
  "type": "application/pdf",
  "size": 14209500
}
```

---

## 3. Hostaffin Admin Management REST API

All administrative requests require the `X-Server-API-Key` secret header.

### 3.1 Domain Endpoints
* **Create Domain:** `POST /api/v1/domains`
  * Request:
    ```json
    {
      "domain": "apexlogistics.com",
      "maxMailboxes": 10,
      "diskQuotaMb": 20480,
      "maxAttachmentMb": 25,
      "hostaffinServiceId": 1402
    }
    ```
  * Response: Returns domain status, DKIM selector, and 2048-bit public key.
* **Get Domain DNS Configuration:** `GET /api/v1/domains/{domain}/dns`
  * Response:
    ```json
    {
      "domain": "apexlogistics.com",
      "records": [
        { "type": "MX", "name": "@", "value": "mail.hostaffin.com", "priority": 10 },
        { "type": "TXT", "name": "@", "value": "v=spf1 mx include:_spf.hostaffin.com ~all" },
        { "type": "TXT", "name": "affinmail._domainkey", "value": "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9..." },
        { "type": "TXT", "name": "_dmarc", "value": "v=DMARC1; p=quarantine; rua=mailto:dmarc@apexlogistics.com" }
      ]
    }
    ```

### 3.2 Mailbox Provisioning & Quota
* **Create Mailbox:** `POST /api/v1/mailboxes`
  * Request:
    ```json
    {
      "email": "marcus@apexlogistics.com",
      "password": "SecureGeneratedPassword123!",
      "displayName": "Marcus Vance",
      "quotaLimitMb": 10240,
      "hourlyRateLimit": 200,
      "outboundRoute": "direct"
    }
    ```
* **Update Quota / Plan:** `PATCH /api/v1/mailboxes/{email}/quota`
  * Request:
    ```json
    {
      "quotaLimitMb": 25600,
      "hourlyRateLimit": 500,
      "outboundRoute": "relay_ses"
    }
    ```
* **Suspend / Unsuspend Mailbox:** `PUT /api/v1/mailboxes/{email}/status`
  * Request:
    ```json
    { "status": "suspended" } -- or "active"
    ```

### 3.3 1-Click SSO Token Issuance
* **Endpoint:** `POST /api/v1/auth/sso-token`
* **Request:**
  ```json
  {
    "email": "marcus@apexlogistics.com",
    "ttlSeconds": 120
  }
  ```
* **Response:**
  ```json
  {
    "ssoUrl": "https://mail.hostaffin.com/sso?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2026-11-23T11:02:00Z"
  }
  ```

---

## 4. WebSocket Push Notification Protocol

* **URL:** `wss://mail.hostaffin.com/ws?token=<JWT>`
* **Frames (Server to Client):**
  * Inbound Email Event:
    ```json
    {
      "event": "message:new",
      "data": {
        "threadId": "th_9281a",
        "messageId": "msg_0102a",
        "sender": "stripe@billing.com",
        "subject": "Invoice #AF-1092",
        "snippet": "Payment received...",
        "mailbox": "inbox",
        "unreadCount": 15
      }
    }
    ```
  * Quota Warning Event:
    ```json
    {
      "event": "quota:warning",
      "data": {
        "usedBytes": 8700000000,
        "limitBytes": 10240000000,
        "percent": 85.0,
        "message": "Your mailbox storage has reached 85% capacity."
      }
    }
    ```

---

## 5. Model Context Protocol (MCP) Interface for User Panel Automation

The AffinMail User Panel can be completely automated by AI agents, LLMs, and assistive workflows using the **Model Context Protocol (MCP)**. The AffinMail MCP Server maps high-level user actions into authenticated RFC 8620/8621 JMAP calls.

### 5.1 MCP Client Configuration
Add the AffinMail User Panel MCP server to your AI environment (Antigravity, Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "affinmail-user": {
      "command": "/var/www/affinmail/mcp-server/target/release/affinmail-mcp-server",
      "env": {
        "AFFINMAIL_JMAP_URL": "http://127.0.0.1:8080/jmap",
        "AFFINMAIL_API_TOKEN": "user@example.com:password"
      }
    }
  }
}
```

`AFFINMAIL_API_TOKEN` is required: a JMAP bearer token, or `email:password` for a
local Stalwart account (sent as HTTP Basic). The session document is fetched from
the sibling `/jmap/session` to resolve the mail accountId.

### 5.2 Registered MCP Tool Definitions

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `affinmail_search_emails` | `query: string, folder?: string, limit?: number, unreadOnly?: boolean` | Searches threads by keywords, sender, or subject via JMAP `Email/query`. |
| `affinmail_get_thread` | `threadId: string` | Fetches complete conversation message history, headers, body, and attachment metadata. |
| `affinmail_send_email` | `to: string[], subject: string, body: string, cc?: string[], bcc?: string[]` | Creates an RFC 5322 payload and dispatches via JMAP `EmailSubmission/set`. |
| `affinmail_draft_email` | `to: string[], subject: string, body: string, draftId?: string` | Creates or updates an editable draft inside the user's Drafts folder. |
| `affinmail_update_labels` | `threadId: string, addLabels?: string[], removeLabels?: string[]` | Archives, stars, marks as spam, or applies custom tags to a thread. |
| `affinmail_get_quota` | *none* | Returns JMAP `Quota/get` usage/limit plus summed mailbox counters. |
| `admin_get_system_health` | *none* | `GET /health` on the admin API; postgres/redis/stalwart daemon checks. |
| `admin_create_domain` | `domain: string, storage_quota_mb: number, max_mailboxes?: number, max_attachment_mb?: number` | `POST /domains`; maps `storage_quota_mb` → `diskQuotaMb`. |
| `admin_provision_mailbox` | `email: string, quota_mb: number, password: string, display_name?: string` | `POST /mailboxes`; maps `quota_mb` → `quotaLimitMb`. |
| `admin_assign_egress_ip` | `domain: string, ip_address: string` | `POST /ippools/assign`. |
| `admin_check_ip_reputation` | `ip_address?: string` | `GET /ip-pools`, reputation graded **locally** from stored `reputation_score`/flags. No DNSBL or network lookups. |
| `admin_switch_storage_tier` | `tier: string` | `POST /storage/switch`; surfaces the API's 404 error text unchanged. |
| `admin_trigger_auto_repair` | *none* | `POST /system/auto-repair`, falls back to `POST /system/restart` on 404 (fallback noted in result). |
| `admin_create_backup` | *none* | `POST /system/backup`. |

### 5.3 Sample MCP Tool Invocation (`affinmail_search_emails`)
```json
{
  "name": "affinmail_search_emails",
  "arguments": {
    "query": "invoice overdue",
    "folder": "inbox",
    "limit": 5
  }
}
```
**Returns:**
```json
{
  "threads": [
    {
      "id": "th_1092b",
      "from": "accounting@vendor.com",
      "subject": "Urgent: Invoice #992 Overdue",
      "snippet": "Please find attached notice regarding past due payment...",
      "receivedAt": "2026-11-23T14:20:00Z",
      "isUnread": true
    }
  ]
}
```
