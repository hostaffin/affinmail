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
