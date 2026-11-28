# Post-migration Batch 3 — production panel auth (design, 2026-11-28)

Evidence (found during recon, worse than "prototype login"):
- admin_login accepted admin/root/admin@affinmail.local with ANY
  non-empty password.
- NO route checked authorization at all: GET /api/v1/stats,
  /api/v1/admin/logins and /api/v1/queue returned 200 with no token,
  including via the PUBLIC https://affinmail.hostaffin.com proxy path.

Design:
- PG table panel_admins (username UNIQUE, bcrypt password_hash, role,
  created_at, last_login_at). Seeded out-of-band; no in-code fallback:
  an empty table means panel login is closed (401), never open.
- admin_login verifies bcrypt against panel_admins and issues the same
  aff_adm_ session tokens as before (frontend shape unchanged).
- Authorization middleware on the whole API except an allowlist
  (/api/v1/health, /api/v1/auth/login, /api/v1/auth/sso-exchange,
  /jmap* — JMAP does its own per-request credential verification):
  a request passes with Bearer = static ADMIN_TOKEN (machine/driver
  access, unchanged) or Bearer = a live admin session token.
- POST /api/v1/admin/admins (create panel admin, protected) and
  POST /api/v1/auth/change-password (session's own password change).

## Completion (2026-11-28 night, master 13195b1)
Implemented as designed. Verification matrix (all live): no-token ->
401 on /stats + /queue (local AND via the public Cloudflare path);
ADMIN_TOKEN -> 200 (machine access unchanged); health + JMAP stay
public by design; login with an empty panel_admins table -> 401;
wrong password -> 401; seeded admin (bcrypt, python-generated $2b$
hash — doveadm emits $2y$ which the Rust bcrypt crate rejects, and its
pw subcommand is unreliable under the doveconf include error) ->
session issued, session token -> 200; change-password rotates and
the old password stops working. First admin seeded as username
`admin`; its generated password was handed to Rabbi in chat — he can
rotate it via POST /api/v1/auth/change-password or create more admins
via POST /api/v1/admin/admins.
Note: a root-owned stale build log in /tmp (batch3-build.log from the
worker era, sticky bit) silently swallowed one rebuild tonight —
build logs now use unique muse-owned names.
