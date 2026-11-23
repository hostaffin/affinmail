#!/usr/bin/env bash
# AffinMail Entrypoint Script - Routes to install.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/install.sh" "$@"
