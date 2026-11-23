#!/usr/bin/env bash
# ==============================================================================
# AffinMail Master Unified Management CLI
# Usage: affinmail [install|uninstall|update|status|restart|logs|backup|info]
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/affinmail"

# Resolve script directory if run locally
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
        bash "${BASE_DIR}/scripts/install.sh" "$@"
        ;;
    uninstall)
        shift || true
        bash "${BASE_DIR}/scripts/uninstall.sh" "$@"
        ;;
    update)
        shift || true
        bash "${BASE_DIR}/scripts/update.sh" "$@"
        ;;
    status)
        echo -e "${CYAN}=== AffinMail Service Status ===${NC}"
        cd "${BASE_DIR}/deploy"
        docker compose ps
        ;;
    restart)
        echo -e "${BLUE}Restarting AffinMail Services...${NC}"
        cd "${BASE_DIR}/deploy"
        docker compose restart
        docker compose ps
        ;;
    stop)
        echo -e "${YELLOW}Stopping AffinMail Services...${NC}"
        cd "${BASE_DIR}/deploy"
        docker compose stop
        ;;
    start)
        echo -e "${GREEN}Starting AffinMail Services...${NC}"
        cd "${BASE_DIR}/deploy"
        docker compose start
        ;;
    logs)
        shift || true
        SERVICE="${1:-}"
        cd "${BASE_DIR}/deploy"
        if [ -n "$SERVICE" ]; then
            docker compose logs -f "$SERVICE"
        else
            docker compose logs -f --tail=100
        fi
        ;;
    backup)
        echo -e "${BLUE}Creating Immediate Backup...${NC}"
        mkdir -p "${BASE_DIR}/backups"
        BKP_NAME="manual_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
        docker exec -t $(docker compose -f "${BASE_DIR}/deploy/docker-compose.yml" ps -q postgres) \
            pg_dump -U affinmail_user affinmail | gzip > "${BASE_DIR}/backups/${BKP_NAME}"
        echo -e "${GREEN}[*] Backup created successfully:${NC} ${BASE_DIR}/backups/${BKP_NAME}"
        ;;
    info)
        echo -e "${CYAN}=== AffinMail System Information ===${NC}"
        if [ -f "${BASE_DIR}/deploy/.env" ]; then
            grep -E "MAIL_HOSTNAME|SHARED_OUTBOUND_IPV4|STORAGE_BLOB_TYPE" "${BASE_DIR}/deploy/.env"
        fi
        echo "Architecture: $(uname -m)"
        echo "Root Path:    ${BASE_DIR}"
        ;;
    help|*)
        echo -e "${CYAN}==================================================================${NC}"
        echo -e "${BLUE}           AffinMail Master Unified Management CLI                ${NC}"
        echo -e "${CYAN}==================================================================${NC}"
        echo -e "Usage: ${GREEN}affinmail <command> [options]${NC}\n"
        echo "Commands:"
        echo -e "  ${YELLOW}install${NC}       Run interactive production installation"
        echo -e "  ${YELLOW}uninstall${NC}     Cleanly stop and remove services (--purge-all for complete wipe)"
        echo -e "  ${YELLOW}update${NC}        Perform zero-downtime rolling update & DB migrations"
        echo -e "  ${YELLOW}status${NC}        Check live Docker containers and port status"
        echo -e "  ${YELLOW}restart${NC}       Restart all AffinMail services"
        echo -e "  ${YELLOW}start${NC}         Start stopped services"
        echo -e "  ${YELLOW}stop${NC}          Stop running services"
        echo -e "  ${YELLOW}logs${NC} [svc]    Stream live container logs (e.g. affinmail logs stalwart)"
        echo -e "  ${YELLOW}backup${NC}        Generate instant gzipped PostgreSQL database dump"
        echo -e "  ${YELLOW}info${NC}          Display current domain, egress IP, and storage engine"
        echo -e "${CYAN}==================================================================${NC}"
        ;;
esac
