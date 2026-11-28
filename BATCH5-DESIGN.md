# Post-migration Batch 2 — per-mailbox spam settings (design, 2026-11-28)

Gap: spam preferences were design-deferred in Batch 4. The only spam
surfaces are Stalwart-era stubs (/api/v1/security/spam canned payload,
in-memory quarantine). Rspamd has no settings.conf; Dovecot has no sieve,
so nothing files spam into Junk either.

Design:
- Storage: PG table mail_spam_prefs (email PK, enabled, reject_threshold,
  header_threshold, whitelist text[], blacklist text[], updated_at).
- API (client scope, mirrors existing client mailbox handlers):
  GET/PUT /api/v1/client/mailboxes/{id}/spam-prefs
- Enforcement: the backend regenerates /var/lib/rspamd/user-settings.ucl
  (one settings group per mailbox with non-default prefs: priority 10,
  matched by authenticated/rcpt user) and reloads Rspamd via
  sudo systemctl reload rspamd (sudoers /etc/sudoers.d/affinmail-rspamd).
  /etc/rspamd/local.d/settings.conf .include's the generated file.
- Delivery: global sieve_before files X-Spam: Yes into Junk (:create).
- Validation: thresholds 0..50 (null = server default), lists <= 100
  entries of <= 254 chars, UCL-escaped on render. enabled=false renders
  all actions null for that user.
- Verify: rspamadm configtest; GTUBE delivery proves reject action at a
  low per-user reject threshold; GTUBE at default reject + low header
  threshold proves X-Spam + sieve filing into Junk.
