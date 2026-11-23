# AffinMail: DevOps, Infrastructure & Deployment Playbook

---

## 1. Infrastructure Architecture & Sizing

### 1.1 Multi-Architecture Hardware Blueprint (x86_64 & ARM64)
AffinMail is engineered to run with 100% feature parity and native optimization across both CPU architectures:

| Architecture | Recommended VPS / Instance | CPU Specification | RAM / NVMe | Monthly Est. |
| :--- | :--- | :--- | :--- | :--- |
| **x86_64 (AMD/Intel)** | Hetzner Cloud CPX21 | 3 vCPUs (AMD EPYC) | 4 GB RAM / 80 GB NVMe | ~€7.00 |
| **ARM64 (AArch64)** | Hetzner Cloud CAX21 | 4 vCPUs (Ampere Altra ARM64) | 8 GB RAM / 80 GB NVMe | ~€6.00 |
| **Cloud Alternative** | AWS Graviton (t4g.small / c7g) | 2 vCPUs (Graviton3/4) | 4-8 GB RAM / EBS gp3 | ~$15.00 |

* **ARM64 Efficiency Advantage:** ARM instances (Ampere Altra / Graviton) deliver up to 35% better price-to-performance and lower thermals for Rust and Tokio async I/O.
* **Network & OS:** 1 Gbit/s unmetered port, Dedicated Clean IPv4 + /64 IPv6, Ubuntu 24.04 LTS or Debian 12 (both offer native ARM64 & x86_64 kernels).

### 1.2 Memory Allocation Budget
| Component | Idle RAM | Peak Concurrency RAM (5,000 users) |
| :--- | :--- | :--- |
| **Stalwart Mail Server (Rust)** | ~120 MB | ~450 MB |
| **PostgreSQL 16** | ~180 MB | ~600 MB |
| **Redis 7 (In-Memory)** | ~35 MB | ~120 MB |
| **Caddy 2 Reverse Proxy** | ~25 MB | ~80 MB |
| **React Webmail SPA** | 0 MB (Served statically by Caddy) | 0 MB |
| **OS & Kernel Page Cache** | ~350 MB | Remaining RAM for disk cache |
| **Total System RAM** | **< 800 MB** | **~ 2.5 GB (Optimal on 4GB or 8GB node)** |

---

## 2. Multi-Arch Production Docker Compose Stack

File: `deploy/docker-compose.yml`

*All images natively support both `linux/amd64` and `linux/arm64`.*

```yaml
version: '3.8'

services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp" # HTTP/3 QUIC
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ../webmail/dist:/var/www/affinmail-web/dist:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - affinmail-net
    depends_on:
      - stalwart

  stalwart:
    image: stalwartlabs/mail-server:latest
    restart: unless-stopped
    ports:
      - "25:25"       # Inbound SMTP
      - "465:465"     # Implicit TLS SMTP Submission
      - "587:587"     # STARTTLS SMTP Submission
      - "993:993"     # IMAP over TLS
      - "4190:4190"   # ManageSieve
    environment:
      - STALWART_DB_HOST=postgres
      - STALWART_DB_PORT=5432
      - STALWART_DB_NAME=affinmail
      - STALWART_DB_USER=affinmail_user
      - STALWART_DB_PASSWORD=${POSTGRES_PASSWORD}
      - STALWART_REDIS_URL=redis://redis:6379
      # Dynamic Pluggable Storage Backend Selection: fs | s3 | sftp
      - STORAGE_BLOB_TYPE=${STORAGE_BLOB_TYPE:-fs}
      - S3_BUCKET=${S3_BUCKET:-}
      - S3_ENDPOINT=${S3_ENDPOINT:-}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
      - S3_SECRET_KEY=${S3_SECRET_KEY:-}
      - SFTP_HOST=${SFTP_HOST:-}
      - SFTP_USER=${SFTP_USER:-}
      - SFTP_PORT=${SFTP_PORT:-22}
    volumes:
      - ./stalwart.toml:/opt/stalwart/etc/config.toml
      # Local or SSHFS mounted storage for blobs
      - ${STORAGE_LOCAL_PATH:-stalwart_blobs}:/var/lib/stalwart/blobs
    networks:
      - affinmail-net
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: affinmail
      POSTGRES_USER: affinmail_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ../sql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - affinmail-net

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redis_data:/data
    networks:
      - affinmail-net

networks:
  affinmail-net:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
  stalwart_blobs:
  pg_data:
  redis_data:
```

### 2.1 Multi-IP Host Interface & Egress Configuration
For the mail server to bind to multiple distinct public IP addresses for dedicated domain egress:

1. **Host Linux Network Setup (Netplan / Interface Aliases):**
   ```yaml
   # /etc/netplan/50-cloud-init.yaml
   network:
     version: 2
     ethernets:
       eth0:
         addresses:
           - 195.201.10.101/32 # Primary Shared IP
           - 195.201.10.102/32 # Dedicated IP #1 (Client A)
           - 195.201.10.103/32 # Dedicated IP #2 (Client B)
           - 2a01:4f8:c011:100::1/64
   ```
2. **Stalwart Outbound Interface Binding:**
   In `stalwart.toml`, the outbound delivery gateway binds each sender domain to its designated IP:
   ```toml
   # Per-domain outbound IP binding rule
   [session.outbound.route]
   bind = [
     { if = "env.from.domain == 'apexlogistics.com'", then = "195.201.10.102" },
     { if = "env.from.domain == 'trendmart.com'", then = "195.201.10.103" },
     { else = "195.201.10.101" } # Default Shared IP Pool
   ]
   ```
3. **Container Network Mode:**
   For multi-IP outbound interface binding, deploy Stalwart with `network_mode: "host"` or assign an IP pool bridge, giving Stalwart direct visibility over all host IPs.

---

## 3. Production Caddyfile Configuration

File: `deploy/Caddyfile`

```caddyfile
mail.hostaffin.com {
    # 1. Webmail Frontend (React + DaisyUI Static Build)
    root * /var/www/affinmail-web/dist
    file_server
    try_files {path} /index.html

    # 2. JMAP Protocol Endpoint
    handle /jmap* {
        reverse_proxy stalwart:8080 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }

    # 3. Real-Time WebSockets
    handle /ws* {
        reverse_proxy stalwart:8080 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
            header_up Upgrade {http.upgrade}
            header_up Connection "Upgrade"
        }
    }

    # 4. Hostaffin Admin & Management REST API
    handle /api/* {
        reverse_proxy stalwart:8080 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
        }
    }

    # Security Headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://mail.hostaffin.com https://mail.hostaffin.com;"
    }
}
```

---

## 4. Backup & Disaster Recovery Strategy

### Automated Daily Snapshot Script
* **PostgreSQL Dump:** `pg_dump -U affinmail_user affinmail | gzip > /backups/pg_$(date +%F).sql.gz`
* **Blob Store Sync:** `rsync -avz /var/lib/stalwart/blobs/ remote-backup-box:/backups/blobs/`
* **Retention Policy:** 7 daily snapshots, 4 weekly snapshots, 12 monthly archives.
