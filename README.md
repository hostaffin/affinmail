# AffinMail

> *"Optimized Workspace of Efficient Business."*
> High-Performance, Privacy-Centric Sovereign Business Email Platform Powered by Rust Stalwart.

A modern, high-performance, privacy-first business email hosting platform with **Zero Docker Dependency** running directly on bare-metal Linux:
1. **Rust Core Engine (Stalwart):** Native compiled binary, sub-100MB idle memory, memory-safe, ultra-fast JMAP/IMAP/SMTP/CalDAV/CardDAV server.
2. **Zero Docker Dependency (100% Native Systemd):** Direct native execution without container overhead, cgroup conflicts, or podman friction. Managed via native `systemd` units.
3. **Dual-CPU Native Architecture:** 100% native execution on both **ARM64** (Ampere Altra, AWS Graviton, Apple Silicon, Oracle ARM) and **x86_64** (Intel Xeon / AMD EPYC).
4. **Dual-Panel & Dual-Port Architecture:**
   - **Port 2087 (Admin Panel):** Dedicated cluster admin console (domains, quotas, multi-IP routing, storage management) — **100% automatable via REST API**.
   - **Port 2083 / 443 (User Panel):** Client webmail portal (JMAP, WebSockets, keyboard shortcuts) — **fully automatable via MCP (Model Context Protocol)**.
5. **Universal Linux Support:** First-class support for **AlmaLinux 8 / 9**, **Rocky Linux 8 / 9**, **RHEL**, **Ubuntu 22.04 / 24.04 LTS**, and **Debian 12**.
6. **Pluggable Dynamic Storage Engine:** Hot-swappable blob and attachment storage supporting **Local NVMe SSD**, **S3-Compatible Object Storage** (AWS, Cloudflare R2, MinIO, Wasabi), and **SFTP / Remote Storage Box** (Hetzner Storage Box).
7. **PostgreSQL 16 & Redis 7:** ACID persistence, GIN full-text search, and Leaky-Bucket rate limiting running natively on localhost.
8. **Gmail-Class Webmail SPA:** Built with React 19, DaisyUI 5, and Tailwind CSS v4 featuring strict Light & Dark enterprise themes, TipTap docked compose, and global keyboard shortcuts.
9. **Dual-Path SmartHost Deliverability:** Clean Port 25 outbound delivery for corporate communications and dynamic relay routing (Amazon SES, SendGrid, Mailgun) for bulk mail.
10. **Multi-IP & Dedicated IP Pool Architecture:** Granular outbound IP routing per domain (rotational shared pools for entry plans, dedicated outbound IPv4 for VIP clients) with automated progressive IP warm-up schedules and 24/7 RBL monitoring.
11. **Hostaffin Billing Automation:** 20 standard WHMCS lifecycle methods, 1-click passwordless SSO, and interactive copyable DNS records widget.

---

## ⚡ Quick Start: 1-Line Universal Installer

