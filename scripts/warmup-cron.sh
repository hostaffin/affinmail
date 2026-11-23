#!/usr/bin/env bash
# AffinMail Automated IP Warm-Up Daily Cron Job
# Runs daily at midnight via system cron: 0 0 * * * /opt/affinmail/scripts/warmup-cron.sh

set -euo pipefail

PG_HOST="${POSTGRES_HOST:-localhost}"
PG_USER="${POSTGRES_USER:-affinmail_user}"
PG_DB="${POSTGRES_DB:-affinmail}"

echo "[AffinMail Warmup] Starting daily IP warm-up advancement $(date -u)"

psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" <<'SQL'
-- Advance warmup stage day and reset daily sent counters
UPDATE ip_warmup_schedules
SET 
    current_stage_day = current_stage_day + 1,
    sent_today_count = 0,
    last_reset_date = CURRENT_DATE,
    max_daily_limit = CASE 
        WHEN current_stage_day + 1 BETWEEN 1 AND 3 THEN 50
        WHEN current_stage_day + 1 BETWEEN 4 AND 7 THEN 150
        WHEN current_stage_day + 1 BETWEEN 8 AND 14 THEN 500
        WHEN current_stage_day + 1 BETWEEN 15 AND 21 THEN 1500
        WHEN current_stage_day + 1 BETWEEN 22 AND 30 THEN 5000
        ELSE 9999999 -- Unrestricted after Day 30
    END,
    is_completed = CASE WHEN current_stage_day + 1 > 30 THEN TRUE ELSE FALSE END,
    updated_at = NOW()
WHERE is_completed = FALSE;
SQL

echo "[AffinMail Warmup] Warm-up stages updated successfully."
