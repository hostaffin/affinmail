#!/usr/bin/env bash
# AffinMail Local Installer Script
# Routes to root install.sh for single source of truth
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "${PARENT_DIR}/install.sh" ]; then
    bash "${PARENT_DIR}/install.sh" "$@"
else
    echo "Installer file not found at ${PARENT_DIR}/install.sh"
    exit 1
fi
