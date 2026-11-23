#!/usr/bin/env bash
# ==============================================================================
# AffinMail Standalone Production One-Line Installer
# Supports: curl -fsSL https://raw.githubusercontent.com/.../main/install.sh | bash
# Supported OS: Ubuntu 22.04 / 24.04 LTS, Debian 12 (x86_64 & ARM64)
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="/opt/affinmail"
REPO_URL="https://github.com/hostaffin/affinmail.git"
REPO_BRANCH="${AFFINMAIL_BRANCH:-master}"

echo -e "${CYAN}==================================================================${NC}"
echo -e "${BLUE}        AffinMail Enterprise Email Server - Automated Installer   ${NC}"
echo -e "${CYAN}==================================================================${NC}"

# 1. Root Check
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This installer must be run as root.${NC}"
    echo -e "Please run: ${YELLOW}sudo bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/hostaffin/affinmail/master/install.sh)\"${NC}"
    exit 1
fi

# 2. TTY Detection for piped execution (curl ... | bash)
TTY_INPUT="/dev/stdin"
if [ ! -t 0 ]; then
    if [ -e /dev/tty ]; then
        TTY_INPUT="/dev/tty"
    fi
fi

# 3. Detect CPU Architecture (ARM64 & x86_64)
ARCH=$(uname -m)
echo -e "${GREEN}[*] Detected CPU Architecture:${NC} $ARCH"
if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
    echo -e "${RED}[ERROR] Unsupported CPU architecture: $ARCH. AffinMail supports x86_64 and aarch64 (ARM64).${NC}"
    exit 1
fi

# 4. Bootstrap Essential Tools on Fresh Server
echo -e "\n${BLUE}[1/6] Installing Essential Dependencies (curl, git, ufw, jq)...${NC}"
apt-get update -qq
apt-get install -y -qq curl wget git ufw fail2ban dnsutils postgresql-client rsync tar jq

# 5. Bootstrap Docker Engine if missing
if ! command -v docker &> /dev/null; then
    echo -e "${GREEN}[*] Fresh server detected: Installing Docker Engine...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

# 6. Fetch/Prepare AffinMail Codebase in /opt/affinmail
echo -e "\n${BLUE}[2/6] Setting Up AffinMail Repository in ${INSTALL_DIR}...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/deploy/docker-compose.yml" ]; then
    # Running from local cloned directory
    mkdir -p "${INSTALL_DIR}"
    rsync -a --exclude='.git' --exclude='webmail/node_modules' "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
elif [ -d "${INSTALL_DIR}/.git" ]; then
    echo -e "${GREEN}[*] Updating existing installation in ${INSTALL_DIR}...${NC}"
    cd "${INSTALL_DIR}"
    git pull origin "${REPO_BRANCH}" || true
else
    echo -e "${GREEN}[*] Downloading AffinMail production files into ${INSTALL_DIR}...${NC}"
    rm -rf "${INSTALL_DIR}"
    git clone --depth 1 -b "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}" || {
        # Fallback if git fails: archive download
        mkdir -p "${INSTALL_DIR}"
        curl -fsSL "https://github.com/hostaffin/affinmail/archive/refs/heads/${REPO_BRANCH}.tar.gz" | tar -xz --strip-components=1 -C "${INSTALL_DIR}"
    }
fi

mkdir -p "${INSTALL_DIR}/data/blobs"
mkdir -p "${INSTALL_DIR}/backups"
cd "${INSTALL_DIR}"

# 7. Interactive Configuration (Supports piped execution)
echo -e "\n${CYAN}--- Configuration Setup ---${NC}"
HOSTNAME_INPUT="${AFFINMAIL_HOST:-}"
if [ -z "$HOSTNAME_INPUT" ]; then
    echo -n "Enter Primary Mail Hostname (e.g. mail.yourdomain.com): "
    read -r HOSTNAME_INPUT < "$TTY_INPUT"
fi

if [ -z "$HOSTNAME_INPUT" ]; then
    echo -e "${RED}[ERROR] Mail Hostname is required.${NC}"
    exit 1
fi

