#!/usr/bin/env bash
# ==============================================================================
# AffinMail Zero-Downtime Update Script
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
echo -e "${BLUE}          AffinMail Server - Zero-Downtime Updater                ${NC}"
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

if docker ps | grep -q "postgres"; then
    docker exec -t $(docker compose -f deploy/docker-compose.yml ps -q postgres) \
        pg_dump -U affinmail_user affinmail | gzip > "${INSTALL_DIR}/backups/db_backup_${BACKUP_DATE}.sql.gz"
    echo -e "${GREEN}[*] Database snapshot saved: db_backup_${BACKUP_DATE}.sql.gz${NC}"
fi

echo -e "\n${BLUE}[2/5] Updating Code Repository...${NC}"
if [ -d ".git" ]; then
    git pull origin master || git pull || true
fi

echo -e "\n${BLUE}[3/5] Pulling Latest Multi-Arch Container Images...${NC}"
cd "${INSTALL_DIR}/deploy"
docker compose pull

echo -e "\n${BLUE}[4/5] Re-compiling Webmail SPA Assets (if Node/NPM present)...${NC}"
if [ -f "${INSTALL_DIR}/webmail/package.json" ] && command -v npm &> /dev/null; then
    cd "${INSTALL_DIR}/webmail"
    npm install --silent
    npm run build
    cd "${INSTALL_DIR}/deploy"
fi

echo -e "\n${BLUE}[5/5] Performing Rolling Restart of Container Services...${NC}"
docker compose up -d --remove-orphans

echo -e "\n${BLUE}[*] Verifying Service Health...${NC}"
sleep 3

if docker compose ps | grep -q "Up"; then
    echo -e "\n${GREEN}==================================================================${NC}"
    echo -e "${GREEN}      AffinMail successfully updated to latest version!           ${NC}"
    echo -e "${GREEN}==================================================================${NC}"
    docker compose ps
else
    echo -e "${RED}[WARNING] Some services may not have started cleanly. Check: docker compose logs${NC}"
fi
