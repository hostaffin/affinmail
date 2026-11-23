# AffinMail: Unified Product Requirements Document (PRD)

---

## 1. Document Overview
* **Document Version:** 1.0.0
* **Target Release:** v1.0.0-GA
* **Product Name:** **AffinMail**
* **Brand Motto:** *"Enterprise Email Without Bloat: Ultra-fast, Privacy-Centric, Gmail-Class Simplicity."*
* **Owner:** AffinMail Engineering & Product Architecture Team

---

## 2. Product Vision & Goals

### 2.1 The Problem
Traditional enterprise email hosting solutions suffer from severe drawbacks:
1. **Resource Bloat:** Legacy mail stacks (Postfix, Dovecot, ClamAV, SpamAssassin, Roundcube) require massive memory (2–4GB idle) and complex multi-process coordination.
2. **Outdated UI/UX:** Traditional webmail interfaces (Roundcube, Horde, Rainloop) feel sluggish, lack modern keyboard-first workflows, and fail to provide modern light/dark themes.
3. **Fragile Deliverability:** Shared server IPs frequently get blacklisted due to bad actors sending marketing or transactional spam over the same channel as corporate communications.
4. **Disjointed Billing & Provisioning:** Hosting providers struggle with rigid quota enforcement, manual DNS setup, and fragile WHMCS/Hostaffin integrations.

### 2.2 The AffinMail Solution
AffinMail re-engineers modern business email from the ground up:
* **Rust-Powered Engine (Stalwart):** High-throughput, memory-safe, unified JMAP/IMAP/SMTP/CalDAV/CardDAV server consuming under 150MB RAM.
* **Dual CPU Architecture Support:** First-class native binary and container support for both **x86_64** (Intel/AMD) and **ARM64 / aarch64** (AWS Graviton, Ampere Altra, Apple Silicon, Oracle ARM).
* **Pluggable Dynamic Storage Tier:** Hot-swappable blob and attachment backend supporting **Local NVMe SSD**, **S3-Compatible Object Storage** (AWS, Cloudflare R2, MinIO, Wasabi), and **SFTP / Remote Storage Box** (Hetzner Storage Box).
* **Modern Webmail (React 19, DaisyUI 5, Tailwind CSS v4):** Hyper-responsive SPA with strict dual-theme polish (Enterprise Light & Enterprise Dark), TipTap docked rich-text compose, and Gmail-standard hotkeys.
* **Dual-Path SmartHost Deliverability:** Isolated routing channels ensuring corporate correspondence leaves via clean dedicated IPs while marketing/bulk mail flows via trusted SMTP relays (Amazon SES, SendGrid, Mailgun).
* **Deep Hostaffin Automation:** Turnkey provisioning module with 20 WHMCS lifecycle methods, 1-click passwordless SSO, and automated DNS copy widgets.

---

## 3. User Personas & Core Use Cases

### Persona A: Small Business Owner (Marcus, CEO at Apex Logistics)
* **Goal:** Reliable `marcus@apexlogistics.com` business mailbox with zero deliverability issues.
* **Key Needs:** Fast search, clean interface, out-of-office vacation replies, seamless iPhone/Mac Mail CalDAV/CardDAV sync, and dark mode for late-night emailing.

### Persona B: E-Commerce Store Operator (Elena, Ops Lead at TrendMart)
* **Goal:** High-volume customer service mail alongside transactional order notices without domain reputation degradation.
* **Key Needs:** Dual-path routing, plan-driven attachment controls, conversation threading, and fast tag/label triage.

### Persona C: Hosting Reseller / Web Agency (Devin, Agency Founder)
* **Goal:** Sell branded email packages to 50+ clients via Hostaffin billing.
* **Key Needs:** Automated mailbox creation, hard quota limits (5GB, 10GB, 25GB), automated DKIM/SPF DNS guidance, and passwordless client area SSO.

---

## 4. Functional Requirements

### 4.1 Multi-Tenancy & Virtual Domains
* **FR-MT-01:** The system MUST support unlimited virtual domains on a single cluster.
* **FR-MT-02:** Each domain MUST have isolated DKIM cryptographic keys (2048-bit RSA or Ed25519).
* **FR-MT-03:** Support catch-all addresses, domain aliases, and fine-grained forwarding rules.

### 4.2 Mailbox & Quota Management
* **FR-MB-01:** Provision individual user accounts with RFC 5322 compliant email addresses.
* **FR-MB-02:** Enforce storage quotas defined in megabytes (e.g. 5,120 MB, 10,240 MB, 25,600 MB).
* **FR-MB-03:** Provide visual quota status bars in webmail and trigger automated warnings at 85% and 95% threshold.
* **FR-MB-04:** Reject incoming messages with RFC 5321 code `552 5.2.2 Mailbox full` when hard limit is breached.

### 4.3 Plan-Driven Attachment Guard
* **FR-ATT-01:** Maximum attachment size MUST be dynamically configurable per hosting plan (e.g. 15MB, 25MB, 50MB).
* **FR-ATT-02:** Client-side file validation MUST inspect exact byte size before starting upload to conserve client bandwidth.
* **FR-ATT-03:** Client MUST display immediate error toast if selected file(s) exceed the plan ceiling.
* **FR-ATT-04:** The server MUST enforce the limit at protocol level (JMAP upload and SMTP submission) rejecting oversize payloads with `552 5.3.4 Message size exceeds fixed limit`.

