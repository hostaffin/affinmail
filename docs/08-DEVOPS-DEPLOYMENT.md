# AffinMail: DevOps, Infrastructure & Deployment Playbook (Zero Docker Native Bare-Metal)

---

## 1. Infrastructure Architecture & Sizing

### 1.1 Multi-Architecture Hardware Blueprint (x86_64 & ARM64)
AffinMail is engineered for **Zero Docker Dependency** with 100% native execution across both CPU architectures:

| Architecture | Recommended VPS / Instance | CPU Specification | RAM / NVMe | Monthly Est. |
| :--- | :--- | :--- | :--- | :--- |
| **x86_64 (AMD/Intel)** | Hetzner Cloud CPX21 | 3 vCPUs (AMD EPYC) | 4 GB RAM / 80 GB NVMe | ~€7.00 |
| **ARM64 (AArch64)** | Hetzner Cloud CAX21 | 4 vCPUs (Ampere Altra ARM64) | 8 GB RAM / 80 GB NVMe | ~€6.00 |
| **Cloud Alternative** | AWS Graviton (t4g.small / c7g) | 2 vCPUs (Graviton3/4) | 4-8 GB RAM / EBS gp3 | ~$15.00 |

* **ARM64 Efficiency Advantage:** ARM instances (Ampere Altra / Graviton) deliver up to 35% better price-to-performance and lower thermals for Rust and Tokio async I/O.
* **Network & Supported OS:** 1 Gbit/s unmetered port, Dedicated Clean IPv4 + /64 IPv6. First-class native support for **AlmaLinux 8 / 9**, **Rocky Linux 8 / 9**, **Ubuntu 22.04 / 24.04 LTS**, and **Debian 12** (both ARM64 & x86_64).

### 1.2 Memory Allocation Budget (Native Bare-Metal vs Docker)
| Component | Native Idle RAM | Peak Concurrency (5,000 users) |
| :--- | :--- | :--- |
| **Stalwart Mail Engine (Rust Binary)** | ~35 MB | ~280 MB |
| **PostgreSQL 16 (Native)** | ~45 MB | ~350 MB |
| **Redis 7 (Native In-Memory)** | ~15 MB | ~80 MB |
| **Caddy 2 Reverse Proxy (Native Binary)** | ~20 MB | ~60 MB |
| **React Webmail SPA** | 0 MB (Served statically by Caddy) | 0 MB |
| **OS & Kernel Page Cache** | ~160 MB | Remaining RAM for disk cache |
| **Total Stack Footprint** | **~280 MB (Runs comfortably on 1GB VPS!)** | **~ 1.2 GB** |

---

## 2. Native Bare-Metal Systemd Architecture (Zero Docker)

AffinMail runs as isolated, native Linux services managed directly by `systemd`. This eliminates Docker bridge networking latency, removes container daemon overhead, and avoids kernel cgroup or podman-docker conflicts on AlmaLinux/Rocky Linux.

### 2.1 Systemd Services Blueprint

#### 1. Stalwart Mail Engine Service: `/etc/systemd/system/stalwart-mail.service`
```ini
[Unit]
Description=AffinMail Stalwart Mail Engine (Rust Native Core)
Documentation=https://github.com/hostaffin/affinmail
After=network.target network-online.target postgresql.service redis.service redis-server.service
Wants=network-online.target postgresql.service
PartOf=affinmail.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/affinmail/deploy
EnvironmentFile=-/opt/affinmail/deploy/.env
ExecStart=/usr/local/bin/stalwart-mail --config /opt/affinmail/deploy/stalwart.toml
Restart=always
RestartSec=3s
LimitNOFILE=65535
LimitNPROC=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target affinmail.target
```

