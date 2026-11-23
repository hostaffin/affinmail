-- AffinMail Admin REST API extensions
-- Migration: 003_api_extensions.sql

ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS stalwart_account_id TEXT;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS secret_vault TEXT;

ALTER TABLE domains ADD COLUMN IF NOT EXISTS stalwart_domain_id TEXT;

ALTER TABLE aliases ADD COLUMN IF NOT EXISTS stalwart_account_id TEXT;
ALTER TABLE aliases ADD COLUMN IF NOT EXISTS stalwart_alias_key TEXT;

CREATE INDEX IF NOT EXISTS idx_mailboxes_stalwart_account ON mailboxes(stalwart_account_id);
CREATE INDEX IF NOT EXISTS idx_domains_stalwart_domain ON domains(stalwart_domain_id);
CREATE INDEX IF NOT EXISTS idx_aliases_destination ON aliases(destination_address);
