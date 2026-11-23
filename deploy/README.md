# AffinMail Deployment Guide

This directory contains the canonical systemd units and backup tooling for the
AffinMail bare-metal stack. Everything here is kept in sync with the live
installed units under `/etc/systemd/system/`.

## Canonical Stalwart Binary

- **Canonical binary:** `/usr/local/bin/stalwart`
- **Canonical config:** `/etc/stalwart/config.json`
- **Canonical unit:** `stalwart.service` (User=stalwart, Type=notify)

The older `/usr/local/bin/stalwart-mail` binary and its `/opt/affinmail/deploy/stalwart.toml`
config are stale duplicates. Do not use them. The live `stalwart.service` unit
is the authoritative reference; the repo copy in `deploy/systemd/stalwart.service`
is kept byte-identical to it.

## Web Server / Reverse Proxy

There is **no** `affinmail-caddy.service`. The AffinMail vhosts (port 443,
2083, 2087) are served by the existing FrankenPHP/Caddy service, configured in
`/etc/frankenphp/Caddyfile`. A standalone Caddy service would fight it for the
same ports. See the Caddyfile for the vhost blocks.

## Systemd Units

| File | Purpose |
| :--- | :--- |
| `stalwart.service` | Stalwart mail engine (canonical binary + config) |
| `affinmail-api.service` | AffinMail Admin REST API (PHP built-in server, 127.0.0.1:8090) |
| `affinmail.target` | Aggregated stack target (Wants/After: stalwart, api, postgresql, redis) |
| `affinmail-backup.service` | Oneshot backup job (runs `scripts/backup.sh`) |
| `affinmail-backup.timer` | Daily timer (OnCalendar=daily, Persistent=true) |

### Install / Update Units

```bash
# Copy units to the system
cp deploy/systemd/{stalwart.service,affinmail-api.service,affinmail.target,affinmail-backup.service,affinmail-backup.timer} /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable and start the stack target + backup timer
systemctl enable affinmail.target affinmail-backup.timer
systemctl start affinmail-backup.timer
systemctl start affinmail.target

# Verify
systemctl is-active stalwart affinmail-api
systemctl list-timers --all | grep affinmail
```

> **Note:** `affinmail-api.service` is already installed and active. If the repo
> copy differs from the installed unit, back up the installed unit to a
> `.bak-YYYYMMDD` sibling, copy the repo unit over, and run `daemon-reload`.
> Do **not** restart `stalwart` or `affinmail-api` unless the content actually
> changed — if you must change `stalwart.service`, restart only if safe and
> verify it returns to `active`.

## Backup Script (`scripts/backup.sh`)

- **Location:** `/var/www/affinmail/scripts/backup.sh` (executable)
- **Backup dir:** `/var/www/affinmail/backups`
- **Retention:** 14 days (files matching `affinmail-*` older than 14 days are deleted)

What it does:
1. `sudo -u postgres pg_dump affinmail | gzip > affinmail-<TIMESTAMP>.sql.gz`
2. `tar -czf affinmail-config-<TIMESTAMP>.tar.gz` of `/etc/stalwart/config.json` + the repo `deploy/` dir
3. Cleanup of files older than 14 days

Run manually:
```bash
/var/www/affinmail/scripts/backup.sh
```

## Backup / Retention Notes

- Backups are stored in `/var/www/affinmail/backups/` (world-readable, root-owned).
- The daily timer runs `affinmail-backup.service` at `OnCalendar=daily` with
  `Persistent=true` (catches up if the machine was off).
- To change retention, edit `find "$BACKUP_DIR" -type f -name 'affinmail-*' -mtime +14 -delete`
  in `scripts/backup.sh`.
- Backups are git-ignored (see `.gitignore`: `backups/`).