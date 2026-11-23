#!/usr/bin/env bash
# ==============================================================================
# AffinMail Master Unified Management CLI (Zero Docker Native Bare-Metal)
# Usage: affinmail [install|uninstall|update|status|restart|stop|start|logs|fix|backup|info]
# ==============================================================================

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/affinmail"
LOG_FILE="/var/log/affinmail-install.log"

# Resolve base directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$INSTALL_DIR" ]; then
    BASE_DIR="$INSTALL_DIR"
else
    BASE_DIR="$(dirname "$SCRIPT_DIR")"
fi

COMMAND="${1:-help}"

case "$COMMAND" in
    install)
        shift || true
        bash "${BASE_DIR}/install.sh" "$@"
        ;;
    uninstall)
        shift || true
        bash "${BASE_DIR}/scripts/uninstall.sh" "$@"
        ;;
    update)
        shift || true
        bash "${BASE_DIR}/scripts/update.sh" "$@"
        ;;
    fix|repair|diagnose)
        shift || true
        bash "${BASE_DIR}/scripts/fix.sh" "$@"
        ;;
    status)
        echo -e "${CYAN}=== AffinMail Native Cluster Status ===${NC}"
        echo -e "${BOLD}1. Systemd Services:${NC}"
        for SVC in stalwart-mail affinmail-caddy postgresql redis redis-server; do
            if systemctl list-unit-files "${SVC}.service" &>/dev/null; then
                STATE=$(systemctl is-active "$SVC" 2>/dev/null || echo "inactive")
                if [ "$STATE" == "active" ]; then
                    echo -e "  [●] ${GREEN}${SVC}.service${NC}: active (running)"
                else
                    echo -e "  [○] ${RED}${SVC}.service${NC}: ${STATE}"
                fi
            fi
        done

        echo -e "\n${BOLD}2. Listening Network Ports:${NC}"
        ss -tlnp 2>/dev/null | grep -E ':(25|80|443|465|587|993|2083|2087|4190|8080|5432|6379)\b' || true
        ;;
    restart)
        echo -e "${BLUE}Restarting Native AffinMail Services...${NC}"
        systemctl restart postgresql 2>/dev/null || true
        systemctl restart redis 2>/dev/null || systemctl restart redis-server 2>/dev/null || true
        systemctl restart stalwart-mail.service
        systemctl restart affinmail-caddy.service
        echo -e "${GREEN}[*] All AffinMail native services restarted successfully.${NC}"
        ;;
    stop)
        echo -e "${YELLOW}Stopping AffinMail Mail & Web Services...${NC}"
        systemctl stop stalwart-mail.service affinmail-caddy.service
        echo -e "${YELLOW}[*] Stalwart and Caddy services stopped.${NC}"
        ;;
    start)
        echo -e "${GREEN}Starting AffinMail Native Services...${NC}"
        systemctl start postgresql 2>/dev/null || true
        systemctl start redis 2>/dev/null || systemctl start redis-server 2>/dev/null || true
        systemctl start stalwart-mail.service
        systemctl start affinmail-caddy.service
        echo -e "${GREEN}[*] All AffinMail native services started.${NC}"
        ;;
    logs)
        shift || true
        SUB="${1:-}"
        if [ "$SUB" == "install" ]; then
            if [ -f "$LOG_FILE" ]; then
                echo -e "${GREEN}[*] Streaming installation log (${LOG_FILE})...${NC}"
                tail -n 100 -f "$LOG_FILE"
            else
                echo -e "${YELLOW}No install log found at ${LOG_FILE}.${NC}"
            fi
        elif [ "$SUB" == "stalwart" ] || [ "$SUB" == "mail" ]; then
            journalctl -u stalwart-mail.service -f -n 100
        elif [ "$SUB" == "caddy" ] || [ "$SUB" == "web" ]; then
            journalctl -u affinmail-caddy.service -f -n 100
        elif [ "$SUB" == "postgres" ] || [ "$SUB" == "db" ]; then
            journalctl -u postgresql.service -f -n 100
        elif [ "$SUB" == "redis" ]; then
            journalctl -u redis.service -u redis-server.service -f -n 100
        else
            echo -e "${GREEN}[*] Streaming logs for Stalwart & Caddy... (Ctrl+C to exit)${NC}"
            journalctl -u stalwart-mail.service -u affinmail-caddy.service -f -n 100
        fi
        ;;
    backup)
        echo -e "${BLUE}Creating Immediate Database Backup...${NC}"
        mkdir -p "${BASE_DIR}/backups"
        BKP_NAME="native_backup_$(date +%Y%m%d_%H%M%S).sql.gz"

        if [ -f "${BASE_DIR}/deploy/.env" ]; then
            DB_PASS=$(grep "POSTGRES_PASSWORD" "${BASE_DIR}/deploy/.env" | cut -d= -f2)
            PGPASSWORD="$DB_PASS" pg_dump -h 127.0.0.1 -U affinmail_user affinmail | gzip > "${BASE_DIR}/backups/${BKP_NAME}" 2>/dev/null || \
            sudo -u postgres pg_dump affinmail | gzip > "${BASE_DIR}/backups/${BKP_NAME}"
        else
            sudo -u postgres pg_dump affinmail | gzip > "${BASE_DIR}/backups/${BKP_NAME}"
        fi

        echo -e "${GREEN}[*] Native PostgreSQL backup created successfully:${NC} ${BASE_DIR}/backups/${BKP_NAME}"
        ;;
    info)
        echo -e "${CYAN}=== AffinMail Native System Information ===${NC}"
        if [ -f "${BASE_DIR}/deploy/.env" ]; then
            grep -E "SERVER_HOSTNAME|MAIL_HOSTNAME|NIP_DOMAIN|SHARED_OUTBOUND_IPV4|STORAGE_BLOB_TYPE|POSTGRES_HOST" "${BASE_DIR}/deploy/.env"
        fi
        echo "Architecture: $(uname -m)"
        echo "Root Path:    ${BASE_DIR}"
        echo "Install Log:  ${LOG_FILE}"
        echo "Engine:       Stalwart Native (Rust Tokio Core) - Zero Docker"
        echo "Web Server:   Caddy 2 Native Binary"
        ;;
    help|*)
        echo -e "${CYAN}==================================================================${NC}"
        echo -e "${BLUE}${BOLD}     AffinMail Master Unified Management CLI (Zero Docker)        ${NC}"
        echo -e "${CYAN}==================================================================${NC}"
        echo -e "Usage: ${GREEN}affinmail <command> [options]${NC}\n"
        echo "Commands:"
        echo -e "  ${YELLOW}install${NC}         Run production bare-metal native installation"
        echo -e "  ${YELLOW}update${NC}          Zero-downtime binary & schema update"
        echo -e "  ${YELLOW}fix${NC}             Emergency auto-recovery, diagnose SSH, RAM swap & systemd"
        echo -e "  ${YELLOW}status${NC}          Check live systemd service & network port status"
        echo -e "  ${YELLOW}restart${NC}         Restart all AffinMail native services"
        echo -e "  ${YELLOW}start | stop${NC}    Start or stop running mail & web services"
        echo -e "  ${YELLOW}logs${NC} [svc]      Stream logs (e.g. affinmail logs stalwart, caddy, install)"
        echo -e "  ${YELLOW}backup${NC}          Generate instant gzipped PostgreSQL database dump"
        echo -e "  ${YELLOW}info${NC}            Display current hostname, outbound IP, and storage engine"
        echo -e "  ${YELLOW}uninstall${NC}       Cleanly remove native services (--purge-all for complete wipe)"
        echo -e "${CYAN}==================================================================${NC}"
        ;;
esac
