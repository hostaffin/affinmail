#!/usr/bin/env bash
# AffinMail test runner: webmail vitest, server cargo, mcp-server cargo, Playwright E2E.
# 100% Rust backend and TypeScript frontend. Zero PHP. Zero Docker dependency.
# No outbound mail and no external network calls; every suite targets localhost.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

declare -A STATUS
FAILED=0

record() { STATUS["$1"]="$2"; [ "$2" = "FAIL" ] && FAILED=1; return 0; }

section() { echo; echo "=== $1 ==="; }

# 1. Webmail unit tests (vitest)
section "webmail vitest"
if npm --prefix webmail test; then record vitest PASS; else record vitest FAIL; fi

# 2. Native Rust Backend Server cargo tests
section "affinmail-server cargo test"
if cargo test --manifest-path server/Cargo.toml; then
  record server_cargo PASS
else
  record server_cargo FAIL
fi

# 3. MCP server cargo tests
section "mcp-server cargo test"
if cargo test --manifest-path mcp-server/Cargo.toml; then record mcp_cargo PASS; else record mcp_cargo FAIL; fi

# 4. Playwright E2E (optional: needs browsers installed)
section "webmail Playwright"
# Use the root copy of the Playwright CLI when present: tests/e2e resolves
# @playwright/test from the repo root, and two copies cannot share one process.
PW_BIN="./node_modules/.bin/playwright"
[ -x "$PW_BIN" ] || PW_BIN="webmail/node_modules/.bin/playwright"
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ ! -x "$PW_BIN" ]; then
  echo "SKIP: $PW_BIN not found"
  record playwright SKIP
elif [ ! -d "$PW_CACHE" ]; then
  echo "SKIP: no Playwright browsers in $PW_CACHE (run: npx playwright install chromium)"
  record playwright SKIP
else
  # Login assertions need AM_TEST_USER/AM_TEST_PASS; otherwise those tests skip.
  if "$PW_BIN" test -c webmail/playwright.config.ts; then record playwright PASS; else record playwright FAIL; fi
fi

# Summary
echo
echo "SUMMARY"
echo "-------"
for suite in vitest server_cargo mcp_cargo playwright; do
  printf '%-14s %s\n' "$suite" "${STATUS[$suite]}"
done

if [ "$FAILED" -ne 0 ]; then
  echo
  echo "RESULT: FAIL"
  exit 1
fi
echo
echo "RESULT: PASS"
exit 0
