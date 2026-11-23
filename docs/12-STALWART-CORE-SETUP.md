# 12 — Stalwart Core Setup (v1.2.0)

Status: **deployed and verified** on the AffinMail VPS, 2026-11-24.
Scope: mail core only (SMTP submission, IMAP/POP3, JMAP, local delivery, DKIM keys).
Nothing in this document enables outbound internet mail.

## 1. Stalwart 1.2 configuration model

Stalwart 1.2 splits configuration in two:

| Layer | Location | Contains |
| --- | --- | --- |
| Bootstrap config | `/etc/stalwart/config.json` | **Only** the DataStore definition |
| Everything else | inside that DataStore | listeners, domains, accounts, routes, TLS, DKIM, stores |

There is no longer a `stalwart.toml` with listeners, domains and accounts (the
legacy `deploy/stalwart.toml` in this repo is the pre-1.2 layout and is not used by
the running service). All objects are managed over the JMAP management API:

- Endpoint: `POST http://127.0.0.1:8080/jmap` (loopback only)
- Capability: `urn:stalwart:jmap`
- Methods: `x:<Object>/get|set|query|create|destroy`, standard RFC 8620 shapes
- `accountId`: the id from `GET /jmap/session` (system admin account is `b` after setup)
- Singletons (`x:Bootstrap`, `x:MtaOutboundStrategy`, `x:MtaStageRcpt`) use id `"singleton"`

When no `config.json` exists the server starts in **bootstrap mode** on port 8080
only, and accepts just `x:Bootstrap/get|set`. The Bootstrap `set` writes
`config.json` and provisions the first permanent administrator.

### Deployed DataStore (config.json)

PostgreSQL `affinmail` on `127.0.0.1:5432`, user `affinmail_user`, no TLS
(loopback), password stored as a `Value` secret in the file. The file is owned
`stalwart:stalwart`, mode `640`, and is a valid single JSON object.

`deploy/config.json` in this repo is the same template with
`authSecret: {"@type":"EnvironmentVariable","variableName":"STALWART_DB_PASSWORD"}`
so no real secret is committed. Copy it to `/etc/stalwart/config.json` for a
re-install, exporting `STALWART_DB_PASSWORD` in the unit environment.

### Other stores

| Store | Value |
| --- | --- |
| blobStore / searchStore | `{"@type":"Default"}` (PostgreSQL) |
| inMemoryStore | `{"@type":"Redis","url":"redis://127.0.0.1:6379"}` |
| directory | `{"@type":"Internal"}` |
| dnsServer | `{"@type":"Manual"}` |
| tracer | `Log` → `/var/log/stalwart/` |

`dnsServer: Manual` and `requestTlsCertificate: false` means Stalwart never talks to
public DNS or ACME. No `AcmeProvider` object exists.

## 2. Hostname and domain

- `defaultHostname`: `affinmail.hostaffin.com` (used in EHLO, SRV/autoconfig records,
  message IDs). It is **not** a published public mail host; no DNS was changed.
- `defaultDomain`: `affinmail.local` — the local test domain, created by bootstrap
  and enabled (`x:Domain/get` id `b`, `enable: true`, `allowRelaying: false`).

## 3. Listeners

Default listeners created by bootstrap, plus one added for 587:

| Listener | Port | Protocol | TLS |
| --- | --- | --- | --- |
| smtp | 25 | smtp | STARTTLS optional |
| submission | 587 | smtp | STARTTLS, **auth required** |
| submissions | 465 | smtp | implicit TLS |
| imaps | 993 | imap | implicit TLS |
| pop3s | 995 | pop3 | implicit TLS |
| sieve | 4190 | manageSieve | STARTTLS |
| http | 8080 | http | plain (management/JMAP) |
| https | 443 | http | **not bound** — frankenphp owns :443 on this host |

All required ports (25/465/587/993/4190/8080) are listening, verified with `ss -lntp`.

The :443 listener exists in the registry but fails to bind (`Address already in use`,
frankenphp). That is expected on this VPS and intentionally left alone — see
`docs/08-DEVOPS-DEPLOYMENT.md` for the reverse-proxy topology.

### TLS certificates

No `x:Certificate` object is configured and `/etc/stalwart/tls` does not exist.
Stalwart 1.2 generates an in-memory self-signed certificate (`CN=rcgen self signed
cert`) for the implicit-TLS listeners, so 465/993 handshake successfully with an
unverified client context. Because the brief's condition ("implicit-TLS listeners
fail for lack of a certificate") was **not** met, the manual
`/etc/stalwart/tls/cert.pem` + `key.pem` fallback was not needed and was not
created. Production deployments should assign a real certificate via
`x:Certificate/set` once a public hostname exists.

## 4. Accounts and authentication

Bootstrap provisioned a permanent administrator:

- `admin@affinmail.local`, roles `Admin`, internal directory, password stored as a
  Password credential in PostgreSQL. Credentials live in
  `/etc/stalwart/local-secrets.txt` (mode `600`, `root:stalwart`), labels
  `PROVISIONED_ADMIN` / `PROVISIONED_ADMIN_PASSWORD`.
- The pinned `STALWART_RECOVERY_ADMIN=admin:<pw>` in `/etc/stalwart/stalwart.env`
  is the bootstrap/recovery credential only. It is **rejected** once bootstrap has
  completed; login must use `admin@affinmail.local`.

Test accounts (both `@type: User`, `roles: User`, enabled, domain `affinmail.local`):

| Account | id | Purpose |
| --- | --- | --- |
| `alice@affinmail.local` | `c` | SMTP submit test sender |
| `bob@affinmail.local` | `d` | IMAP fetch test recipient |

Both use the shared `TEST_PASSWORD` from `/etc/stalwart/local-secrets.txt`. Passwords
are deliberately **not** in this document or in git.

