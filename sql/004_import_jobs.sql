-- AffinMail mail import / migration jobs
-- Migration: 004_import_jobs.sql
-- NOTE: api/public/index.php also creates these lazily (ensureImportTables()).

CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_email VARCHAR(255) NOT NULL,
    target_folder TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    total INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    skipped_duplicates INTEGER NOT NULL DEFAULT 0,
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_target ON import_jobs(target_email, created_at DESC);

-- Dedup ledger: one row per message already imported into a target mailbox.
CREATE TABLE IF NOT EXISTS imported_messages (
    target_email VARCHAR(255) NOT NULL,
    message_id TEXT NOT NULL,
    email_id TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (target_email, message_id)
);
