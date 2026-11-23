#!/usr/bin/env bash
# ==============================================================================
# AffinMail Production Installation Script
# Supported Platforms: Ubuntu 22.04 / 24.04 LTS, Debian 12 (x86_64 & ARM64)
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

INSTALL_DIR="/opt/affinmail"

echo -e "${CYAN}==================================================================${NC}"
echo -e "${BLUE}        AffinMail Enterprise Email Server - Installer             ${NC}"
echo -e "${CYAN}==================================================================${NC}"

# 1. Root Check
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This script must be executed as root. Use sudo ./install.sh${NC}"
    exit 1
fi

# 2. Architecture Check
ARCH=$(uname -m)
echo -e "${GREEN}[*] Detecting Architecture:${NC} $ARCH"
if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
    echo -e "${RED}[ERROR] Unsupported architecture: $ARCH. AffinMail supports x86_64 and ARM64.${NC}"
    exit 1
fi

# 3. Interactive or Default Configuration
HOSTNAME_INPUT="${1:-}"
if [ -z "$HOSTNAME_INPUT" ]; then
    read -rp "Enter Primary Mail Hostname (e.g., mail.yourdomain.com): " HOSTNAME_INPUT
fi

if [ -z "$HOSTNAME_INPUT" ]; then
    echo -e "${RED}[ERROR] Mail Hostname cannot be empty.${NC}"
    exit 1
fi

SHARED_IP_INPUT="${2:-}"
if [ -z "$SHARED_IP_INPUT" ]; then
    SERVER_IP=$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')
    read -rp "Enter Primary Outbound IPv4 [$SERVER_IP]: " SHARED_IP_INPUT
    SHARED_IP_INPUT="${SHARED_IP_INPUT:-$SERVER_IP}"
fi

STORAGE_TYPE_INPUT="${3:-fs}"
echo -e "\nChoose Storage Backend:"
echo "1) Local NVMe / SSD (Default, Fast)"
echo "2) S3-Compatible Object Storage (Cloudflare R2 / AWS S3)"
echo "3) SFTP / Remote Storage Box (Hetzner Storage Box)"
read -rp "Select storage option [1]: " STORAGE_CHOICE
case "$STORAGE_CHOICE" in
    2) STORAGE_TYPE_INPUT="s3" ;;
    3) STORAGE_TYPE_INPUT="sftp" ;;
    *) STORAGE_TYPE_INPUT="fs" ;;
esac

echo -e "\n${BLUE}[1/6] Installing Essential Packages & Docker...${NC}"
apt-get update -qq
apt-get install -y -qq curl wget git ufw fail2ban dnsutils postgresql-client rsync tar jq

if ! command -v docker &> /dev/null; then
    echo -e "${GREEN}[*] Installing Docker Engine...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

echo -e "\n${BLUE}[2/6] Configuring Firewall (UFW) Ports...${NC}"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP ACME'
ufw allow 443/tcp comment 'HTTPS Webmail'
ufw allow 443/udp comment 'HTTP/3 QUIC'
ufw allow 25/tcp comment 'SMTP Inbound'
ufw allow 465/tcp comment 'SMTP Submission SSL'
ufw allow 587/tcp comment 'SMTP Submission STARTTLS'
ufw allow 993/tcp comment 'IMAP SSL'
ufw allow 4190/tcp comment 'ManageSieve'
ufw --force enable

echo -e "\n${BLUE}[3/6] Setting Up Project Directory in ${INSTALL_DIR}...${NC}"
mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/data/blobs"
mkdir -p "${INSTALL_DIR}/backups"

# If running from cloned repo, copy files; otherwise clone repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PARENT_DIR/deploy/docker-compose.yml" ]; then
    rsync -a --exclude='.git' --exclude='webmail/node_modules' "$PARENT_DIR/" "${INSTALL_DIR}/"
fi

cd "${INSTALL_DIR}"

echo -e "\n${BLUE}[4/6] Generating Secure Credentials & .env File...${NC}"
DB_PASS=$(openssl rand -hex 16)
REDIS_PASS=$(openssl rand -hex 16)
ADMIN_SECRET=$(openssl rand -hex 24)

cat > deploy/.env <<EOF
MAIL_HOSTNAME=${HOSTNAME_INPUT}
SHARED_OUTBOUND_IPV4=${SHARED_IP_INPUT}

POSTGRES_USER=affinmail_user
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=affinmail

REDIS_PASSWORD=${REDIS_PASS}
STALWART_ADMIN_SECRET=${ADMIN_SECRET}

STORAGE_BLOB_TYPE=${STORAGE_TYPE_INPUT}
STORAGE_LOCAL_PATH=${INSTALL_DIR}/data/blobs

S3_BUCKET=affinmail-blobs
S3_REGION=auto
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=

SFTP_HOST=
SFTP_USER=
SFTP_PORT=23
SFTP_REMOTE_PATH=/home/affinmail-blobs
EOF

chmod 600 deploy/.env

echo -e "\n${BLUE}[5/6] Pulling Multi-Arch Container Images & Starting Stack...${NC}"
cd "${INSTALL_DIR}/deploy"
docker compose pull
docker compose up -d

echo -e "\n${BLUE}[6/6] Setting Up Automated Crons (Warm-up & RBL Guard)...${NC}"
chmod +x "${INSTALL_DIR}/scripts/"*.sh

CRON_FILE="/etc/cron.d/affinmail"
cat > "$CRON_FILE" <<EOF
# AffinMail Scheduled Background Automations
0 0 * * * root /bin/bash ${INSTALL_DIR}/scripts/warmup-cron.sh >> /var/log/affinmail-warmup.log 2>&1
0 * * * * root /bin/bash ${INSTALL_DIR}/scripts/rbl-check.sh >> /var/log/affinmail-rbl.log 2>&1
EOF
chmod 644 "$CRON_FILE"

# Symlink CLI
ln -sf "${INSTALL_DIR}/scripts/affinmail.sh" /usr/local/bin/affinmail
chmod +x /usr/local/bin/affinmail

echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${GREEN}  AffinMail Installation Successfully Completed!                ${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "Webmail URL:        ${YELLOW}https://${HOSTNAME_INPUT}${NC}"
echo -e "Admin API Secret:   ${YELLOW}${ADMIN_SECRET}${NC}"
echo -e "Database Password:  ${YELLOW}${DB_PASS}${NC}"
echo -e "Redis Password:     ${YELLOW}${REDIS_PASS}${NC}"
echo -e "Install Directory:  ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "Management CLI:     ${CYAN}affinmail status | restart | logs | update${NC}"
echo -e "${CYAN}==================================================================${NC}"
