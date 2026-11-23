#!/usr/bin/env bash
# ==============================================================================
# AffinMail Standalone Production Universal Installer (Zero Docker Dependency)
# Compatible with both curl and wget:
# bash <(curl -fsSL https://raw.githubusercontent.com/.../install.sh 2>/dev/null || wget -qO- https://raw.githubusercontent.com/.../install.sh)
# Supported OS: 
#   - AlmaLinux 8 / 9, Rocky Linux 8 / 9, RHEL / CentOS Stream (x86_64 & ARM64)
#   - Ubuntu 22.04 / 24.04 LTS, Debian 12 (x86_64 & ARM64)
# Architecture:
#   - 100% Native Bare-Metal execution (Native Systemd Services)
#   - Zero Docker daemon, Zero container overhead
# ==============================================================================

set -uo pipefail

LOG_FILE="/var/log/affinmail-install.log"
INSTALL_DIR="/opt/affinmail"
REPO_URL="https://github.com/hostaffin/affinmail.git"
REPO_BRANCH="${AFFINMAIL_BRANCH:-master}"
VERSION="2.0.0-native"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Initialize Logging
mkdir -p /var/log
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

# Log everything in real-time while displaying to user
exec > >(tee -a "$LOG_FILE") 2>&1

echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${BLUE}${BOLD}   AffinMail Enterprise Email Server - Native Installer (v${VERSION})   ${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "${GREEN}[*] Real-time installation log is being written to:${NC} ${BOLD}${LOG_FILE}${NC}"
echo -e "${GREEN}[*] Timestamp:${NC} $(date -u)"

# Error Exit Trap
on_error() {
    local exit_code=$?
    local line_number=$1
    if [ $exit_code -ne 0 ]; then
        echo -e "\n${RED}==================================================================${NC}"
        echo -e "${RED}[FATAL ERROR] Installation failed at line ${line_number} (Exit Code: ${exit_code})${NC}"
        echo -e "${RED}==================================================================${NC}"
        echo -e "To inspect the exact error, review the log file:"
        echo -e "  ${YELLOW}tail -n 50 ${LOG_FILE}${NC}"
        echo -e "Or run the AffinMail emergency recovery tool:"
        echo -e "  ${CYAN}bash /opt/affinmail/scripts/fix.sh${NC}"
        echo -e "${RED}==================================================================${NC}\n"
    fi
}
trap 'on_error $LINENO' EXIT

# 1. Root Privileges Check
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] This installer requires root privileges.${NC}"
    echo -e "Please switch to root with: ${YELLOW}sudo -i${NC} and rerun the command."
    exit 1
fi

# 2. TTY Detection (Works with curl | bash, wget | bash, or bash <(...))
TTY_INPUT="/dev/stdin"
if [ ! -t 0 ]; then
    if [ -e /dev/tty ]; then
        TTY_INPUT="/dev/tty"
    fi
fi

# 3. Detect Active SSH Port (Protects against SSH lockouts)
ACTIVE_SSH_PORT=$(ss -tlnp 2>/dev/null | grep sshd | awk '{print $4}' | awk -F: '{print $NF}' | head -n1 || echo 22)
ACTIVE_SSH_PORT="${ACTIVE_SSH_PORT:-22}"
echo -e "${GREEN}[*] Active SSH Port Detected:${NC} ${BOLD}${ACTIVE_SSH_PORT}/tcp${NC} (Will be protected in firewall)"

# 4. Detect OS Distribution
OS_FAMILY="debian"
OS_NAME="Linux"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="${NAME:-Linux}"
    if [[ "${ID:-}" =~ (almalinux|rocky|rhel|centos|fedora) ]] || [[ "${ID_LIKE:-}" =~ (rhel|fedora|centos) ]]; then
        OS_FAMILY="rhel"
    elif [[ "${ID:-}" =~ (ubuntu|debian) ]] || [[ "${ID_LIKE:-}" =~ (debian) ]]; then
        OS_FAMILY="debian"
    fi
fi
echo -e "${GREEN}[*] Detected Operating System:${NC} ${BOLD}${OS_NAME} (${OS_FAMILY} family)${NC}"