#### 2. Caddy Web Server & Reverse Proxy: `/etc/systemd/system/affinmail-caddy.service`
```ini
[Unit]
Description=AffinMail Caddy Web Server & Reverse Proxy
Documentation=https://github.com/hostaffin/affinmail
After=network.target network-online.target stalwart-mail.service
Wants=network-online.target
PartOf=affinmail.target

[Service]
Type=notify
User=root
WorkingDirectory=/opt/affinmail/deploy
EnvironmentFile=-/opt/affinmail/deploy/.env
ExecStart=/usr/local/bin/caddy run --environ --config /opt/affinmail/deploy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /opt/affinmail/deploy/Caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
Restart=always
RestartSec=3s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target affinmail.target
```

#### 3. Complete Stack Target: `/etc/systemd/system/affinmail.target`
```ini
[Unit]
Description=AffinMail Complete Email Stack Target
Documentation=https://github.com/hostaffin/affinmail
Wants=postgresql.service stalwart-mail.service affinmail-caddy.service
After=postgresql.service stalwart-mail.service affinmail-caddy.service

[Install]
WantedBy=multi-user.target
```

---

## 3. Dual-Port Network & Reverse Proxy Architecture

AffinMail uses Caddy 2 as a native edge reverse proxy with dual-port segregation:
- **Port 2087:** WHM-Equivalent Cluster Admin Panel and Admin REST API.
- **Port 2083 / 443:** Client Webmail SPA, RFC 8620 JMAP daemon, and real-time WebSockets.

### 3.1 Network Port Allocation Matrix

| Port | Protocol | Purpose | Access Control |
| :--- | :--- | :--- | :--- |
| **2087/tcp** | HTTPS / HTTP/3 | WHM Cluster Admin Panel & REST API | Public (Password / 2FA / Hostaffin SSO) |
| **2083/tcp** | HTTPS / HTTP/3 | Client Webmail & JMAP / WebSockets | Public (Client Authentication) |
| **443/tcp** | HTTPS / HTTP/3 | Client Webmail & JMAP fallback | Public (Client Authentication) |
| **80/tcp** | HTTP | ACME HTTP-01 Challenges & HTTPS redirect | Public |
| **25/tcp** | SMTP (Plain / STARTTLS) | Inbound Mail Receiving & Direct Egress | Public MX |
| **465/tcp** | SMTPS (Implicit TLS) | Secure Mail Client Submission | Authenticated Users |
| **587/tcp** | Submission (STARTTLS) | Modern Mail Client Submission | Authenticated Users |
| **993/tcp** | IMAPS (Implicit TLS) | IMAP4rev2 Mailbox Synchronization | Authenticated Users |
| **4190/tcp**| ManageSieve | Sieve Script Remote Management | Authenticated Users |
| **5432/tcp**| PostgreSQL | Database Engine | **Loopback (127.0.0.1) Only** |
| **6379/tcp**| Redis | Cache & Rate Limiting | **Loopback (127.0.0.1) Only** |
| **8080/tcp**| HTTP | Stalwart Internal HTTP listener | **Loopback (127.0.0.1) Only** |

---

## 4. Automated Backup & Disaster Recovery Playbook

### 4.1 Native Daily Backup Script
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/affinmail/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# 1. Native PostgreSQL Dump
echo "[Backup] Dumping PostgreSQL database..."
sudo -u postgres pg_dump affinmail | gzip > "${BACKUP_DIR}/affinmail_db_${TIMESTAMP}.sql.gz"

# 2. Configuration Snapshot
echo "[Backup] Archiving configurations..."
tar -czf "${BACKUP_DIR}/affinmail_config_${TIMESTAMP}.tar.gz" -C /opt/affinmail deploy/.env deploy/stalwart.toml deploy/Caddyfile

# 3. Retention Cleanup (Keep last 14 days)
find "$BACKUP_DIR" -type f -name "affinmail_*.gz" -mtime +14 -delete
echo "[Backup] Snapshot complete: ${TIMESTAMP}"
```

### 4.2 Disaster Restoration Runbook
```bash
# 1. Stop mail services
affinmail stop

# 2. Restore PostgreSQL dump
gunzip < /opt/affinmail/backups/affinmail_db_20261123_000000.sql.gz | sudo -u postgres psql -d affinmail

# 3. Restart all services
affinmail start
```
