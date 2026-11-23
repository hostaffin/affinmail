#!/usr/bin/env bash
# Create api/.env (mode 600) from deploy/.env and local secrets. Prints no secrets.
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$API_DIR")"
DEPLOY_ENV="$ROOT_DIR/deploy/.env"
SECRETS_FILE="/etc/stalwart/local-secrets.txt"
OUT="$API_DIR/.env"

[ -r "$DEPLOY_ENV" ] || { echo "missing $DEPLOY_ENV" >&2; exit 1; }
[ -r "$SECRETS_FILE" ] || { echo "missing $SECRETS_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$DEPLOY_ENV"
set +a

STALWART_ADMIN_PASSWORD="$(grep -E '^PROVISIONED_ADMIN_PASSWORD=' "$SECRETS_FILE" | head -n1 | cut -d= -f2-)"
[ -n "$STALWART_ADMIN_PASSWORD" ] || { echo "PROVISIONED_ADMIN_PASSWORD not found" >&2; exit 1; }

umask 077
cat > "$OUT" <<EOF
AFFINMAIL_ADMIN_TOKEN=$(openssl rand -hex 32)
VAULT_KEY=$(openssl rand -hex 32)

DB_HOST=$POSTGRES_HOST
DB_PORT=$POSTGRES_PORT
DB_USER=$POSTGRES_USER
DB_PASSWORD=$POSTGRES_PASSWORD
DB_NAME=$POSTGRES_DB

STALWART_URL=http://127.0.0.1:8080
STALWART_ADMIN_USER=admin@affinmail.local
STALWART_ADMIN_PASSWORD=$STALWART_ADMIN_PASSWORD

REDIS_URL=redis://127.0.0.1:6379
REDIS_PASSWORD=

STORAGE_LOCAL_PATH=/var/www/affinmail/data/blobs
AUDIT_LOG=/var/www/affinmail/logs/admin-agent-audit.log
BACKUP_DIR=/var/www/affinmail/backups
EOF
chmod 600 "$OUT"
echo "wrote $OUT (mode 600)"