### Deviation: directory backend

Accounts are Stalwart objects in the **Internal directory**, persisted in the same
PostgreSQL `affinmail` database as the rest of the app (Stalwart creates its own
`domains`, `accounts`/`a`–`s*` schema tables there). The `sql/001_initial_schema.sql`
`mailboxes` table is the **billing/layer mirror** used by the AffinMail application
(inbox rows, quota accounting), **not** the Stalwart 1.2 authentication source.
Stalwart 1.2 does not authenticate against an app-owned `mailboxes` table; changing
it does not change mail login. Provision mail accounts through `x:Account/set` and
mirror them into `mailboxes` from the app layer if billing rows are needed.

## 5. Local-only outbound (no internet mail)

Outbound to non-local domains is disabled at several layers. Verified by SMTP probe:

```
$ python3 (587 STARTTLS, AUTH alice, MAIL FROM alice@affinmail.local)
  250 2.1.0 OK
  RCPT TO <nobody@example.com>  -> 550 5.7.1 Relay not allowed.
  RCPT TO <bob@affinmail.local> -> 250 2.1.5 OK
$ (port 25, unauthenticated)
  RCPT TO <nobody@example.com>  -> 550 5.7.1 Relay not allowed.
```

What was set:

- `x:MtaStageRcpt/singleton.allowRelaying` = `{"else":"false"}` (default was
  `!is_empty(authenticated_as)`, i.e. any authenticated user could relay).
- `x:MtaOutboundStrategy/singleton.route` = `{"else":"'local'"}` with the local-domain
  branch kept — every recipient resolves to the local route, never `mx`.
- `x:MtaOutboundStrategy/singleton.schedule` = `{"else":"'local'"}` (default `remote`),
  so non-local mail is never queued for remote delivery.
- `x:MtaRoute` **`mx`** (the remote/MX delivery route) **destroyed**. Only `local` remains.
- `x:Domain` `affinmail.local` has `allowRelaying: false`.
- No `x:MtaRoute` of `@type: Relay` exists, so there is no relay host at all.
- `x:AcmeProvider` list empty; `x:DnsServer` list empty; domain
  `dnsManagement` and `certificateManagement` are both `Manual`.

Effect: mail to a non-local domain is rejected at RCPT time with `550 5.7.1 Relay not
allowed.` — rejected, not queued, not bounced to the internet. Re-enabling outbound
later means recreating an `Mx` route and restoring the `remote` schedule/`mx` routes;
do it deliberately, with DKIM DNS and MTA-STS published first.

## 6. DKIM

DKIM is `Automatic` on the domain (`x:DkimSignature` holds two keys):

| Selector | Algorithm |
| --- | --- |
| `v1-ed25519-20261123` | Ed25519-SHA256 |
| `v1-rsa-20261123` | RSA-SHA256 |

Public records were extracted from the domain `dnsZoneFile` and written to
`deploy/dkim-affinmail.local.txt`, headed
`LOCAL ONLY - DO NOT PUBLISH`. Signing happens on submission regardless; the
records only matter if the domain's DNS is ever published, which it is not.

## 7. Test evidence (2026-11-24, all loopback, local domain only)

| # | Test | Result |
| --- | --- | --- |
| a | `smtplib` SMTP AUTH LOGIN alice → bob via `127.0.0.1:587` (STARTTLS, unverified ctx), subject `AffinMail local test 001`, unique body token | **PASS** on 587 (port 25 fallback not needed); token `tok-5f33d42456ce` delivered |
| b | `imaplib.IMAP4_SSL` `127.0.0.1:993` (unverified ctx), login bob, `SELECT INBOX`, `SEARCH SUBJECT`, `FETCH RFC822`, body token check | **PASS** — 1 match, token present |
| c | `curl -u bob@affinmail.local:<TESTPW> http://127.0.0.1:8080/jmap/session` | **PASS** — `username: bob@affinmail.local`, account `d`, full capability list |
| c | unauthenticated `curl http://127.0.0.1:8080/jmap/session` | **PASS** — `username: ""`, `accounts: {}` (no authenticated session leaked) |

Reproduce with `/tmp/am_mail_test.py` (reads `TEST_PASSWORD` from
`/etc/stalwart/local-secrets.txt`; never prints it) and the `curl` commands above.

## 8. Operational notes

- Service: `systemctl status stalwart`, unit `stalwart.service`, binary
  `/usr/local/bin/stalwart --config=/etc/stalwart/config.json`, runs as `stalwart`.
- Logs: `journalctl -u stalwart`, plus `/var/log/stalwart/stalwart.log.YYYY-MM-DD`.
- Secrets file: `/etc/stalwart/local-secrets.txt` — `chmod 600`, `root:stalwart`.
  Contains admin and test passwords plus the pinned bootstrap credential.
- Backups taken before edits: `/etc/stalwart/stalwart.env.bak-20261124`.
- `/var/www/affinmail/deploy/config.json` is the secret-free install template.
- Setup automation: `/var/www/affinmail/scripts/stalwart_setup.py` (stdlib only;
  reads the admin password from `/etc/stalwart/local-secrets.txt` or `$AM_ADMIN_PW`
  and the DB password from `deploy/.env` or `$STALWART_DB_PASSWORD`).

### Known issues / deviations

1. `https` listener on :443 cannot bind (frankenphp). Not fixed by design.
2. No `x:Certificate` assigned; implicit-TLS listeners use Stalwart's generated
   self-signed certificate until a real one is uploaded.
3. `deploy/stalwart.toml` is stale 0.x-era config, kept for reference only; the
   running 1.2 server ignores it.
4. Test accounts `alice`/`bob` are for local verification; delete with
   `x:Account/set {"destroy":["c","d"]}` when no longer needed.
