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
| **Redis 6.2 (Native In-Memory)** | ~15 MB | ~80 MB |
| **Caddy 2 Reverse Proxy (Native Binary)** | ~20 MB | ~60 MB |
| **React Webmail SPA** | 0 MB (Served statically by Caddy) | 0 MB |
| **OS & Kernel Page Cache** | ~160 MB | Remaining RAM for disk cache |
| **Total Stack Footprint** | **~280 MB (Runs comfortably on 1GB VPS!)** | **~ 1.2 GB** |

---

## 2. Native Bare-Metal Systemd Architecture (Zero Docker)

AffinMail runs as isolated, native Linux services managed directly by `systemd`. This eliminates Docker bridge networking latency, removes container daemon overhead, and avoids kernel cgroup or podman-docker conflicts on AlmaLinux/Rocky Linux.

### 2.1 Systemd Services Blueprint

#### 1. Stalwart Mail Engine Service: `/etc/systemd/system/stalwart.service`
```ini
[Unit]
Description=Stalwart
Conflicts=postfix.service sendmail.service exim4.service
After=network-online.target

[Service]
Type=notify
LimitNOFILE=65536
KillMode=process
KillSignal=SIGINT
Restart=on-failure
RestartSec=5
EnvironmentFile=-/etc/stalwart/stalwart.env
ExecStart=/usr/local/bin/stalwart --config=/etc/stalwart/config.json
SyslogIdentifier=stalwart
User=stalwart
Group=stalwart
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

> **Note:** The canonical Stalwart binary is `/usr/local/bin/stalwart` running against `/etc/stalwart/config.json`. The older `/usr/local/bin/stalwart-mail` binary and its `/opt/affinmail/deploy/stalwart.toml` config are stale duplicates and must not be used. The live `stalwart.service` unit is the authoritative reference; the repo copy in `deploy/systemd/stalwart.service` is kept byte-identical to it.

#### 2. Web Server & Reverse Proxy: FrankenPHP/Caddy (NO affinmail-caddy.service)
> **There is deliberately no `affinmail-caddy.service`.** The AffinMail vhosts (port 443, 2083, 2087) are served by the existing FrankenPHP/Caddy service (`/etc/frankenphp/Caddyfile`). A standalone Caddy service would fight it for the same ports. See `deploy/README.md`.

#### 3. Complete Stack Target: `/etc/systemd/system/affinmail.target`
```ini
[Unit]
Description=AffinMail stack
Wants=stalwart.service affinmail-api.service postgresql.service redis.service
After=stalwart.service affinmail-api.service postgresql.service redis.service

[Install]
WantedBy=multi-user.target
```

---

## 3. Dual-Port Network & Reverse Proxy Architecture

AffinMail uses Caddy 2 as a native edge reverse proxy with dual-port segregation:
- **Port 2087:** Admin Control Panel (API-automatable cluster admin and management REST API).
- **Port 2083 / 443:** User Panel / Webmail SPA (MCP-automatable, RFC 8620 JMAP daemon, and real-time WebSockets).

### 3.1 Network Port Allocation Matrix

| Port | Protocol | Purpose | Access Control |
| :--- | :--- | :--- | :--- |
| **2087/tcp** | HTTPS / HTTP/3 | Cluster Admin Panel & REST API (API Automatable) | Public (Password / 2FA / Hostaffin SSO) |
| **2083/tcp** | HTTPS / HTTP/3 | User Panel Webmail & JMAP / WebSockets (MCP Automatable) | Public (Client Authentication) |
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

BACKUP_DIR="/var/www/affinmail/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# 1. Native PostgreSQL Dump
echo "[Backup] Dumping PostgreSQL database..."
sudo -u postgres pg_dump affinmail | gzip > "${BACKUP_DIR}/affinmail-${TIMESTAMP}.sql.gz"

# 2. Configuration Snapshot
echo "[Backup] Archiving configurations..."
tar -czf "${BACKUP_DIR}/affinmail-config-${TIMESTAMP}.tar.gz" \
  -C /etc/stalwart config.json \
  -C /var/www/affinmail deploy

# 3. Retention Cleanup (Keep last 14 days)
find "$BACKUP_DIR" -type f -name 'affinmail-*' -mtime +14 -delete
echo "[Backup] Snapshot complete: ${TIMESTAMP}"
```

### 4.2 Disaster Restoration Runbook
```bash
# 1. Stop mail services
affinmail stop

# 2. Restore PostgreSQL dump
gunzip < /var/www/affinmail/backups/affinmail-20261123-000000.sql.gz | sudo -u postgres psql -d affinmail

# 3. Restart all services
affinmail start
```