AUTO_IP=$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')
SHARED_IP_INPUT="${AFFINMAIL_IP:-}"
if [ -z "$SHARED_IP_INPUT" ]; then
    echo -n "Enter Primary Outbound IPv4 [$AUTO_IP]: "
    read -r SHARED_IP_INPUT < "$TTY_INPUT"
    SHARED_IP_INPUT="${SHARED_IP_INPUT:-$AUTO_IP}"
fi

STORAGE_TYPE_INPUT="${AFFINMAIL_STORAGE:-fs}"
if [ -z "${AFFINMAIL_STORAGE:-}" ]; then
    echo -e "\nSelect Dynamic Storage Backend for Blobs & Attachments:"
    echo "  1) Local NVMe SSD (Default, Highest Speed, 0 Cloud Cost)"
    echo "  2) S3-Compatible Storage (Cloudflare R2, AWS S3, MinIO, Wasabi)"
    echo "  3) SFTP / Remote Storage Box (Hetzner Storage Box via SFTP)"
    echo -n "Choose [1-3, default 1]: "
    read -r STORAGE_OPT < "$TTY_INPUT"
    case "$STORAGE_OPT" in
        2) STORAGE_TYPE_INPUT="s3" ;;
        3) STORAGE_TYPE_INPUT="sftp" ;;
        *) STORAGE_TYPE_INPUT="fs" ;;
    esac
fi

# 8. Configure Firewall (UFW)
echo -e "\n${BLUE}[3/6] Configuring Security & Firewall Rules...${NC}"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP ACME Let\'s Encrypt'
ufw allow 443/tcp comment 'HTTPS Webmail'
ufw allow 443/udp comment 'HTTP/3 QUIC'
ufw allow 25/tcp comment 'Inbound SMTP'
ufw allow 465/tcp comment 'SMTP Submission SSL'
ufw allow 587/tcp comment 'SMTP Submission STARTTLS'
ufw allow 993/tcp comment 'IMAP SSL'
ufw allow 4190/tcp comment 'ManageSieve'
ufw --force enable

# 9. Generate Secure Credentials & Environment File
echo -e "\n${BLUE}[4/6] Generating Strong Encryption Keys & .env Configuration...${NC}"
if [ ! -f "deploy/.env" ]; then
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
else
    echo -e "${YELLOW}[*] Existing deploy/.env detected, keeping current secrets.${NC}"
fi

# 10. Start Docker Stack
echo -e "\n${BLUE}[5/6] Pulling Multi-Arch Docker Images & Launching Stack...${NC}"
cd "${INSTALL_DIR}/deploy"
docker compose pull
docker compose up -d

# 11. Crons & CLI Setup
echo -e "\n${BLUE}[6/6] Registering System Crons and Management CLI...${NC}"
chmod +x "${INSTALL_DIR}/scripts/"*.sh

CRON_FILE="/etc/cron.d/affinmail"
cat > "$CRON_FILE" <<EOF
# AffinMail Automated Warm-up & RBL Guard
0 0 * * * root /bin/bash ${INSTALL_DIR}/scripts/warmup-cron.sh >> /var/log/affinmail-warmup.log 2>&1
0 * * * * root /bin/bash ${INSTALL_DIR}/scripts/rbl-check.sh >> /var/log/affinmail-rbl.log 2>&1
EOF
chmod 644 "$CRON_FILE"

ln -sf "${INSTALL_DIR}/scripts/affinmail.sh" /usr/local/bin/affinmail
chmod +x /usr/local/bin/affinmail

# Fetch keys for final summary
ADMIN_KEY=$(grep "STALWART_ADMIN_SECRET" "${INSTALL_DIR}/deploy/.env" | cut -d= -f2)

echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${GREEN}      AffinMail Server Successfully Installed & Running!          ${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "Webmail Interface:     ${YELLOW}https://${HOSTNAME_INPUT}${NC}"
echo -e "Hostaffin API Secret:  ${YELLOW}${ADMIN_KEY}${NC}"
echo -e "Outbound Egress IPv4:  ${YELLOW}${SHARED_IP_INPUT}${NC}"
echo -e "Storage Engine:        ${YELLOW}${STORAGE_TYPE_INPUT}${NC}"
echo -e "Management CLI:        ${CYAN}affinmail [status|restart|update|logs|backup]${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "${GREEN}You can now connect this server to Hostaffin WHMCS using the secret above.${NC}"
