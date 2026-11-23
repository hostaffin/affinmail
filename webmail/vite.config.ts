import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Same paths Caddy proxies in production, so `npm run dev` talks to the real server.
    proxy: {
      '/jmap': 'http://127.0.0.1:8080',
    },
  },
  test: {
    globals: true,
  },
});
