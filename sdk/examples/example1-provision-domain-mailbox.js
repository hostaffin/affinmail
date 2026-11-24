// Example 1 — provision a domain + mailbox
// Usage (Node 18+): node --experimental-modules example1-provision-domain-mailbox.js
// Requires an admin token (set via setToken or pass it).

import { login, setToken } from '../affinmail.js';

(async () => {
    // login as prototype admin
    const auth = await login('admin', 'admin@affinmail.local');
    setToken(auth.token);
    console.log('logged in:', auth.token);

    // create a domain
    const domainRes = await fetch('http://127.0.0.1:2099/api/v1/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_name: 'example.test', max_mailboxes: 10 }),
    });
    const domain = await domainRes.json();
    console.log('domain created:', domain);

    // create a mailbox under that domain (shape inferred from the REST API)
    const mbRes = await fetch('http://127.0.0.1:2099/api/v1/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_id: domain.id, email: 'alice@example.test', display_name: 'Alice' }),
    });
    const mb = await mbRes.json();
    console.log('mailbox created:', mb);
})();