#!/usr/bin/env bash
# Import/migration smoke test. Requires a running local API and a target mailbox.
#
#   AFFINMAIL_ADMIN_TOKEN   admin bearer token (api/.env)
#   TEST_TARGET_EMAIL       mailbox email to import into (must exist in PG mailboxes
#                           with a secret_vault, i.e. created via the admin API)
#   TEST_TARGET_PASSWORD    optional fallback if the mailbox has no stored secret
#
# Never contacts external mail servers: only the local API on 127.0.0.1:8090.
set -euo pipefail

API="${API:-http://127.0.0.1:8090/api/v1}"
: "${AFFINMAIL_ADMIN_TOKEN:?set AFFINMAIL_ADMIN_TOKEN}"
: "${TEST_TARGET_EMAIL:?set TEST_TARGET_EMAIL}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MBOX="$DIR/fixtures/sample.mbox"
EML="$DIR/fixtures/sample.eml"

echo "== POST /import/mbox -> $TEST_TARGET_EMAIL"
form=(-F "file=@$MBOX" -F "targetEmail=$TEST_TARGET_EMAIL")
if [[ -n "${TEST_TARGET_FOLDER:-}" ]]; then form+=(-F "targetFolder=$TEST_TARGET_FOLDER"); fi
if [[ -n "${TEST_TARGET_PASSWORD:-}" ]]; then form+=(-F "targetPassword=$TEST_TARGET_PASSWORD"); fi
curl -sS -X POST "$API/import/mbox" \
  -H "Authorization: Bearer $AFFINMAIL_ADMIN_TOKEN" \
  "${form[@]}" | tee /tmp/affinmail-import-mbox.json
echo

echo "== POST /import/eml"
form=(-F "file=@$EML" -F "targetEmail=$TEST_TARGET_EMAIL")
if [[ -n "${TEST_TARGET_PASSWORD:-}" ]]; then form+=(-F "targetPassword=$TEST_TARGET_PASSWORD"); fi
curl -sS -X POST "$API/import/eml" \
  -H "Authorization: Bearer $AFFINMAIL_ADMIN_TOKEN" \
  "${form[@]}" | tee /tmp/affinmail-import-eml.json
echo

JOB_ID="$(python3 -c 'import json,sys;print(json.load(open("/tmp/affinmail-import-mbox.json"))["data"]["id"])' 2>/dev/null || true)"
if [[ -n "$JOB_ID" ]]; then
  echo "== GET /import/jobs/$JOB_ID"
  curl -sS "$API/import/jobs/$JOB_ID" -H "Authorization: Bearer $AFFINMAIL_ADMIN_TOKEN"; echo
fi

echo "== GET /import/jobs?targetEmail=$TEST_TARGET_EMAIL"
curl -sS "$API/import/jobs?targetEmail=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$TEST_TARGET_EMAIL")" \
  -H "Authorization: Bearer $AFFINMAIL_ADMIN_TOKEN"; echo

echo "OK"
