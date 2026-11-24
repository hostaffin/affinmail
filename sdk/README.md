# AffinMail SDK (JavaScript)

Zero‑dependency fetch‑based client for the AffinMail REST API (`/api/v1/*`).

## Installation

```bash
# no npm install needed — just copy `affinmail.js` into your project
# or reference it via a <script type="module"> in the browser
```

## Usage

```javascript
import { login, listDomains, listMailboxes, createApiKey, listKeyUsage, batchCreateMailboxes, readStats } from './affinmail.js';

await login('admin', 'admin@affinmail.local');
// token is cached internally; subsequent calls use it automatically

const domains = await listDomains();
const mailboxes = await listMailboxes();
const key = await createApiKey('my‑integration', ['read:stats', 'write:mailboxes']);
const usage = await listKeyUsage(key.id);
const batch = await batchCreateMailboxes([{ domain_id: 'dom_1', email: 'a@affinmail.local' }]);
const stats = await readStats();
```

## API Reference

| Function | HTTP | Description |
|----------|------|-------------|
| `login(username, password)` | `POST /api/v1/auth/login` | Obtain a prototype admin session token. |
| `listDomains()` | `GET /api/v1/domains` | List all domains (requires auth). |
| `listMailboxes()` | `GET /api/v1/client/mailboxes` | List mailboxes for the authenticated client. |
| `createApiKey(name, scopes[])` | `POST /api/v1/api-keys` | Create an API key with the given scopes. |
| `listKeyUsage(keyId)` | `GET /api/v1/api-keys/{id}/usage` | Return usage counters for an API key. |
| `batchCreateMailboxes(requests[])` | `POST /api/v1/batch/mailboxes` | Bulk‑create mailboxes. |
| `readStats()` | `GET /api/v1/stats` | Return platform statistics. |
| `exportStats(format?)` | `GET /api/v1/stats/export?format=csv` | Export stats as CSV. |

## Examples

Three runnable examples live in `examples/`:

1. `example1-provision-domain-mailbox.js` — create a domain + a mailbox.
2. `example2-batch-create-mailboxes.js` — bulk‑create mailboxes.
3. `example3-read-stats.js` — fetch platform statistics.

Run them with Node 18+ (ESM):

```bash
node --experimental-modules examples/example1-provision-domain-mailbox.js
```

## Notes

* The SDK targets the **real API shapes** in this codebase (see `server/src/routes/*.rs`).
* API‑key authentication (`Authorization: Bearer <key‑id>`) is supported; the prototype admin session works unchanged.
* All functions throw on non‑2xx responses; callers should wrap in `try/catch`.