# 5. Detect & Validate CPU Architecture (ARM64 & x86_64)
ARCH=$(uname -m)
echo -e "${GREEN}[*] Detected CPU Architecture:${NC} ${BOLD}$ARCH${NC}"
if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
    echo -e "${RED}[ERROR] Unsupported CPU architecture: $ARCH.${NC}"
    echo -e "AffinMail natively supports x86_64 (Intel/AMD) and aarch64 (ARM64)."
    exit 1
fi

# 6. Low-Memory Protection (Auto Swap Creation to Prevent OOM Crashes)
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
TOTAL_SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
echo -e "${GREEN}[*] Memory Check:${NC} RAM: ${TOTAL_RAM_MB}MB | Swap: ${TOTAL_SWAP_MB}MB"

if [ "$TOTAL_SWAP_MB" -lt 512 ] && [ "$TOTAL_RAM_MB" -lt 3500 ]; then
    echo -e "${YELLOW}[*] Low RAM detected (< 3.5GB) without swap. Creating 2GB /swapfile to prevent OOM crash...${NC}"
    if [ ! -f /swapfile ]; then
        dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress 2>/dev/null || fallocate -l 2G /swapfile 2>/dev/null
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
        swapon /swapfile >/dev/null 2>&1 || true
        if ! grep -q "/swapfile" /etc/fstab; then
            echo '/swapfile none swap sw 0 0' >> /etc/fstab
        fi
        echo -e "${GREEN}[*] 2GB Swap enabled successfully.${NC}"
    fi
fi

# 7. Bootstrap Essential Native System Packages (Zero Docker)
echo -e "\n${BLUE}[1/6] Bootstrapping Native System Packages (PostgreSQL, Redis, Firewalls)...${NC}"
if [ "$OS_FAMILY" == "rhel" ]; then
    # AlmaLinux / Rocky / RHEL
    echo -e "${GREEN}[*] Installing packages via DNF (AlmaLinux/RHEL)...${NC}"
    dnf install -y epel-release || true
    dnf install -y --skip-broken curl wget git firewalld bind-utils postgresql-server postgresql-contrib redis rsync tar jq openssl iptables procps-ng
    # Initialize PostgreSQL data cluster if first time
    if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
        echo -e "${GREEN}[*] Initializing PostgreSQL data directory...${NC}"
        postgresql-setup --initdb 2>/dev/null || /usr/bin/postgresql-setup --initdb 2>/dev/null || true
    fi
    # Configure pg_hba.conf for localhost md5 authentication
    if [ -f /var/lib/pgsql/data/pg_hba.conf ]; then
        if ! grep -q "host    all             all             127.0.0.1/32" /var/lib/pgsql/data/pg_hba.conf; then
            echo "host    all             all             127.0.0.1/32            md5" >> /var/lib/pgsql/data/pg_hba.conf
        fi
    fi
    systemctl daemon-reload || true
    systemctl enable --now postgresql
    systemctl enable --now redis
else
    # Ubuntu / Debian
    echo -e "${GREEN}[*] Installing packages via APT (Ubuntu/Debian)...${NC}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl wget git ufw fail2ban dnsutils postgresql postgresql-contrib redis-server rsync tar jq openssl procps
    systemctl daemon-reload || true
    systemctl enable --now postgresql
    systemctl enable --now redis-server || systemctl enable --now redis
fi

# 8. Install Native Standalone Binaries: Caddy & Stalwart Mail Engine
echo -e "\n${BLUE}[2/6] Installing Native High-Performance Binaries (Caddy & Stalwart)...${NC}"

# 8a. Install Native Caddy 2 Binary
CADDY_ARCH="amd64"
if [ "$ARCH" == "aarch64" ]; then
    CADDY_ARCH="arm64"
fi

if ! command -v caddy &>/dev/null; then
    echo -e "${GREEN}[*] Downloading native Caddy binary (${CADDY_ARCH})...${NC}"
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}" -o /usr/local/bin/caddy 2>/dev/null || \
    curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_${CADDY_ARCH}.tar.gz" | tar -xz -C /tmp && mv /tmp/caddy /usr/local/bin/caddy
    chmod 755 /usr/local/bin/caddy
    echo -e "${GREEN}[*] Caddy installed successfully: $(/usr/local/bin/caddy version 2>/dev/null | head -n1)${NC}"
