# AffinMail Admin REST API

Single-file PHP 8.5 admin API for Hostaffin/AI-agent automation. No framework, no Composer.
`api/public/index.php` is router + implementation; `php -S` serves it.

## Run

Production (systemd unit `affinmail-api.service`, listens 127.0.0.1:8090):

```bash
bash api/setup-env.sh                      # writes api/.env, mode 600, prints no secrets
cp deploy/systemd/affinmail-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now affinmail-api
systemctl status affinmail-api
```

Manual:

```bash
php -S 127.0.0.1:8090 -t api/public api/public/index.php
```

Caddy routes `handle /api*` for the AffinMail hosts to `127.0.0.1:8090`; `/jmap*`, `/ws*`,
`/admin*` still go to Stalwart on `127.0.0.1:8080`.

## Config (`api/.env`)

| Key | Meaning |
| :-- | :-- |
| `AFFINMAIL_ADMIN_TOKEN` | Bearer token for all `/api/v1` routes |
| `VAULT_KEY` | 32-byte hex key for AES-256-GCM mailbox password vault |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | PostgreSQL connection |
| `STALWART_URL` `STALWART_ADMIN_USER` `STALWART_ADMIN_PASSWORD` | Stalwart JMAP admin endpoint |
| `REDIS_URL` `REDIS_PASSWORD` | Redis (rate limit, SSO tokens, accountId cache) |
| `STORAGE_LOCAL_PATH` | Blob storage path reported by `/storage` |
| `AUDIT_LOG` | JSONL audit trail |
| `BACKUP_DIR` | Destination for `pg_dump` archives |

## Auth

* `Authorization: Bearer <AFFINMAIL_ADMIN_TOKEN>` or `X-Server-API-Key: <AFFINMAIL_ADMIN_TOKEN>`
  (Hostaffin driver compatibility). Compared with `hash_equals`. Missing/wrong → `401`.
* Rate limit: Redis `ratelimit:api:<sha256 token>`, 120 requests / 60 s → `429`.
* Audit: every authenticated request appends
  `{ts, agent, method, path, status}` to `AUDIT_LOG`; `agent` comes from `X-Agent-ID` (default `unknown`).
* `GET /api/v1/health` is unauthenticated and not audited.

## Envelopes

Success: `{"status":"success","data":...}`. Error: `{"status":"error","error":"<msg>"}`.

## Endpoints

| Method | Path | Notes |
| :-- | :-- | :-- |
| GET | `/api/v1/health` | `{service, version, checks:{postgres,redis,stalwart}}` |
| POST | `/api/v1/domains` | `{domain, maxMailboxes, diskQuotaMb, maxAttachmentMb, hostaffinServiceId}` → 201, RSA-2048 DKIM keypair, Stalwart domain |
| GET | `/api/v1/domains` | list + `mailboxCount` |
| GET | `/api/v1/domains/{domain}` | single domain |
| GET | `/api/v1/domains/{domain}/dns` | MX/SPF/DKIM/DMARC records |
| DELETE | `/api/v1/domains/{domain}` | destroys Stalwart accounts + DKIM signatures + domain, then PG row |
| POST | `/api/v1/mailboxes` | `{email, password, displayName, quotaLimitMb, hourlyRateLimit, outboundRoute}`; auto-creates PG+Stalwart domain; Argon2id hash + AES-256-GCM vault; Stalwart failure rolls back |
| GET | `/api/v1/mailboxes?domain=` | list (optional filter) |
| GET | `/api/v1/mailboxes/{email}` | single mailbox |
| PATCH | `/api/v1/mailboxes/{email}/quota` | `{quotaLimitMb, hourlyRateLimit, outboundRoute}` |
| PUT | `/api/v1/mailboxes/{email}/status` | `{"status":"suspended"\|"active"}`; rotates Stalwart credential |
| DELETE | `/api/v1/mailboxes/{email}` | destroy Stalwart account + PG row |
| POST | `/api/v1/aliases` | `{source_address\|source, destination_address\|destination}` → Stalwart `aliases/<n>` |
| GET | `/api/v1/aliases` | list |
| DELETE | `/api/v1/aliases/{uuid}` | remove Stalwart alias + PG row |
| GET | `/api/v1/ip-pools`, `/api/v1/ippools` | list IP pools |
| POST | `/api/v1/ip-pools` | `{ip_address\|ipAddress, pool_type\|poolType, rdns_hostname\|rdnsHostname, max_allocations}` |
| POST | `/api/v1/ippools/assign` | `{domain, ip_address}` → sets `domains.assigned_ip_id` |
| GET | `/api/v1/storage` | `{storage_type, local_path, used_bytes, total_bytes, free_bytes}` |
| POST | `/api/v1/system/backup`, `/api/v1/backup` | `pg_dump \| gzip` into `BACKUP_DIR` → `{file, path, size_bytes}` |
| POST | `/api/v1/auth/sso-token` | `{email, ttlSeconds}` → `{ssoUrl, expiresAt}` |

`outboundRoute` accepts `direct`, `relay_ses`, `relay_sendgrid`, `relay_custom`.

## Notes

* Quotas are authoritative in PostgreSQL (`quota_limit_mb`); Stalwart's quota map is not touched.
* `PUT .../status` only works for mailboxes provisioned through this API (needs Stalwart account id + vault secret).
* `scripts/mock-backend.py` is a Windows-only test mock. Verified on this VPS:
  `grep -rn "mock-backend" /etc/systemd/system /etc/cron* /var/www/affinmail/scripts` → no matches
  (exit 1). No systemd unit, cron job, or service references it; the only references anywhere are the
  Windows test scripts `run-tests.ps1` / `start-windows-test.ps1`, and nothing on this VPS uses it.