Run this single command as `root` on a fresh AlmaLinux, Rocky Linux, RHEL, Ubuntu, or Debian server:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/hostaffin/affinmail/master/install.sh 2>/dev/null || wget -qO- https://raw.githubusercontent.com/hostaffin/affinmail/master/install.sh)
```

The installer will:
- Auto-detect your CPU architecture (`x86_64` or `ARM64`)
- Auto-detect and safeguard your active SSH port in the firewall
- Auto-create a 2GB swap space if RAM is low to prevent OOM
- Install native PostgreSQL, Redis, Caddy 2, and Stalwart Mail binaries
- Initialize database schemas and configure native systemd services
- Output your Admin Panel (`:2087`) and User Panel (`:2083`) URLs

---

## 🛠️ Unified Terminal Management CLI

AffinMail provides a master command-line utility linked at `/usr/local/bin/affinmail`:

```bash
affinmail status          # Check systemd services and listening ports
affinmail restart         # Restart Stalwart, Caddy, PostgreSQL, and Redis
affinmail fix             # Emergency diagnostic and auto-repair tool
affinmail logs stalwart   # Live stream mail server logs
affinmail logs caddy      # Live stream web server / proxy logs
affinmail logs install    # View real-time installation output log
affinmail backup          # Instant gzipped PostgreSQL dump to /opt/affinmail/backups/
affinmail update          # Zero-downtime rolling update & schema migrations
affinmail info            # Display hostname, outbound IP, and storage configuration
affinmail uninstall       # Cleanly remove services (--purge-all for complete wipe)
```

---

## Complete Project Documentation Suite

All architectural blueprints, protocol specifications, database schemas, and integration guides are organized in the [`docs/`](file:///d:/AffinMail/docs/) directory:

| Document | Description |
| :--- | :--- |
| **[01-PRD.md](file:///d:/AffinMail/docs/01-PRD.md)** | Unified Product Requirements Document, business logic, functional & non-functional requirements, and personas. |
| **[02-TECHNICAL-ARCHITECTURE.md](file:///d:/AffinMail/docs/02-TECHNICAL-ARCHITECTURE.md)** | 7-Layer architectural blueprint, component responsibilities, network ingress, and data flow diagrams. |
| **[03-DATABASE-STORAGE-SCHEMA.md](file:///d:/AffinMail/docs/03-DATABASE-STORAGE-SCHEMA.md)** | Complete PostgreSQL 16 DDL schema, GIN indexes, Redis key structures, and Blob Storage specifications. |
| **[04-API-SPECIFICATIONS.md](file:///d:/AffinMail/docs/04-API-SPECIFICATIONS.md)** | RFC 8620/8621 JMAP specifications, Hostaffin Admin REST API endpoints, and WebSocket push notifications. |
| **[05-UI-UX-DESIGN-SYSTEM.md](file:///d:/AffinMail/docs/05-UI-UX-DESIGN-SYSTEM.md)** | Strict Light & Dark token specifications, Tailwind v4 + DaisyUI 5 setup, TipTap editor, and keyboard engine. |
| **[BRANDING-GUIDELINES.md](file:///d:/AffinMail/docs/BRANDING-GUIDELINES.md)** | Official brand identity, Sovereign Wing logomark anatomy, color tokens, typography, and asset specifications. |
| **[06-SECURITY-DELIVERABILITY.md](file:///d:/AffinMail/docs/06-SECURITY-DELIVERABILITY.md)** | 10/10 Deliverability guide (SPF, DKIM, DMARC, ARC), SmartHost matrix, Spamhaus DNSBL, and Redis Leaky-Bucket limiter. |
| **[07-HOSTAFFIN-INTEGRATION.md](file:///d:/AffinMail/docs/07-HOSTAFFIN-INTEGRATION.md)** | Complete specification of the 20 WHMCS lifecycle methods, 1-click SSO flow, and Client Area DNS widget. |
| **[08-DEVOPS-DEPLOYMENT.md](file:///d:/AffinMail/docs/08-DEVOPS-DEPLOYMENT.md)** | Bare-metal native systemd deployment, single-VPS sizing guide, Caddy 2 reverse proxy, and backup & recovery automation. |
| **[09-TESTING-QA-STRATEGY.md](file:///d:/AffinMail/docs/09-TESTING-QA-STRATEGY.md)** | Comprehensive QA strategy covering Vitest, Playwright E2E, PHPUnit driver tests, and deliverability audits. |
| **[10-IMPLEMENTATION-ROADMAP.md](file:///d:/AffinMail/docs/10-IMPLEMENTATION-ROADMAP.md)** | Directory tree structure and phased step-by-step checklist for building the platform end-to-end. |
| **[11-AI-AGENT-API-AUTOMATION-PLAN.md](file:///d:/AffinMail/docs/11-AI-AGENT-API-AUTOMATION-PLAN.md)** | Autonomous AI Agent Admin REST API automation plan, function schemas, and self-healing workflows. |

---

## 7-Layer Architecture Overview

```mermaid
flowchart TD
    subgraph L1["Layer 1: Network Ingress & Edge Proxy"]
        DNS["External DNS (MX, SPF, DKIM, DMARC)"]
        Caddy["Native Caddy 2 Binary (Auto TLS / HTTP/3)"]
        Firewall["Firewalld / UFW (Ports: 25, 465, 587, 993, 2083, 2087, 443)"]
    end

    subgraph L2["Layer 2: Core Mail & Security Engine (Native Rust Stalwart)"]
        SMTP_In["Inbound SMTP (Port 25 + STARTTLS)"]
        SMTP_Sub["Submission Daemon (Ports 465 / 587)"]
        IMAP_Daemon["IMAP4rev2 / POP3 Daemons (Port 993)"]
        CalCard["CalDAV & CardDAV Collaboration Daemons"]
        SpamDefense["Spam Engine: Spamhaus DNSBL + Greylisting + Bayes AI"]
        SecEngine["Security Engine: SPF + DKIM + DMARC + ARC"]
        SieveEngine["Sieve Filter & Vacation Auto-Reply Engine"]
    end

    subgraph L3["Layer 3: Outbound Delivery & SmartHost Relay Layer"]
        Router["Multi-IP Routing Engine (Dedicated vs Shared Outbound)"]
        RateLimiter["Redis Leaky-Bucket Rate Limiter (Per-mailbox limit)"]
        DirectOut["Direct Outbound Delivery (Port 25 + TLS 1.3)"]
        RelayOut["SmartHost Relay (Amazon SES / SendGrid / Custom Relay)"]
    end

    subgraph L4["Layer 4: Enterprise Persistence & Storage Tier"]
        PG["Native PostgreSQL 16 (Accounts, Sieve, GIN Full-Text Index)"]
        Redis["Native Redis 7 (Rate Limits, Transient Sessions, Connection Pools)"]
        BlobStore["NVMe SSD / S3 / Hetzner Storage Box (Raw .eml & Attachments)"]
    end

    subgraph L5["Layer 5: JMAP & Management API Tier"]
        JMAP["JMAP Server (RFC 8620 Core / RFC 8621 Mail JSON over HTTP)"]
        WS["WebSocket Gateway (Real-Time Inbound Event Streaming)"]
        AdminREST["Hostaffin Admin REST API (Domains, Mailboxes, Quotas, SSO)"]
    end

    subgraph L6["Layer 6: AffinMail Webmail Client (React + DaisyUI)"]
        ReactApp["React 19 SPA (Vite Pre-Compiled Bundle)"]
        DaisyUI["DaisyUI 5 + Tailwind CSS v4 (Strict Light & Dark Themes)"]
        TipTap["TipTap WYSIWYG Editor (Docked Compose, Image Paste, Drag & Drop)"]
        QueryCache["TanStack Query (Optimistic UI & Cache Management)"]
    end

    subgraph L7["Layer 7: Hostaffin Billing Platform Integration"]
        Driver["AffinMail Server Module (20 WHMCS Standard Lifecycle Methods)"]
        SSOEngine["1-Click SSO JWT Token Handshake"]
        DNSWidget["Client Area Interactive DNS Copy Widget"]
    end

    %% Wiring
    DNS --> Firewall --> Caddy
    Firewall --> SMTP_In & SMTP_Sub & IMAP_Daemon
    Caddy -->|/jmap, /api, /ws| L5
    Caddy -->|User Panel:2083 & Admin Panel:2087| L6

    SMTP_In --> SpamDefense --> SecEngine --> SieveEngine --> L4
    SMTP_Sub --> RateLimiter --> Router
    Router -->|Corporate Mail| DirectOut
    Router -->|Bulk / Newsletter| RelayOut

    L2 <--> L4
    L5 <--> L4
    L6 <-->|JMAP JSON & WebSockets| L5
    L7 -->|REST API Provisioning| AdminREST
```

---

## Hardware Sizing & Memory Benchmark

| Architecture | Recommended Sizing | Memory Footprint (Zero Docker) | Monthly Cost |
| :--- | :--- | :--- | :--- |
| **ARM64 VPS** | 2-4 vCPUs (Ampere Altra), 4-8 GB RAM | **~280 MB RAM total idle** | ~€4 - €6 / mo |
| **x86_64 VPS** | 2-4 vCPUs (AMD EPYC / Intel), 2-4 GB RAM | **~290 MB RAM total idle** | ~€5 - €7 / mo |

- **PostgreSQL 16 native:** ~45 MB RAM
- **Redis 7 native:** ~15 MB RAM
- **Stalwart Mail Engine native binary:** ~35 MB RAM
- **Caddy 2 native binary:** ~20 MB RAM
- **Total stack:** Runs comfortably on even a 1GB/2GB VPS with zero OOM issues!

---

## License
Proprietary & Confidential - Built for AffinMail / Hostaffin Ecosystem.
