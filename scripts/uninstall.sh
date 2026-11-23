#!/usr/bin/env bash
# ==============================================================================
# AffinMail Clean Uninstallation Script
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/affinmail"

echo -e "${RED}==================================================================${NC}"
echo -e "${RED}          AffinMail Enterprise Email Server - Uninstaller         ${NC}"
echo -e "${RED}==================================================================${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This script must be executed as root. Use sudo ./uninstall.sh${NC}"
    exit 1
fi

# TTY Detection for piped execution
TTY_INPUT="/dev/stdin"
if [ ! -t 0 ]; then
    if [ -e /dev/tty ]; then
        TTY_INPUT="/dev/tty"
    fi
fi

PURGE_DATA=false
if [[ "${1:-}" == "--purge" || "${1:-}" == "--purge-all" ]]; then
    PURGE_DATA=true
else
    echo -e "${YELLOW}[WARNING] This will stop and remove AffinMail services.${NC}"
    echo -n "Are you sure you want to proceed? [y/N]: "
    read -r CONFIRM < "$TTY_INPUT"
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
        echo "Uninstallation cancelled."
        exit 0
    fi

    echo -n "Do you want to permanently DELETE all email data, databases, and blobs? [y/N]: "
    read -r PURGE_CONFIRM < "$TTY_INPUT"
    if [[ "$PURGE_CONFIRM" == "y" || "$PURGE_CONFIRM" == "Y" ]]; then
        PURGE_DATA=true
    fi
fi

echo -e "\n${BLUE}[1/4] Stopping and removing Docker containers...${NC}"
if [ -d "${INSTALL_DIR}/deploy" ]; then
    cd "${INSTALL_DIR}/deploy"
    if [ "$PURGE_DATA" = true ]; then
        docker compose down -v --remove-orphans || true
    else
        docker compose down --remove-orphans || true
    fi
fi

echo -e "\n${BLUE}[2/4] Removing Scheduled Cron Jobs...${NC}"
rm -f /etc/cron.d/affinmail
rm -f /var/log/affinmail-*.log

echo -e "\n${BLUE}[3/4] Removing Management CLI symlink...${NC}"
rm -f /usr/local/bin/affinmail

if [ "$PURGE_DATA" = true ]; then
    echo -e "\n${RED}[4/4] Purging all AffinMail directories and data volumes...${NC}"
    rm -rf "${INSTALL_DIR}"

    # Clean firewalld on AlmaLinux/RHEL if present
    if command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld; then
        for P in 2087/tcp 2083/tcp 25/tcp 465/tcp 587/tcp 993/tcp 4190/tcp; do
            firewall-cmd --permanent --remove-port="$P" >/dev/null 2>&1 || true
        done
        firewall-cmd --reload >/dev/null 2>&1 || true
    fi

    echo -e "${GREEN}[*] All application data, databases, and blobs have been purged.${NC}"
else
    echo -e "\n${YELLOW}[4/4] Preserving data in ${INSTALL_DIR} for future re-install.${NC}"
fi

echo -e "\n${GREEN}==================================================================${NC}"
echo -e "${GREEN}      AffinMail has been successfully uninstalled.               ${NC}"
echo -e "${GREEN}==================================================================${NC}"
