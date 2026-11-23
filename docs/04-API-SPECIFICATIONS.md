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
