#!/usr/bin/env bash
# AffinMail Continuous RBL / DNSBL Blacklist Checker
# Runs hourly via cron: 0 * * * * /opt/affinmail/scripts/rbl-check.sh

set -euo pipefail

RBL_PROVIDERS=(
    "zen.spamhaus.org"
    "b.barracudacentral.org"
    "bl.spamcop.net"
    "dnsbl.sorbs.net"
)

PG_HOST="${POSTGRES_HOST:-localhost}"
PG_USER="${POSTGRES_USER:-affinmail_user}"
PG_DB="${POSTGRES_DB:-affinmail}"

echo "[AffinMail RBL] Running hourly RBL health check $(date -u)"

# Fetch active pool IPs
IPS=$(psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -t -A -c "SELECT id, ip_address FROM ip_pools WHERE is_active = TRUE;")

while IFS='|' read -r IP_ID IP_ADDR; do
    [ -z "$IP_ADDR" ] && continue
    
    # Reverse IP for DNSBL query (e.g. 195.201.10.101 -> 101.10.201.195)
    REV_IP=$(echo "$IP_ADDR" | awk -F. '{print $4"."$3"."$2"."$1}')
    
    for RBL in "${RBL_PROVIDERS[@]}"; do
        QUERY="${REV_IP}.${RBL}"
        LISTED=false
        RESP=""
        
        if dig +short "$QUERY" | grep -q "127\."; then
            LISTED=true
            RESP=$(dig +short "$QUERY" | tr '\n' ' ')
            echo "[WARNING] IP $IP_ADDR is LISTED on $RBL! Response: $RESP"
            
            # Record listing and flag IP
            psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -c "
                INSERT INTO ip_rbl_checks (ip_id, rbl_provider, is_listed, response_code) 
                VALUES ('$IP_ID', '$RBL', TRUE, '$RESP');
                UPDATE ip_pools SET is_blacklisted = TRUE WHERE id = '$IP_ID';
            "
        else
            psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -c "
                INSERT INTO ip_rbl_checks (ip_id, rbl_provider, is_listed) 
                VALUES ('$IP_ID', '$RBL', FALSE);
            "
        fi
    done
done <<< "$IPS"

echo "[AffinMail RBL] Check completed."
