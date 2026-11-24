// AffinMail SDK — fetch‑based, zero dependencies
// Usage: import { login, listDomains, listMailboxes, createApiKey, listKeyUsage, batchCreateMailboxes, readStats, exportStats } from './sdk/affinmail.js';

// Base URL for the AffinMail API (adjust per environment)
const BASE = 'http://127.0.0.1:2099';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function login(username, password) {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.json(); // { token, role, ... }
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export async function listDomains() {
    const res = await fetch(`${BASE}/api/v1/domains`, { headers: { 'Authorization': `Bearer ${await getToken()}` } });
    if (!res.ok) throw new Error(`list domains: ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Mailboxes (client self‑service)
// ---------------------------------------------------------------------------

export async function listMailboxes() {
    const res = await fetch(`${BASE}/api/v1/client/mailboxes`, {
        headers: { 'Authorization': `Bearer ${await getToken()}` },
    });
    if (!res.ok) throw new Error(`list mailboxes: ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export async function createApiKey(name, scopes) {
    const res = await fetch(`${BASE}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await getToken()}`,
        },
        body: JSON.stringify({ name, scopes }),
    });
    if (!res.ok) throw new Error(`create key: ${res.status}`);
    return res.json();
}

export async function listKeyUsage(keyId) {
    const res = await fetch(`${BASE}/api/v1/api-keys/${keyId}/usage`, {
        headers: { 'Authorization': `Bearer ${await getToken()}` },
    });
    if (!res.ok) throw new Error(`key usage: ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export async function batchCreateMailboxes(mailboxRequests) {
    const res = await fetch(`${BASE}/api/v1/batch/mailboxes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await getToken()}`,
        },
        body: JSON.stringify(mailboxRequests),
    });
    if (!res.ok) throw new Error(`batch create: ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function readStats() {
    const res = await fetch(`${BASE}/api/v1/stats`, {
        headers: { 'Authorization': `Bearer ${await getToken()}` },
    });
    if (!res.ok) throw new Error(`read stats: ${res.status}`);
    return res.json();
}

export async function exportStats(format = 'csv') {
    const res = await fetch(`${BASE}/api/v1/stats/export?format=${format}`, {
        headers: { 'Authorization': `Bearer ${await getToken()}` },
    });
    if (!res.ok) throw new Error(`export stats: ${res.status}`);
    return res.json(); // may contain a download URL or the CSV body
}

// ---------------------------------------------------------------------------
// Helper — keep a token in localStorage (or wherever) for the examples
// ---------------------------------------------------------------------------

let _token = undefined;
export function setToken(t) { _token = t; }
export async function getToken() {
    if (_token) return _token;
    // fallback: try to read from localStorage (browser) — here we just return undefined
    // callers should provide a token via setToken() before use.
    return _token;
}

// ---------------------------------------------------------------------------
// Example: simple poll‑based wait for a key‑authenticated request to succeed
// ---------------------------------------------------------------------------

export async function waitFor(keyId, attempts = 10, delay = 1000) {
    for (let i = 0; i < attempts; i++) {
        try {
            const usage = await listKeyUsage(keyId);
            if (usage.total_calls > 0) return usage;
        } catch (_) {}
        await new Promise(r => setTimeout(r, delay));
    }
    throw new Error('key usage never incremented');
}