### 4.4 Deliverability & SmartHost Routing
* **FR-DEL-01:** Direct outbound delivery over Port 25 with mandatory TLS 1.3 for corporate business communications.
* **FR-DEL-02:** Rule-based routing to external SmartHost relays (SES, SendGrid, Mailgun) triggered by plan type, sender address, or message header tags.
* **FR-DEL-03:** Automatic failover handling when external relay credentials or direct IP ports encounter rate caps.

### 4.5 Rate Limiting & Abuse Defense
* **FR-SEC-01:** Leaky-bucket rate limiter per authenticated mailbox (e.g. 200 emails/hour).
* **FR-SEC-02:** Automated sender quarantine when anomaly thresholds or burst spikes are detected.
* **FR-SEC-03:** Inbound spam defense integrating Spamhaus DNSBL, automated greylisting, and Bayes AI filter scoring.

### 4.6 Productivity & Collaboration
* **FR-PRD-01:** CalDAV server for calendar events, invites (iCalendar RFC 5545), and recurring appointments.
* **FR-PRD-02:** CardDAV server for address book syncing (vCard RFC 6350).
* **FR-PRD-03:** Server-side Sieve filters (RFC 5228) and rich-text Vacation / Out-of-Office auto-replies.

### 4.7 Webmail User Experience (Gmail-Grade)
* **FR-UI-01:** Conversation threading grouped by RFC 5322 `Message-ID`, `In-Reply-To`, and `References`.
* **FR-UI-02:** Docked compose modal supporting minimize, maximize, image paste, and drag-and-drop attachments.
* **FR-UI-03:** Full keyboard shortcut navigation engine (`c`, `j`, `k`, `e`, `#`, `s`, `r`, `a`, `/`).
* **FR-UI-04:** Real-time updates via WebSocket event streaming without manual polling.
* **FR-UI-05:** Strict Light and Dark enterprise themes, respecting system preference with manual toggle.

### 4.8 Hostaffin Billing Integration
* **FR-BIL-01:** Complete server driver implementing 20 WHMCS standard lifecycle methods.
* **FR-BIL-02:** 1-Click passwordless SSO leveraging short-lived signed JWTs (120-second TTL).
* **FR-BIL-03:** Interactive client area widget displaying MX, SPF, DKIM, and DMARC records with 1-click copy buttons.

### 4.9 Multi-Architecture CPU Compatibility (x86_64 & ARM64)
* **FR-CPU-01:** All services (Stalwart, Caddy, PostgreSQL, Redis, and Webmail container) MUST support native execution on both `linux/amd64` (x86_64) and `linux/arm64` (ARMv8 / AArch64).
* **FR-CPU-02:** The deployment stack MUST run seamlessly on low-cost high-efficiency ARM instances (e.g. Hetzner CAX21 Ampere Altra, AWS Graviton3/4, Oracle Cloud Ampere A1) with parity to x86_64 (AMD EPYC / Intel Xeon).
* **FR-CPU-03:** Docker Compose and build images MUST be multi-platform manifest compliant.

### 4.10 Pluggable Dynamic Storage Backends (Local, S3 & SFTP)
* **FR-STR-01:** The system MUST decouple raw email payloads (.eml) and attachments from the database into an abstract Blob Store.
* **FR-STR-02:** The Blob Store backend MUST be hot-swappable or switchable via configuration between:
  1. **Local Filesystem:** Local NVMe SSD mount.
  2. **S3-Compatible Object Storage:** AWS S3, Cloudflare R2, MinIO, Wasabi, or Backblaze B2 via standard S3 API credentials.
  3. **SFTP / Remote Storage Box:** Hetzner Storage Box or remote SSH/SFTP storage server via SSHFS/FUSE or native driver integration.
* **FR-STR-03:** Switching storage backend MUST NOT require code modification—only environment variable or configuration toggle (`STORAGE_BLOB_TYPE=local|s3|sftp`).

---

## 5. Non-Functional Requirements (NFRs)

| Metric | Target Requirement |
| :--- | :--- |
| **CPU Architecture** | 100% native support for `x86_64` (AMD/Intel) and `ARM64` (Ampere/Graviton) |
| **Storage Flexibility** | Dynamic backend abstraction: Local NVMe, S3 API, and SFTP/SSHFS |
| **Idle Memory Footprint** | Core mail engine < 200 MB RAM |
| **API Response Time** | JMAP queries < 50ms (p95), < 100ms (p99) |
| **Concurrent Connections** | >= 5,000 active concurrent WebSocket/IMAP sessions on a 4GB VPS |
| **Webmail Initial Load** | < 1.2s first contentful paint over 4G mobile connections |
| **Security Standards** | Enforce TLS 1.3, strict HSTS, CSP headers, zero plaintext storage |
| **Availability / SLA** | 99.95% uptime architecture |

---

## 6. Success Metrics & KPIs
* **Deliverability Score:** 10/10 on Mail-Tester and Google Postmaster Tools.
* **System Efficiency:** 70%+ reduction in server memory footprint compared to legacy cPanel/Roundcube stacks.
* **Customer Ticket Reduction:** 80% decrease in "Email deliverability" and "Email client configuration" support inquiries through interactive DNS widgets and 1-click SSO.
