// Example 2 — bulk‑create mailboxes via batch API
import { login, setToken, batchCreateMailboxes } from '../affinmail.js';

(async () => {
    const auth = await login('admin', 'admin@affinmail.local');
    setToken(auth.token);
    const result = await batchCreateMailboxes([
        { domain_id: 'dom_1', email: 'bob1@affinmail.local' },
        { domain_id: 'dom_1', email: 'bob2@affinmail.local' },
    ]);
    console.log('batch result:', result);
})();