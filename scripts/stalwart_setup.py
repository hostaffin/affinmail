#!/usr/bin/env python3
"""Stalwart 1.2 bootstrap setup for AffinMail. stdlib only.

Reads the admin password from /etc/stalwart/local-secrets.txt (or $AM_ADMIN_PW)
and the Postgres password from deploy/.env ($POSTGRES_PASSWORD / STALWART_DB_PASSWORD).
Never prints secrets.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8080/jmap"
SECRETS = "/etc/stalwart/local-secrets.txt"
ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deploy", ".env")
if not os.path.exists(ENV):
    ENV = "/var/www/affinmail/deploy/.env"


def load_kv(path, sep="="):
    out = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or sep not in line:
                    continue
                k, v = line.split(sep, 1)
                out[k.strip()] = v.strip().strip("'\"")
    except FileNotFoundError:
        pass
    return out


def post(body, user, pw):
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode(),
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        return {"httpError": e.code, "body": e.read().decode(errors="replace")}


def main():
    secrets = load_kv(SECRETS)
    env = load_kv(ENV)
    admin_user = secrets.get("ADMIN_USER", "admin")
    admin_pw = os.environ.get("AM_ADMIN_PW") or secrets.get("ADMIN_PASSWORD", "")
    db_pw = os.environ.get("STALWART_DB_PASSWORD") or env.get("POSTGRES_PASSWORD", "")
    if not admin_pw:
        sys.exit("missing admin password (local-secrets.txt or $AM_ADMIN_PW)")
    if not db_pw:
        sys.exit("missing POSTGRES_PASSWORD in deploy/.env")

    update = {
        "defaultHostname": "affinmail.hostaffin.com",
        "defaultDomain": "affinmail.local",
        "requestTlsCertificate": False,
        "generateDkimKeys": True,
        "dataStore": {
            "@type": "PostgreSql",
            "host": "127.0.0.1",
            "port": 5432,
            "database": "affinmail",
            "authUsername": "affinmail_user",
            "authSecret": {"@type": "Value", "secret": db_pw},
            "useTls": False,
        },
        "blobStore": {"@type": "Default"},
        "searchStore": {"@type": "Default"},
        "inMemoryStore": {"@type": "Redis", "url": "redis://127.0.0.1:6379"},
        "directory": {"@type": "Internal"},
        "dnsServer": {"@type": "Manual"},
    }
    body = {
        "using": ["urn:stalwart:jmap"],
        "methodCalls": [
            ["x:Bootstrap/set", {"accountId": "d333333", "update": {"singleton": update}}, "0"]
        ],
    }
    result = post(body, admin_user, admin_pw)
    print(json.dumps(result, indent=2))
    responses = result.get("methodResponses") or []
    if responses and responses[0][1].get("updated"):
        print("SET OK")
        return 0
    print("SET FAILED (see response above)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
