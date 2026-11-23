-- AffinMail Database Schema (PostgreSQL 16)
-- Migration: 001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $$ BEGIN
    CREATE TYPE account_status AS ENUM ('active', 'suspended', 'pending_deletion');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE outbound_route_type AS ENUM ('direct', 'relay_ses', 'relay_sendgrid', 'relay_custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE ip_pool_type AS ENUM ('shared', 'dedicated');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. IP Pools Table (Multi-IP & Dedicated IP Management)
CREATE TABLE IF NOT EXISTS ip_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address INET NOT NULL UNIQUE,
    ip_version SMALLINT NOT NULL DEFAULT 4,
    pool_type ip_pool_type NOT NULL DEFAULT 'shared',
    rdns_hostname VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
    blacklist_details JSONB NULL,
    current_allocations INTEGER NOT NULL DEFAULT 0,
    max_allocations INTEGER NOT NULL DEFAULT 100,
    reputation_score NUMERIC(3, 1) NOT NULL DEFAULT 10.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_pools_type_active ON ip_pools(pool_type, is_active, is_blacklisted);

-- 2. Domains Table
CREATE TABLE IF NOT EXISTS domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    hostaffin_service_id INTEGER NULL,
    assigned_ip_id UUID NULL REFERENCES ip_pools(id) ON DELETE SET NULL,
    is_dedicated_ip BOOLEAN NOT NULL DEFAULT FALSE,
    max_mailboxes INTEGER NOT NULL DEFAULT 5,
    max_attachment_size_mb INTEGER NOT NULL DEFAULT 25,
    disk_quota_mb INTEGER NOT NULL DEFAULT 10240,
    dkim_selector VARCHAR(64) NOT NULL DEFAULT 'affinmail',
    dkim_private_key TEXT NOT NULL,
    dkim_public_key TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(domain_name);
CREATE INDEX IF NOT EXISTS idx_domains_hostaffin_service ON domains(hostaffin_service_id);
CREATE INDEX IF NOT EXISTS idx_domains_assigned_ip ON domains(assigned_ip_id);

-- 3. Dedicated IP Warm-Up Schedules
CREATE TABLE IF NOT EXISTS ip_warmup_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    ip_id UUID NOT NULL REFERENCES ip_pools(id) ON DELETE CASCADE,
    current_stage_day INTEGER NOT NULL DEFAULT 1,
    max_daily_limit INTEGER NOT NULL DEFAULT 50,
    sent_today_count INTEGER NOT NULL DEFAULT 0,
    last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_domain_ip_warmup UNIQUE (domain_id, ip_id)
);

CREATE INDEX IF NOT EXISTS idx_warmup_domain ON ip_warmup_schedules(domain_id);

-- 4. IP RBL / Blacklist Monitoring Log
CREATE TABLE IF NOT EXISTS ip_rbl_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_id UUID NOT NULL REFERENCES ip_pools(id) ON DELETE CASCADE,
    rbl_provider VARCHAR(128) NOT NULL,
    is_listed BOOLEAN NOT NULL DEFAULT FALSE,
    response_code VARCHAR(32) NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbl_ip_date ON ip_rbl_checks(ip_id, checked_at DESC);

-- 5. Mailboxes Table
CREATE TABLE IF NOT EXISTS mailboxes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    quota_limit_mb INTEGER NOT NULL DEFAULT 5120,
    quota_used_bytes BIGINT NOT NULL DEFAULT 0,
    hourly_rate_limit INTEGER NOT NULL DEFAULT 200,
    outbound_route outbound_route_type NOT NULL DEFAULT 'direct',
    relay_config JSONB NULL,
    status account_status NOT NULL DEFAULT 'active',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_email ON mailboxes(email);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id);

-- 6. Aliases Table
CREATE TABLE IF NOT EXISTS aliases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    source_address VARCHAR(255) NOT NULL,
    destination_address VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aliases_source ON aliases(source_address);

-- 7. Sieve Scripts & Auto-Responder
CREATE TABLE IF NOT EXISTS sieve_scripts (
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

CREATE INDEX IF NOT EXISTS idx_sieve_mailbox ON sieve_scripts(mailbox_id);

-- 8. Email Threads Table (JMAP Grouping)
CREATE TABLE IF NOT EXISTS email_threads (
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

CREATE INDEX IF NOT EXISTS idx_threads_mailbox_date ON email_threads(mailbox_id, latest_received_at DESC);

-- 9. Email Messages Metadata & Full-Text Search
CREATE TABLE IF NOT EXISTS email_messages (
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
    blob_id VARCHAR(128) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_draft BOOLEAN NOT NULL DEFAULT FALSE,
    is_trash BOOLEAN NOT NULL DEFAULT FALSE,
    is_spam BOOLEAN NOT NULL DEFAULT FALSE,
    labels TEXT[] NOT NULL DEFAULT '{}',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tsv_content TSVECTOR NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON email_messages(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_blob ON email_messages(blob_id);
CREATE INDEX IF NOT EXISTS idx_messages_tsv ON email_messages USING GIN(tsv_content);

-- 10. Audit Log / Usage Statistics for Hostaffin Billing
CREATE TABLE IF NOT EXISTS usage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    mailbox_id UUID NULL REFERENCES mailboxes(id) ON DELETE SET NULL,
    recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
    disk_consumed_bytes BIGINT NOT NULL DEFAULT 0,
    emails_sent_count INTEGER NOT NULL DEFAULT 0,
    emails_received_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_domain_date UNIQUE (domain_id, mailbox_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_usage_domain_date ON usage_records(domain_id, recorded_at);

-- Trigger: Automatically update tsv_content on message insert or update
CREATE OR REPLACE FUNCTION update_message_tsv() RETURNS trigger AS $$
BEGIN
    new.tsv_content :=
        setweight(to_tsvector('english', coalesce(new.subject, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(new.sender_name, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(new.sender_email, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(new.snippet, '')), 'C');
    RETURN new;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_tsv ON email_messages;
CREATE TRIGGER trg_message_tsv BEFORE INSERT OR UPDATE ON email_messages
    FOR EACH ROW EXECUTE FUNCTION update_message_tsv();
