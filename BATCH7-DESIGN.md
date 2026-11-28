# Post-migration Batch 4 — :2083 standalone domain panel (design, 2026-11-28)

Gap: :2083 served the webmail SPA; the domain panel lived inside the
webmail with no login of its own. Rabbi's model: :2083 is the per-domain
(cPanel-equivalent) panel, login with the provisioning email + password,
owner manages mailboxes/aliases and can create API keys.

Design:
- domain_owners (domain_id PK, email, bcrypt password_hash). Set by an
  admin via POST /api/v1/admin/domains/{id}/owner (batch-3 guard).
- POST /api/v1/domain/login {email, password} -> aff_dom_ session token
  (state.domain_sessions), scoped to exactly one domain.
- Domain API under /api/v1/domain/* (overview, mailboxes list/create,
  mailbox password, aliases list/create/delete, api-keys list/create/
  delete). Handlers resolve every object against the session's domain —
  cross-domain ids return 404.
- domain_api_keys: affkey_<64 hex>, stored as SHA-256 hash, shown once
  at creation; a key authenticates the same /api/v1/domain/* surface
  for its own domain only (key management itself needs a session).
- Guard (batch 3) extended: domain sessions/keys pass ONLY on
  /api/v1/domain/*; /api/v1/domain/login joins the public allowlist.
- :2083 serves a standalone static panel (webmail/domain-panel/) —
  the webmail SPA on 443 and the admin panel on 2087 are untouched.

## Completion (2026-11-28 night, master 2c6e9eb)
Implemented as designed. Live verification matrix: owner provisioned
via the admin endpoint; wrong owner password -> 401; login -> scoped
session; overview shows only the owner's domain; cross-domain mailbox
password change -> 404; creating a mailbox in another domain -> 403,
in the own domain -> 200; API key authenticates the domain surface
(200) but is rejected by admin routes (401) and by key management
(401); a domain session is rejected by admin routes (401). :2083 now
serves webmail/domain-panel/ (public title check passed); 443 webmail
and 2087 admin panel untouched. Demo fixture kept for Rabbi:
batch2.local owner gate@batch2.local (password given to him in chat).
The verification API key was revoked after the tests.