else
    echo -e "${GREEN}[*] Caddy binary already present: $(caddy version 2>/dev/null | head -n1)${NC}"
fi

# 8b. Install Native Stalwart Mail Server Binary
STALWART_ARCH="x86_64-unknown-linux-musl"
if [ "$ARCH" == "aarch64" ]; then
    STALWART_ARCH="aarch64-unknown-linux-musl"
fi

if [ ! -f /usr/local/bin/stalwart-mail ]; then
    echo -e "${GREEN}[*] Downloading native Stalwart Mail Server binary (${STALWART_ARCH})...${NC}"
    TMP_STALWART=$(mktemp -d)
    if curl -fsSL "https://github.com/stalwartlabs/stalwart/releases/latest/download/stalwart-${STALWART_ARCH}.tar.gz" -o "${TMP_STALWART}/stalwart.tar.gz" 2>/dev/null; then
        tar -xzf "${TMP_STALWART}/stalwart.tar.gz" -C "${TMP_STALWART}"
        if [ -f "${TMP_STALWART}/stalwart-mail" ]; then
            mv "${TMP_STALWART}/stalwart-mail" /usr/local/bin/stalwart-mail
        elif [ -f "${TMP_STALWART}/stalwart" ]; then
            mv "${TMP_STALWART}/stalwart" /usr/local/bin/stalwart-mail
        fi
    elif curl --proto '=https' --tlsv1.2 -sSf https://get.stalw.art/install.sh 2>/dev/null; then
        curl --proto '=https' --tlsv1.2 -sSf https://get.stalw.art/install.sh | sh || true
        if [ -f /usr/local/bin/stalwart ] && [ ! -f /usr/local/bin/stalwart-mail ]; then
            ln -sf /usr/local/bin/stalwart /usr/local/bin/stalwart-mail
        fi
    fi
    rm -rf "${TMP_STALWART}"
    chmod 755 /usr/local/bin/stalwart-mail 2>/dev/null || true
    ln -sf /usr/local/bin/stalwart-mail /usr/local/bin/stalwart 2>/dev/null || true
    echo -e "${GREEN}[*] Stalwart native mail engine installed to /usr/local/bin/stalwart-mail${NC}"
else
    echo -e "${GREEN}[*] Stalwart mail engine binary already present at /usr/local/bin/stalwart-mail${NC}"
fi

# 9. Fetch / Clone Codebase to /opt/affinmail
echo -e "\n${BLUE}[3/6] Preparing AffinMail Core in ${INSTALL_DIR}...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/deploy/Caddyfile" ] && [ -d "${SCRIPT_DIR}/webmail" ]; then
    # Running from local cloned repo
    mkdir -p "${INSTALL_DIR}"
    rsync -a --exclude='.git' --exclude='webmail/node_modules' "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
elif [ -d "${INSTALL_DIR}/.git" ]; then
    echo -e "${GREEN}[*] Updating existing installation to latest version...${NC}"
    cd "${INSTALL_DIR}"
    git pull origin "${REPO_BRANCH}" || true
else
    echo -e "${GREEN}[*] Fetching latest production release from GitHub...${NC}"
    rm -rf "${INSTALL_DIR}"
    git clone --depth 1 -b "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}" 2>/dev/null || {
        mkdir -p "${INSTALL_DIR}"
        curl -fsSL "https://github.com/hostaffin/affinmail/archive/refs/heads/${REPO_BRANCH}.tar.gz" | tar -xz --strip-components=1 -C "${INSTALL_DIR}"
    }
fi

mkdir -p "${INSTALL_DIR}/data/blobs"
mkdir -p "${INSTALL_DIR}/data/queue"
mkdir -p "${INSTALL_DIR}/backups"
chmod -R 750 "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

