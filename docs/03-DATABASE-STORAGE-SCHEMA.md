# AffinMail: Database & Storage Specifications

---

## 1. Overview
AffinMail employs a hybrid storage strategy:
* **Relational Database (PostgreSQL 16):** Domains, accounts, quotas, aliases, Sieve scripts, routing rules, email index metadata, and GIN full-text search.
* **In-Memory Cache (Redis 7):** Leaky-bucket outbound counters, active JMAP/WebSocket connections, rate limiting states, and transient sessions.
* **Blob Object Storage (NVMe / S3):** Raw `.eml` RFC 5322 MIME messages and decoupled binary attachments with SHA-256 deduplication.

---

## 2. PostgreSQL 16 Schema (DDL)

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum types
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'pending_deletion');
CREATE TYPE outbound_route_type AS ENUM ('direct', 'relay_ses', 'relay_sendgrid', 'relay_custom');

-- 1. Domains Table
CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    hostaffin_service_id INTEGER NULL,
    max_mailboxes INTEGER NOT NULL DEFAULT 5,
    max_attachment_size_mb INTEGER NOT NULL DEFAULT 25,
    disk_quota_mb INTEGER NOT NULL DEFAULT 10240, -- total domain quota
    dkim_selector VARCHAR(64) NOT NULL DEFAULT 'affinmail',
    dkim_private_key TEXT NOT NULL,
    dkim_public_key TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_domains_name ON domains(domain_name);
CREATE INDEX idx_domains_hostaffin_service ON domains(hostaffin_service_id);

-- 2. Mailboxes Table
CREATE TABLE mailboxes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Argon2id or SCRAM-SHA-256
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    quota_limit_mb INTEGER NOT NULL DEFAULT 5120, -- mailbox quota
    quota_used_bytes BIGINT NOT NULL DEFAULT 0,
    hourly_rate_limit INTEGER NOT NULL DEFAULT 200,
    outbound_route outbound_route_type NOT NULL DEFAULT 'direct',
    relay_config JSONB NULL, -- Custom relay host, port, credentials if applicable
    status account_status NOT NULL DEFAULT 'active',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_mailbox_domain FOREIGN KEY (domain_id) REFERENCES domains(id)
);

CREATE INDEX idx_mailboxes_email ON mailboxes(email);
CREATE INDEX idx_mailboxes_domain ON mailboxes(domain_id);

-- 3. Aliases Table
CREATE TABLE aliases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    source_address VARCHAR(255) NOT NULL, -- e.g. support@domain.com
    destination_address VARCHAR(255) NOT NULL, -- e.g. marcus@domain.com
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aliases_source ON aliases(source_address);

-- 4. Mailbox Sieve Filters & Auto-Responder
CREATE TABLE sieve_scripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    script_name VARCHAR(64) NOT NULL DEFAULT 'default',
    script_content TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_vacation_active BOOLEAN NOT NULL DEFAULT FALSE,
    vacation_subject VARCHAR(255) NULL,
    vacation_body TEXT NULL,
    vacation_start TIMESTAMPTZ NULL,
    vacation_end TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sieve_mailbox ON sieve_scripts(mailbox_id);

-- 5. Email Threads Table (JMAP Grouping)
CREATE TABLE email_threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    snippet TEXT NULL,
    message_count INTEGER NOT NULL DEFAULT 1,
    has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_unread BOOLEAN NOT NULL DEFAULT TRUE,
    latest_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_threads_mailbox_date ON email_threads(mailbox_id, latest_received_at DESC);

-- 6. Email Messages Metadata & Full-Text Search
CREATE TABLE email_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    rfc_message_id VARCHAR(512) NOT NULL,
    in_reply_to VARCHAR(512) NULL,
    sender_name VARCHAR(255) NULL,
    sender_email VARCHAR(255) NOT NULL,
    recipient_to TEXT[] NOT NULL,
    recipient_cc TEXT[] NULL,
    recipient_bcc TEXT[] NULL,
    subject TEXT NOT NULL,
    snippet TEXT NULL,
    size_bytes BIGINT NOT NULL,
    blob_id VARCHAR(128) NOT NULL, -- Hash pointer to NVMe/S3 blob
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_draft BOOLEAN NOT NULL DEFAULT FALSE,
    is_trash BOOLEAN NOT NULL DEFAULT FALSE,
    is_spam BOOLEAN NOT NULL DEFAULT FALSE,
    labels TEXT[] NOT NULL DEFAULT '{}',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tsv_content TSVECTOR NULL -- For GIN indexed full-text searching
);

CREATE INDEX idx_messages_mailbox ON email_messages(mailbox_id);
CREATE INDEX idx_messages_thread ON email_messages(thread_id);
CREATE INDEX idx_messages_blob ON email_messages(blob_id);
CREATE INDEX idx_messages_tsv ON email_messages USING GIN(tsv_content);

-- 7. Audit Log / Usage Statistics for Hostaffin Billing
CREATE TABLE usage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    mailbox_id UUID NULL REFERENCES mailboxes(id) ON DELETE SET NULL,
    recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
    disk_consumed_bytes BIGINT NOT NULL DEFAULT 0,
    emails_sent_count INTEGER NOT NULL DEFAULT 0,
    emails_received_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_domain_date UNIQUE (domain_id, mailbox_id, recorded_at)
);

CREATE INDEX idx_usage_domain_date ON usage_records(domain_id, recorded_at);
```

---

## 3. Redis 7 Key Structures & In-Memory Patterns

| Key Pattern | Data Structure | TTL | Purpose |
| :--- | :--- | :--- | :--- |
| `ratelimit:send:<mailbox_id>` | Hash (count, last_leak_ts) | 3600s | Leaky-bucket outbound email rate limiter |
| `session:ws:<mailbox_id>:<connection_id>` | String (metadata JSON) | 86400s | Real-time WebSocket connection registry |
| `auth:sso:token:<token_uuid>` | String (mailbox_email) | 120s | Single-use SSO login token verification |
| `cache:quota:<mailbox_id>` | Hash (used_bytes, limit_mb) | 300s | Rapid lookup for attachment guard & ingress |
| `blacklist:ip:<ip_address>` | String (fail_count) | 7200s | Temporary Ban on SMTP brute-force attempts |

---

## 4. Blob Storage Architecture (NVMe / S3)

### Storage Layout
Blobs are addressed using their SHA-256 digest:
```
/var/lib/stalwart/blobs/
  ├── 3a/
  │   └── 7f/
  │       └── 3a7f4c919d80d... (MIME Raw Payload or Attachment)
```

### Dedup & Retention
1. **Deduplication:** When an attachment is sent to multiple internal recipients, only one copy of the file blob is written to disk. All message records reference the same `blob_id`.
2. **Reference Counting:** A background cleaner decrements reference counters upon message deletion and purges orphaned blobs.
