// Example 3 — read statistics
import { login, setToken, readStats } from '../affinmail.js';

(async () => {
    const auth = await login('admin', 'admin@affinmail.local');
    setToken(auth.token);
    const stats = await readStats();
    console.log('stats:', JSON.stringify(stats, null, 2));
})();