# Auto-detect Public IP & System Hostname
AUTO_IP=$(curl -s -4 ifconfig.me 2>/dev/null || wget -qO- -4 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')
AUTO_IP="${AUTO_IP// /}"
SYS_HOSTNAME=$(hostname -f 2>/dev/null || hostname 2>/dev/null || uname -n 2>/dev/null || echo "")
SYS_HOSTNAME="${SYS_HOSTNAME// /}"

# Pick the real server hostname if valid FQDN; otherwise default directly to the server IP (No artificial mail.* prefix, no nip.io)
if [[ -n "$SYS_HOSTNAME" && "$SYS_HOSTNAME" =~ \. && "$SYS_HOSTNAME" != *"localhost"* && "$SYS_HOSTNAME" != *"localdomain"* ]]; then
    DEFAULT_SERVER_HOST="$SYS_HOSTNAME"
else
    DEFAULT_SERVER_HOST="${AUTO_IP:-127.0.0.1}"
fi

# 10. Setup Mode Selection (Interactive Now vs Express / Setup Later from Panel)
echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${BOLD}Choose Installation Mode:${NC}"
echo -e "  ${YELLOW}1)${NC} ${BOLD}Complete Interactive Setup Now${NC} (Configure Server Hostname, IP, Storage now)"
echo -e "  ${YELLOW}2)${NC} ${BOLD}Express Setup (Setup Later from Panel)${NC} (Instant zero-touch start using Server Hostname/IP: ${DEFAULT_SERVER_HOST})"
echo -e "${CYAN}==================================================================${NC}"
echo -n "Select mode [1 or 2, default: 1]: "
read -r SETUP_MODE < "$TTY_INPUT"
SETUP_MODE="${SETUP_MODE:-1}"

# Defaults
SERVER_HOST="${DEFAULT_SERVER_HOST}"
SHARED_IP_INPUT="${AUTO_IP}"
STORAGE_TYPE_INPUT="fs"
S3_BUCKET_VAL="affinmail-blobs"
S3_ENDPOINT_VAL=""
S3_REGION_VAL="auto"
S3_KEY_VAL=""
S3_SEC_VAL=""
SFTP_HOST_VAL=""
SFTP_USER_VAL=""
SFTP_PORT_VAL="22"

if [ "$SETUP_MODE" == "1" ]; then
    # Full Interactive Walkthrough
    echo -e "\n${CYAN}--- Server Hostname & Network Configuration ---${NC}"
    echo -n "Enter Server Hostname or IP [default: ${DEFAULT_SERVER_HOST}]: "
    read -r MANUAL_HOST < "$TTY_INPUT"
    SERVER_HOST="${MANUAL_HOST:-$DEFAULT_SERVER_HOST}"

    echo -n "Enter Primary Outbound IPv4 [default: $AUTO_IP]: "
    read -r MANUAL_IP < "$TTY_INPUT"
    SHARED_IP_INPUT="${MANUAL_IP:-$AUTO_IP}"

    echo -e "\nSelect Storage Backend for Emails & Attachments:"
    echo "  1) Local NVMe / SSD (Default, Ultra-low latency, 0 cloud cost)"
    echo "  2) S3-Compatible Object Storage (Cloudflare R2, AWS S3, MinIO, Wasabi)"
    echo "  3) SFTP / Remote Storage Box (Hetzner Storage Box via SFTP)"
    echo -n "Choose [1-3, default 1]: "
    read -r ST_CHOICE < "$TTY_INPUT"
    case "$ST_CHOICE" in
        2)
            STORAGE_TYPE_INPUT="s3"
            echo -n "Enter S3 Bucket Name [affinmail-blobs]: "
            read -r S3_B < "$TTY_INPUT"
            S3_BUCKET_VAL="${S3_B:-affinmail-blobs}"
            echo -n "Enter S3 Endpoint (e.g. https://<id>.r2.cloudflarestorage.com or s3.us-east-1.amazonaws.com): "
            read -r S3_ENDPOINT_VAL < "$TTY_INPUT"
            echo -n "Enter S3 Access Key ID: "
            read -r S3_KEY_VAL < "$TTY_INPUT"
            echo -n "Enter S3 Secret Access Key: "
            read -r S3_SEC_VAL < "$TTY_INPUT"
            ;;
        3)
            STORAGE_TYPE_INPUT="sftp"
            echo -n "Enter SFTP Host (e.g. uXXXXXX.your-storagebox.de): "
            read -r SFTP_HOST_VAL < "$TTY_INPUT"
            echo -n "Enter SFTP Username: "
            read -r SFTP_USER_VAL < "$TTY_INPUT"
            echo -n "Enter SFTP Port [22 or 23]: "
            read -r SFTP_P < "$TTY_INPUT"
            SFTP_PORT_VAL="${SFTP_P:-22}"
            ;;
        *)
            STORAGE_TYPE_INPUT="fs"
            ;;
    esac
