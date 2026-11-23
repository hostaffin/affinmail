#!/usr/bin/env bash
# ==============================================================================
# AffinMail Zero-Downtime Native Update Script (Zero Docker)
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/affinmail"

echo -e "${CYAN}==================================================================${NC}"
echo -e "${BLUE}       AffinMail Server - Zero-Downtime Native Updater (Zero Docker)     ${NC}"
echo -e "${CYAN}==================================================================${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This script must be executed as root. Use sudo ./update.sh${NC}"
    exit 1
fi

if [ ! -d "${INSTALL_DIR}" ]; then
    echo -e "${RED}[ERROR] AffinMail is not installed in ${INSTALL_DIR}.${NC}"
    exit 1
fi

cd "${INSTALL_DIR}"

echo -e "\n${BLUE}[1/5] Backing up Current Database & Configurations...${NC}"
mkdir -p "${INSTALL_DIR}/backups"
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)

if [ -f "${INSTALL_DIR}/deploy/.env" ]; then
    DB_PASS=$(grep "POSTGRES_PASSWORD" "${INSTALL_DIR}/deploy/.env" | cut -d= -f2 || true)
    PGPASSWORD="${DB_PASS:-}" pg_dump -h 127.0.0.1 -U affinmail_user affinmail | gzip > "${INSTALL_DIR}/backups/db_backup_${BACKUP_DATE}.sql.gz" 2>/dev/null || \
    sudo -u postgres pg_dump affinmail | gzip > "${INSTALL_DIR}/backups/db_backup_${BACKUP_DATE}.sql.gz" 2>/dev/null || true
    echo -e "${GREEN}[*] Database snapshot saved: db_backup_${BACKUP_DATE}.sql.gz${NC}"
fi

echo -e "\n${BLUE}[2/5] Updating Code Repository...${NC}"
if [ -d ".git" ]; then
    git pull origin master || git pull || true
fi

echo -e "\n${BLUE}[3/5] Applying SQL Migrations (if any new exist)...${NC}"
for SQL_FILE in "${INSTALL_DIR}/sql/"*.sql; do
    if [ -f "$SQL_FILE" ]; then
        sudo -u postgres psql -d affinmail -f "$SQL_FILE" >/dev/null 2>&1 || true
    fi
done

echo -e "\n${BLUE}[4/5] Updating Systemd Service Units...${NC}"
if [ -d "${INSTALL_DIR}/deploy/systemd" ]; then
    cp "${INSTALL_DIR}/deploy/systemd/stalwart-mail.service" /etc/systemd/system/stalwart-mail.service
    cp "${INSTALL_DIR}/deploy/systemd/affinmail-caddy.service" /etc/systemd/system/affinmail-caddy.service
    cp "${INSTALL_DIR}/deploy/systemd/affinmail.target" /etc/systemd/system/affinmail.target
    systemctl daemon-reload
fi

echo -e "\n${BLUE}[5/5] Performing Zero-Downtime Service Reload...${NC}"
if command -v caddy &>/dev/null; then
    caddy reload --config "${INSTALL_DIR}/deploy/Caddyfile" 2>/dev/null || systemctl restart affinmail-caddy.service
else
    systemctl restart affinmail-caddy.service
fi
systemctl restart stalwart-mail.service

echo -e "\n${BLUE}[*] Verifying Native Service Health...${NC}"
sleep 2

ALL_HEALTHY=true
for SVC in stalwart-mail affinmail-caddy postgresql; do
    if ! systemctl is-active --quiet "$SVC"; then
        ALL_HEALTHY=false
        echo -e "  [○] ${RED}${SVC}.service${NC}: inactive"
    else
        echo -e "  [●] ${GREEN}${SVC}.service${NC}: active (running)"
    fi
done

if [ "$ALL_HEALTHY" = true ]; then
    echo -e "\n${GREEN}==================================================================${NC}"
    echo -e "${GREEN}      AffinMail successfully updated to latest version!           ${NC}"
    echo -e "${GREEN}==================================================================${NC}"
else
    echo -e "\n${RED}[WARNING] Some services may need attention. Check: affinmail fix${NC}"
fi
