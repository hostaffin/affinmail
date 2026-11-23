#!/usr/bin/env bash
# ==============================================================================
# AffinMail Emergency Diagnosis & Auto-Fix Script
# Resolves SSH lockouts, firewall misconfigurations, Docker stalls, OOM issues,
# and displays recent installer error logs.
# Usage: affinmail fix   OR   bash /opt/affinmail/scripts/fix.sh
# ==============================================================================

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

LOG_FILE="/var/log/affinmail-install.log"
INSTALL_DIR="/opt/affinmail"

echo -e "${CYAN}==================================================================${NC}"
echo -e "${BLUE}${BOLD}        AffinMail Emergency Diagnosis & Auto-Recovery Tool        ${NC}"
echo -e "${CYAN}==================================================================${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This script must be run as root (use sudo or sudo -i).${NC}"
    exit 1
fi

# 1. Review Recent Install Log Errors
echo -e "\n${BLUE}[1/6] Inspecting Recent Installation Logs...${NC}"
if [ -f "$LOG_FILE" ]; then
    echo -e "${GREEN}[*] Found log at ${LOG_FILE}. Last 25 lines:${NC}"
    echo -e "${YELLOW}------------------------------------------------------------${NC}"
    tail -n 25 "$LOG_FILE"
    echo -e "${YELLOW}------------------------------------------------------------${NC}"
else
    echo -e "${YELLOW}[*] No install log found at ${LOG_FILE}.${NC}"
fi

# 2. Memory & Swap Health Check
echo -e "\n${BLUE}[2/6] Checking System Memory & Swap...${NC}"
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
TOTAL_SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
echo -e "RAM: ${TOTAL_RAM_MB}MB | Swap: ${TOTAL_SWAP_MB}MB"

if [ "$TOTAL_SWAP_MB" -lt 512 ]; then
    echo -e "${YELLOW}[*] Critical: Server has little or no swap memory. Creating 2GB swapfile...${NC}"
    if [ ! -f /swapfile ]; then
        dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress 2>/dev/null || fallocate -l 2G /swapfile 2>/dev/null
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
        swapon /swapfile >/dev/null 2>&1 || true
        if ! grep -q "/swapfile" /etc/fstab; then
            echo '/swapfile none swap sw 0 0' >> /etc/fstab
        fi
        echo -e "${GREEN}[*] 2GB Swap activated to protect against OOM crashes.${NC}"
    else
        swapon /swapfile >/dev/null 2>&1 || true
        echo -e "${GREEN}[*] Existing /swapfile re-activated.${NC}"
    fi
else
    echo -e "${GREEN}[*] Memory allocation is healthy.${NC}"
fi

# 3. SSH & Firewall Protection Check
echo -e "\n${BLUE}[3/6] Verifying Firewall & SSH Port Safeguards...${NC}"
ACTIVE_SSH_PORT=$(ss -tlnp 2>/dev/null | grep sshd | awk '{print $4}' | awk -F: '{print $NF}' | head -n1 || echo 22)
ACTIVE_SSH_PORT="${ACTIVE_SSH_PORT:-22}"

# AlmaLinux Firewalld Fix
if command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld; then
    echo -e "${GREEN}[*] Firewalld detected. Ensuring ports are permanently open...${NC}"
    firewall-cmd --permanent --add-service=ssh >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-port="${ACTIVE_SSH_PORT}/tcp" >/dev/null 2>&1 || true
    for P in 2087/tcp 2083/tcp 25/tcp 80/tcp 443/tcp 465/tcp 587/tcp 993/tcp 4190/tcp; do
        firewall-cmd --permanent --add-port="$P" >/dev/null 2>&1 || true
    done
    firewall-cmd --reload >/dev/null 2>&1 || true
    echo -e "${GREEN}[*] Firewalld verified and reloaded successfully.${NC}"
fi

# Ubuntu / Debian UFW Fix
if command -v ufw &>/dev/null; then
    echo -e "${GREEN}[*] UFW detected. Ensuring ports are allowed...${NC}"
    ufw allow "${ACTIVE_SSH_PORT}/tcp" >/dev/null 2>&1 || true
    for P in 2087/tcp 2083/tcp 25/tcp 80/tcp 443/tcp 465/tcp 587/tcp 993/tcp 4190/tcp; do
        ufw allow "$P" >/dev/null 2>&1 || true
    done
    echo -e "${GREEN}[*] UFW rules verified successfully.${NC}"
fi

# 4. Docker Service Recovery
echo -e "\n${BLUE}[4/6] Verifying Docker Engine Status...${NC}"
if ! command -v docker &>/dev/null; then
    echo -e "${RED}[!] Docker is missing. Attempting emergency installation...${NC}"
    curl -fsSL https://get.docker.com | sh || true
fi

systemctl daemon-reload || true
systemctl restart docker || true
if systemctl is-active --quiet docker; then
    echo -e "${GREEN}[*] Docker Engine is running: $(docker --version)${NC}"
else
    echo -e "${RED}[ERROR] Failed to start Docker Engine. Check: journalctl -xeu docker${NC}"
fi

# 5. SELinux Permissions Fix (AlmaLinux/RHEL)
if command -v getenforce &>/dev/null; then
    if [ "$(getenforce)" != "Disabled" ] && [ -d "$INSTALL_DIR" ]; then
        echo -e "\n${BLUE}[5/6] Re-applying SELinux Container Permissions...${NC}"
        chcon -Rt svirt_sandbox_file_t "${INSTALL_DIR}" 2>/dev/null || true
        setsebool -P container_manage_cgroup 1 2>/dev/null || true
        echo -e "${GREEN}[*] SELinux permissions re-applied for ${INSTALL_DIR}.${NC}"
    fi
fi

# 6. Container Stack Health & Restart
echo -e "\n${BLUE}[6/6] Orchestrating Container Stack Recovery...${NC}"
if [ -d "${INSTALL_DIR}/deploy" ]; then
    cd "${INSTALL_DIR}/deploy"
    docker compose up -d --remove-orphans || true
    sleep 3
    echo -e "\n${CYAN}=== Container Services Status ===${NC}"
    docker compose ps
else
    echo -e "${YELLOW}[!] Install directory ${INSTALL_DIR} not found. Please run install.sh.${NC}"
fi

echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${GREEN}${BOLD}           AffinMail Diagnostic & Fix Completed!                 ${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "To inspect full real-time logs:  ${YELLOW}cat ${LOG_FILE}${NC}"
echo -e "To monitor container logs:       ${YELLOW}docker compose -f ${INSTALL_DIR}/deploy/docker-compose.yml logs -f${NC}"
echo -e "To re-run installer:             ${CYAN}bash ${INSTALL_DIR}/install.sh${NC}"
echo -e "${CYAN}==================================================================${NC}"