else
    # Express Setup Mode: Instant Ready with smart defaults
    echo -e "\n${GREEN}[*] Express Mode: Auto-configuring defaults with Server Hostname/IP (${DEFAULT_SERVER_HOST})...${NC}"
    echo -e "${YELLOW}[*] You will be able to edit domains, storage, and mailboxes directly from Hostaffin Panel!${NC}"
    SERVER_HOST="${DEFAULT_SERVER_HOST}"
fi

# 11. Fail-Safe Firewall Configuration (Guarantees SSH Port Never Blocked)
echo -e "\n${BLUE}[4/6] Hardening Firewall Ports (SSH: ${ACTIVE_SSH_PORT}, 25, 80, 443, 465, 587, 993, 2083, 2087, 4190)...${NC}"
PORTS=(
    "${ACTIVE_SSH_PORT}/tcp"
    "22/tcp"
    "80/tcp"
    "443/tcp"
    "443/udp"
    "2087/tcp"
    "2083/tcp"
    "25/tcp"
    "465/tcp"
    "587/tcp"
    "993/tcp"
    "4190/tcp"
)

if [ "$OS_FAMILY" == "rhel" ]; then
    # AlmaLinux Firewalld
    if command -v firewall-offline-cmd &>/dev/null; then
        firewall-offline-cmd --add-port="${ACTIVE_SSH_PORT}/tcp" --add-service=ssh >/dev/null 2>&1 || true
    fi
    systemctl enable --now firewalld >/dev/null 2>&1 || true
    if systemctl is-active --quiet firewalld; then
        firewall-cmd --permanent --add-service=ssh >/dev/null 2>&1 || true
        for P in "${PORTS[@]}"; do
            firewall-cmd --permanent --add-port="$P" >/dev/null 2>&1 || true
        done
        firewall-cmd --reload >/dev/null 2>&1 || true
        echo -e "${GREEN}[*] Firewalld rules configured without disrupting SSH.${NC}"
    fi
else
    # Ubuntu / Debian UFW
    ufw allow "${ACTIVE_SSH_PORT}/tcp" comment 'Active SSH' >/dev/null 2>&1 || true
    ufw default deny incoming >/dev/null 2>&1 || true
    ufw default allow outgoing >/dev/null 2>&1 || true
    for P in "${PORTS[@]}"; do
        ufw allow "$P" >/dev/null 2>&1 || true
    done
    ufw --force enable >/dev/null 2>&1 || true
    echo -e "${GREEN}[*] UFW rules configured successfully.${NC}"
fi

# 12. Generate Credentials, .env Config & Initialize Native PostgreSQL
echo -e "\n${BLUE}[5/6] Initializing Native Database & Configuration...${NC}"

if [ ! -f "deploy/.env" ]; then
    DB_PASS=$(openssl rand -hex 16)
    ADMIN_SECRET=$(openssl rand -hex 24)

    cat > deploy/.env <<EOF
SERVER_HOSTNAME=${SERVER_HOST}
MAIL_HOSTNAME=${SERVER_HOST}
SHARED_OUTBOUND_IPV4=${SHARED_IP_INPUT}

POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=affinmail_user
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=affinmail

STALWART_REDIS_URL=redis://127.0.0.1:6379
STALWART_ADMIN_SECRET=${ADMIN_SECRET}

STORAGE_BLOB_TYPE=${STORAGE_TYPE_INPUT}
STORAGE_LOCAL_PATH=${INSTALL_DIR}/data/blobs
WEBMAIL_ROOT=${INSTALL_DIR}/webmail/dist

S3_BUCKET=${S3_BUCKET_VAL}
S3_REGION=${S3_REGION_VAL}
S3_ENDPOINT=${S3_ENDPOINT_VAL}
S3_ACCESS_KEY=${S3_KEY_VAL}
S3_SECRET_KEY=${S3_SEC_VAL}

SFTP_HOST=${SFTP_HOST_VAL}
SFTP_USER=${SFTP_USER_VAL}
SFTP_PORT=${SFTP_PORT_VAL}
SFTP_REMOTE_PATH=/home/affinmail-blobs
EOF
    chmod 600 deploy/.env
