-- AffinMail Provisioning and Client Self-Service API Extensions
-- Migration: 005_provisioning_and_client_api.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Hosting / Service Plans Table
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    max_domains INTEGER NOT NULL DEFAULT 1,
    max_mailboxes INTEGER NOT NULL DEFAULT 5,
    storage_mb INTEGER NOT NULL DEFAULT 10240,
    max_attachment_size_mb INTEGER NOT NULL DEFAULT 25,
    hourly_rate_limit INTEGER NOT NULL DEFAULT 200,
    has_dedicated_ip BOOLEAN NOT NULL DEFAULT FALSE,
    has_sieve_vacation BOOLEAN NOT NULL DEFAULT TRUE,
    has_mcp_access BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Client Accounts Table (for billing and multi-domain grouping)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL DEFAULT '',
    admin_email VARCHAR(255) NOT NULL,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    external_id VARCHAR(128) NULL,
    suspended_at TIMESTAMPTZ NULL,
    terminated_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_admin_email ON accounts(admin_email);
CREATE INDEX IF NOT EXISTS idx_accounts_external_id ON accounts(external_id);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

-- 3. Link domains to accounts
ALTER TABLE domains ADD COLUMN IF NOT EXISTS account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_domains_account ON domains(account_id);

-- 4. Mailbox App Passwords (Device/client specific passwords)
CREATE TABLE IF NOT EXISTS app_passwords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    label VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_app_passwords_mailbox ON app_passwords(mailbox_id);

-- 5. MCP (Model Context Protocol) API Tokens
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    token_prefix VARCHAR(16) NOT NULL DEFAULT 'aff_',
    name VARCHAR(128) NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{"read","send","search"}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    last_used_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_mailbox ON mcp_tokens(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash);

-- 6. MCP Tool Activity Audit Log
CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    token_id UUID NULL REFERENCES mcp_tokens(id) ON DELETE SET NULL,
    tool_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'success',
    client_info JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_mailbox_created ON mcp_audit_log(mailbox_id, created_at DESC);

-- 7. Seed Default Hosting Plans
INSERT INTO plans (slug, name, max_domains, max_mailboxes, storage_mb, max_attachment_size_mb, hourly_rate_limit, has_dedicated_ip)
VALUES
    ('starter', 'Starter', 1, 5, 10240, 25, 100, FALSE),
    ('professional', 'Professional', 5, 25, 51200, 50, 500, FALSE),
    ('enterprise', 'Enterprise', 25, 100, 204800, 100, 2000, TRUE)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    max_domains = EXCLUDED.max_domains,
    max_mailboxes = EXCLUDED.max_mailboxes,
    storage_mb = EXCLUDED.storage_mb,
    max_attachment_size_mb = EXCLUDED.max_attachment_size_mb,
    hourly_rate_limit = EXCLUDED.hourly_rate_limit,
    has_dedicated_ip = EXCLUDED.has_dedicated_ip,
    updated_at = NOW();
