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

## Completion (2026-11-28 night)
Implemented as designed (commits e9ce8de + a01b9e5): mail_spam_prefs
(+ greylist_threshold), GET/PUT /api/v1/client/mailboxes/{id}/spam-prefs,
settings render + write + `systemctl reload rspamd` (sudoers
affinmail-rspamd), settings.conf .include, global sieve_before filing
X-Spam: Yes into Junk (Dovecot 2.4 sieve_script block, sievec-compiled).
LIVE PROOF: rspamc for test1@ showed "Score 12.40 / 999.00" with prefs
(reject=999) vs "14.40 / 15.00" default for a prefs-less mailbox; the
same spammy message delivered via SMTP with prefs (add_header=1,
greylist=999) arrived with X-Spam: Yes and was filed into Junk by sieve.
GTUBE note: GTUBE is a Rspamd passthrough pre-result and bypasses
per-user thresholds by design (still rejected at the default level).
Test mailbox prefs were reset to defaults after the proof.
Not done: webmail UI form for these prefs (API only for now); the
Stalwart-era /api/v1/security/spam canned payload and the in-memory
quarantine stub remain as they were.
