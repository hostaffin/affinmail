# AffinMail

> *"Enterprise Email Without Bloat: Ultra-fast, Privacy-Centric, Gmail-Class Simplicity."*

A modern, high-performance, privacy-first business email hosting platform combining:
1. **Rust Core Engine (Stalwart):** Sub-150MB idle memory, memory-safe, ultra-fast JMAP/IMAP/SMTP/CalDAV/CardDAV server.
2. **PostgreSQL 16 & Redis 7:** ACID persistence, GIN full-text search, and Leaky-Bucket rate limiting.
3. **Gmail-Class Webmail SPA:** Built with React 19, DaisyUI 5, and Tailwind CSS v4 featuring strict Light & Dark enterprise themes, TipTap docked compose, and global keyboard shortcuts.
4. **Dual-Path SmartHost Deliverability:** Clean Port 25 outbound delivery for corporate communications and dynamic relay routing (Amazon SES, SendGrid, Mailgun) for bulk mail.
5. **Hostaffin Billing Automation:** 20 standard WHMCS lifecycle methods, 1-click passwordless SSO, and interactive copyable DNS records widget.

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
| **[06-SECURITY-DELIVERABILITY.md](file:///d:/AffinMail/docs/06-SECURITY-DELIVERABILITY.md)** | 10/10 Deliverability guide (SPF, DKIM, DMARC, ARC), SmartHost matrix, Spamhaus DNSBL, and Redis Leaky-Bucket limiter. |
| **[07-HOSTAFFIN-INTEGRATION.md](file:///d:/AffinMail/docs/07-HOSTAFFIN-INTEGRATION.md)** | Complete specification of the 20 WHMCS lifecycle methods, 1-click SSO flow, and Client Area DNS widget. |
| **[08-DEVOPS-DEPLOYMENT.md](file:///d:/AffinMail/docs/08-DEVOPS-DEPLOYMENT.md)** | Single-VPS sizing guide, Docker Compose stack, Caddy 2 reverse proxy, and backup & recovery automation. |
| **[09-TESTING-QA-STRATEGY.md](file:///d:/AffinMail/docs/09-TESTING-QA-STRATEGY.md)** | Comprehensive QA strategy covering Vitest, Playwright E2E, PHPUnit driver tests, and deliverability audits. |
| **[10-IMPLEMENTATION-ROADMAP.md](file:///d:/AffinMail/docs/10-IMPLEMENTATION-ROADMAP.md)** | Directory tree structure and phased step-by-step checklist for building the platform end-to-end. |

---

## 7-Layer Architecture Overview

```mermaid
flowchart TD
    subgraph L1["Layer 1: Network Ingress & Edge Proxy"]
        DNS["External DNS (MX, SPF, DKIM, DMARC)"]
        Caddy["Caddy 2 Reverse Proxy (Auto TLS / HTTP/3)"]
        Firewall["Firewall (Ports: 25, 465, 587, 993, 443)"]
    end

    subgraph L2["Layer 2: Core Mail & Security Engine (Rust Stalwart)"]
        SMTP_In["Inbound SMTP (Port 25 + STARTTLS)"]
        SMTP_Sub["Submission Daemon (Ports 465 / 587)"]
        IMAP_Daemon["IMAP4rev2 / POP3 Daemons (Port 993)"]
        CalCard["CalDAV & CardDAV Collaboration Daemons"]
        SpamDefense["Spam Engine: Spamhaus DNSBL + Greylisting + Bayes AI"]
        SecEngine["Security Engine: SPF + DKIM + DMARC + ARC"]
        SieveEngine["Sieve Filter & Vacation Auto-Reply Engine"]
    end

    subgraph L3["Layer 3: Outbound Delivery & SmartHost Relay Layer"]
        Router["SmartHost Routing Matrix (Domain & Header Rules)"]
        RateLimiter["Redis Leaky-Bucket Rate Limiter (Per-mailbox limit)"]
        DirectOut["Direct Outbound Delivery (Port 25 + TLS 1.3)"]
        RelayOut["SmartHost Relay (Amazon SES / SendGrid / Custom Relay)"]
    end

    subgraph L4["Layer 4: Enterprise Persistence & Storage Tier"]
        PG["PostgreSQL 16 (Accounts, Sieve, GIN Full-Text Index)"]
        Redis["Redis 7 (Rate Limits, Transient Sessions, Connection Pools)"]
        BlobStore["NVMe SSD / S3 / Hetzner Storage Box (Raw .eml & Attachments)"]
    end

    subgraph L5["Layer 5: JMAP & Management API Tier"]
        JMAP["JMAP Server (RFC 8620 Core / RFC 8621 Mail JSON over HTTP)"]
        WS["WebSocket Gateway (Real-Time Inbound Event Streaming)"]
        AdminREST["Hostaffin Admin REST API (Domains, Mailboxes, Quotas, SSO)"]
    end

    subgraph L6["Layer 6: AffinMail Webmail Client (React + DaisyUI)"]
        ReactApp["React 19 SPA (Vite / Next.js)"]
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
    Caddy -->|Webmail Route| L6

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

## Quick Reference: Hardware Requirements

* **Recommended VPS:** 2 vCPU, 4GB RAM, 80GB NVMe SSD (e.g. Hetzner CPX21 at ~€7/month).
* **Capacity:** 2,000–5,000 active business mailboxes with concurrent WebSocket connections.
* **Total Idle Stack Memory:** Under 800MB RAM total across all services.

---

## License
Proprietary & Confidential - Built for AffinMail / Hostaffin Ecosystem.
