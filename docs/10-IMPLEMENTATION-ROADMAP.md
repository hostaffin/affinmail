# AffinMail: Implementation Roadmap & Execution Plan

---

## 1. Project Directory Structure

```
AffinMail/
├── docs/                               # Comprehensive Project Specifications
│   ├── 01-PRD.md                       # Unified Product Requirements Document
│   ├── 02-TECHNICAL-ARCHITECTURE.md    # 7-Layer Architecture Blueprint
│   ├── 03-DATABASE-STORAGE-SCHEMA.md   # PostgreSQL 16 DDL & Redis schema
│   ├── 04-API-SPECIFICATIONS.md        # JMAP, REST & WebSocket protocols
│   ├── 05-UI-UX-DESIGN-SYSTEM.md       # DaisyUI, Tailwind & Keyboard engine
│   ├── 06-SECURITY-DELIVERABILITY.md   # 10/10 Deliverability & Anti-spam
│   ├── 07-HOSTAFFIN-INTEGRATION.md     # 20 WHMCS Lifecycle methods & SSO
│   ├── 08-DEVOPS-DEPLOYMENT.md         # Caddy 2, Docker & Single-VPS guide
│   ├── 09-TESTING-QA-STRATEGY.md       # Vitest, Playwright, PHPUnit specs
│   └── 10-IMPLEMENTATION-ROADMAP.md    # This step-by-step roadmap
├── deploy/                             # Infrastructure as Code
│   ├── docker-compose.yml              # Caddy + Stalwart + PG16 + Redis7
│   ├── Caddyfile                       # Reverse proxy & Webmail static hosting
│   └── stalwart.toml                   # Core mail server configuration
├── sql/                                # Database Migration & Seed Scripts
│   ├── 001_initial_schema.sql          # Tables, types, indexes & constraints
│   └── 002_seed_demo_data.sql          # Test domains, mailboxes & threads
├── driver/                             # Hostaffin / WHMCS Server Module
│   └── AffinMail/
│       ├── AffinMail.php               # Core 20 lifecycle methods implementation
│       ├── templates/
│       │   ├── clientarea.tpl          # Interactive DNS copy widget & SSO button
│       │   └── adminservicestab.tpl    # Admin diagnostics & quota controls
│       └── tests/
│           └── AffinMailTest.php       # PHPUnit lifecycle test suite
├── webmail/                            # React 19 + DaisyUI 5 SPA
│   ├── src/
│   │   ├── components/                 # Sidebar, Toolbar, ThreadList, Compose
│   │   ├── hooks/                      # useKeyboardShortcuts, useJmap, useTheme
│   │   ├── utils/                      # attachmentValidator, formatters
│   │   └── App.tsx                     # Main layout & router
│   ├── tailwind.config.js              # Strict Light & Dark theme definitions
│   ├── package.json
│   └── vite.config.ts
├── tests/                              # Integration & E2E Suites
│   └── e2e/
│       └── webmail.spec.ts             # Playwright user journey tests
└── README.md                           # Master Project Readme & Quickstart
```

---

## 2. Phased Execution Roadmap

### Phase 1: Database & Core Infrastructure Configuration
- [ ] Initialize repository structure and environment configuration.
- [ ] Implement `sql/001_initial_schema.sql` (Domains, Mailboxes, Aliases, Sieve, Threads, Messages, Usage).
- [ ] Set up `deploy/docker-compose.yml`, `stalwart.toml`, and `Caddyfile`.
- [ ] Verify local database initialization and PostgreSQL GIN full-text index setup.

### Phase 2: Hostaffin Server Driver Module Implementation
- [ ] Implement `driver/AffinMail/AffinMail.php` with all 20 lifecycle methods:
  - Account provisioning (`createAccount`, `suspendAccount`, `unsuspendAccount`, `terminateAccount`).
  - Quota, password & package updates (`changePassword`, `changePackage`, `usageUpdate`).
  - Admin & Client custom actions, testing connection, and control panel SSO launcher.
- [ ] Build `templates/clientarea.tpl` with interactive copyable DNS records table (MX, SPF, DKIM, DMARC) and 1-Click SSO button.
- [ ] Author unit tests in `driver/AffinMail/tests/AffinMailTest.php`.

### Phase 3: Webmail Client Application (React 19 + DaisyUI 5)
- [ ] Scaffold Vite + React 19 + TypeScript frontend in `webmail/`.
- [ ] Configure Tailwind CSS v4 and DaisyUI 5 with strict `light` and `dark` palettes.
- [ ] Implement global layout: Header with Search, Navigation Sidebar with Quota indicator, Action Toolbar.
- [ ] Build conversation thread list with optimistic status updates and unread badges.
- [ ] Implement dockable compose window with TipTap WYSIWYG editor.
- [ ] Implement client-side Plan-Driven Attachment Guard checking byte limits before upload.
- [ ] Implement `useKeyboardShortcuts` engine (`c`, `j`, `k`, `e`, `#`, `s`, `r`, `a`, `/`).

### Phase 4: Deliverability, SmartHost & Security Pipeline
- [ ] Configure DKIM 2048-bit key generation and selector bindings.
- [ ] Configure SPF, strict DMARC (`p=quarantine`), and ARC headers.
- [ ] Implement SmartHost routing matrix (Direct clean IP vs Relay SES/SendGrid).
- [ ] Implement Redis Leaky-Bucket outbound rate limiter.
- [ ] Wire up Spamhaus DNSBL and greylisting rules.

### Phase 5: Testing, QA & Benchmarking
- [ ] Run Vitest unit tests for attachment validator and React components.
- [ ] Run PHPUnit tests for Hostaffin driver methods.
- [ ] Run Playwright E2E tests simulating user SSO login, reading mail, composing, and dark mode toggling.
- [ ] Audit deliverability scores via Mail-Tester (target: 10/10).
- [ ] Run load test simulating 5,000 concurrent sessions on 4GB VPS profile.

### Phase 6: Final Packaging & Production Playbook
- [ ] Create automated installation script for single-VPS deployment.
- [ ] Document backup, restore, and monitoring commands.
- [ ] Final security audit and production sign-off.
