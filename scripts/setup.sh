#!/usr/bin/env bash
# AffinMail Multi-Arch Production Bootstrap Script
# Compatible with Ubuntu 22.04 / 24.04 and Debian 12 (x86_64 & ARM64)

set -euo pipefail

echo "=========================================================="
echo "    AffinMail Enterprise Node Setup (x86_64 / ARM64)      "
echo "=========================================================="

ARCH=$(uname -m)
echo "Detected CPU Architecture: $ARCH"

if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
    echo "Unsupported CPU architecture: $ARCH. AffinMail supports x86_64 and aarch64 (ARM64)."
    exit 1
fi

echo "[1/4] Installing Docker and essential system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git ufw fail2ban dnsutils postgresql-client

if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
fi

echo "[2/4] Configuring Linux Firewall (UFW) for Mail Delivery..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP ACME
ufw allow 443/tcp     # HTTPS Webmail / JMAP
ufw allow 443/udp     # HTTP/3 QUIC
ufw allow 25/tcp      # Inbound SMTP
ufw allow 465/tcp     # Implicit TLS SMTP Submission
ufw allow 587/tcp     # STARTTLS SMTP Submission
ufw allow 993/tcp     # IMAP over TLS
ufw allow 4190/tcp    # ManageSieve
ufw --force enable

echo "[3/4] Preparing directories and environment..."
mkdir -p /opt/affinmail/data/blobs
mkdir -p /opt/affinmail/backups
cd /opt/affinmail

if [ ! -f "deploy/.env" ]; then
    cp deploy/.env.example deploy/.env
    echo "Created deploy/.env. Please review and update passwords."
fi

echo "[4/4] Starting AffinMail Container Stack..."
cd deploy
docker compose pull
docker compose up -d

echo "=========================================================="
echo "    AffinMail successfully deployed and running!         "
echo "    Access Webmail at: https://$(grep MAIL_HOSTNAME deploy/.env | cut -d= -f2) "
echo "=========================================================="
