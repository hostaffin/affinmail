#!/usr/bin/env python3
"""
AffinMail Windows Local Mock API & JMAP Engine
Provides local responses for testing Admin Panel (REST API) and User Panel / Webmail (MCP/JMAP) without requiring Linux daemons.
Runs on 127.0.0.1:8080
"""

import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import sys

HOST = "127.0.0.1"
PORT = 8080

MOCK_DOMAINS = [
    {
        "id": "dom-apex",
        "domain": "apexlogistics.com",
        "assigned_ip": "195.201.10.102",
        "is_dedicated": True,
        "mailbox_count": 14,
        "storage_quota_mb": 50000,
        "status": "active",
        "dkim_status": "valid",
        "spf_status": "valid",
        "dmarc_status": "valid",
    },
    {
        "id": "dom-hostaffin",
        "domain": "hostaffin.com",
        "assigned_ip": "195.201.10.101",
        "is_dedicated": False,
        "mailbox_count": 8,
        "storage_quota_mb": 25000,
        "status": "active",
        "dkim_status": "valid",
        "spf_status": "valid",
        "dmarc_status": "valid",
    },
]

MOCK_POOLS = [
    {
        "id": "pool-dedicated",
        "name": "VIP Dedicated Outbound Pool",
        "ip_address": "195.201.10.102",
        "ptr_record": "mail1.hostaffin.com",
        "is_warmup_active": True,
        "warmup_day": 12,
        "warmup_limit": 500,
        "sent_today": 184,
        "rbl_status": "clean",
    },
    {
        "id": "pool-shared",
        "name": "General Shared Delivery Pool",
        "ip_address": "195.201.10.101",
        "ptr_record": "mail.hostaffin.com",
        "is_warmup_active": False,
        "warmup_day": 30,
        "warmup_limit": 999999,
        "sent_today": 3410,
        "rbl_status": "clean",
    },
]

class AffinMailMockHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        print(f"[Mock Backend] GET {self.path}")
        if self.path.startswith("/api/v1/domains") or self.path.startswith("/api/domains"):
            self._send_json({"status": "success", "data": MOCK_DOMAINS})
        elif self.path.startswith("/api/v1/pools") or self.path.startswith("/api/pools"):
            self._send_json({"status": "success", "data": MOCK_POOLS})
        elif self.path.startswith("/api/v1/storage") or self.path.startswith("/api/storage"):
            self._send_json({
                "status": "success",
                "storage_type": "fs",
                "local_path": "d:/AffinMail/data/blobs",
                "used_bytes": 3435973836,
                "total_bytes": 107374182400
            })
        elif self.path.startswith("/health") or self.path == "/":
            self._send_json({
                "engine": "AffinMail Windows Test Mock",
                "status": "healthy",
                "version": "2.0.0-windows-test"
            })
        else:
            self._send_json({"status": "ok", "path": self.path})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""
        print(f"[Mock Backend] POST {self.path} - Body length: {len(body)}")

        if self.path.startswith("/jmap"):
            # JMAP RFC 8620 response
            self._send_json({
                "methodResponses": [
                    [
                        "Email/query",
                        {
                            "accountId": "acc-marcus-1",
                            "ids": ["th-stripe-1092", "th-github-sec-2918", "th-sarah-design-final", "th-hetzner-nov26"],
                            "total": 4,
                            "position": 0
                        },
                        "c1"
                    ]
                ],
                "sessionState": "state-test-windows-1"
            })
        else:
            self._send_json({"status": "success", "message": "Operation accepted by AffinMail Core Engine."})

def run():
    server = HTTPServer((HOST, PORT), AffinMailMockHandler)
    print(f"==================================================================")
    print(f"   AffinMail Windows Local Mock Server Running at http://{HOST}:{PORT}")
    print(f"   - JMAP Endpoint:        http://{HOST}:{PORT}/jmap")
    print(f"   - Admin REST API:       http://{HOST}:{PORT}/api/v1/domains")
    print(f"==================================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down AffinMail Mock Server.")
        server.server_close()

if __name__ == "__main__":
    run()