else
    echo -e "${YELLOW}[*] Existing deploy/.env found, preserving established credentials.${NC}"
    DB_PASS=$(grep "POSTGRES_PASSWORD" deploy/.env | cut -d= -f2)
fi

# Wait for PostgreSQL daemon to accept connections
echo -e "${GREEN}[*] Connecting to native PostgreSQL daemon...${NC}"
for i in {1..30}; do
    if sudo -u postgres pg_isready >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Create native PostgreSQL user and database
echo -e "${GREEN}[*] Configuring PostgreSQL user and database...${NC}"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='affinmail_user'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE USER affinmail_user WITH ENCRYPTED PASSWORD '${DB_PASS}';"

sudo -u postgres psql -c "ALTER USER affinmail_user WITH ENCRYPTED PASSWORD '${DB_PASS}';" 2>/dev/null || true

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='affinmail'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE affinmail OWNER affinmail_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE affinmail TO affinmail_user;" 2>/dev/null || true
sudo -u postgres psql -d affinmail -c "GRANT ALL ON SCHEMA public TO affinmail_user;" 2>/dev/null || true

# Execute initial schema & seeds if tables not yet populated
TABLE_COUNT=$(sudo -u postgres psql -d affinmail -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo 0)
if [ "${TABLE_COUNT:-0}" -lt 5 ]; then
    echo -e "${GREEN}[*] Running initial SQL schema & seed migrations...${NC}"
    sudo -u postgres psql -d affinmail -f "${INSTALL_DIR}/sql/001_initial_schema.sql" >/dev/null 2>&1 || true
    sudo -u postgres psql -d affinmail -f "${INSTALL_DIR}/sql/002_seed_demo_data.sql" >/dev/null 2>&1 || true
fi

# 13. Install Native Systemd Units & Launch Services
echo -e "\n${BLUE}[6/6] Registering & Starting Native Systemd Services (Zero Docker)...${NC}"
cp "${INSTALL_DIR}/deploy/systemd/stalwart-mail.service" /etc/systemd/system/stalwart-mail.service
cp "${INSTALL_DIR}/deploy/systemd/affinmail-caddy.service" /etc/systemd/system/affinmail-caddy.service
cp "${INSTALL_DIR}/deploy/systemd/affinmail.target" /etc/systemd/system/affinmail.target

systemctl daemon-reload
systemctl enable --now stalwart-mail.service
systemctl enable --now affinmail-caddy.service
systemctl enable affinmail.target

# 14. Register Crons and Master CLI
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

ADMIN_KEY=$(grep "STALWART_ADMIN_SECRET" "${INSTALL_DIR}/deploy/.env" | cut -d= -f2)

# Clear EXIT trap on success
trap - EXIT

echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${GREEN}${BOLD}   AffinMail Native Bare-Metal Server Successfully Installed!    ${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "Operating System:        ${GREEN}${OS_NAME} (${ARCH}) [Zero Docker]${NC}"
echo -e "Server Hostname / IP:    ${GREEN}${SERVER_HOST}${NC}"
echo -e "WHM Admin Control Panel: ${YELLOW}https://${SERVER_HOST}:2087${NC}"
echo -e "Client Webmail Portal:   ${YELLOW}https://${SERVER_HOST}:2083${NC}"
echo -e "Admin API Secret:        ${YELLOW}${ADMIN_KEY}${NC}"
echo -e "Outbound Egress IPv4:    ${YELLOW}${SHARED_IP_INPUT}${NC}"
echo -e "Storage Engine:          ${YELLOW}${STORAGE_TYPE_INPUT}${NC}"
echo -e "Installation Log:        ${CYAN}${LOG_FILE}${NC}"
echo -e "Management CLI:          ${CYAN}affinmail [status|restart|update|logs|fix|backup]${NC}"
echo -e "${CYAN}==================================================================${NC}"
if [ "$SETUP_MODE" == "2" ]; then
    echo -e "${GREEN}Mode Note: Express setup completed. You can now connect this node to Hostaffin WHMCS${NC}"
    echo -e "${GREEN}or configure custom domains and S3/SFTP storage directly from the panel or deploy/.env!${NC}"
fi
