#!/usr/bin/env bash
# AffinMail daily backup: PostgreSQL dump + config snapshot, 14-day retention.
# Runs as root via systemd (affinmail-backup.service / affinmail-backup.timer).
set -euo pipefail

BACKUP_DIR="/var/www/affinmail/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1. Native PostgreSQL dump (peer auth via sudo -u postgres)
echo "[Backup] Dumping PostgreSQL database 'affinmail'..."
sudo -u postgres pg_dump affinmail | gzip > "${BACKUP_DIR}/affinmail-${TIMESTAMP}.sql.gz"

# 2. Configuration snapshot: Stalwart config + deploy dir
echo "[Backup] Archiving configurations..."
tar -czf "${BACKUP_DIR}/affinmail-config-${TIMESTAMP}.tar.gz" \
  -C /etc/stalwart config.json \
  -C /var/www/affinmail deploy

# 3. Retention cleanup (keep last 14 days of affinmail-* files)
find "$BACKUP_DIR" -type f -name 'affinmail-*' -mtime +14 -delete

echo "[Backup] Snapshot complete: ${TIMESTAMP}"