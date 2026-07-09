import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build straight into the Express static dir: the app is served at /dashboard
// and its assets under /static/dist/ (web/server.js mounts web/static at /static).
export default defineConfig({
  plugins: [react()],
  base: '/static/dist/',
  build: { outDir: '../web/static/dist', emptyOutDir: true },
  // `npm run dev` proxies API calls to a locally running backend.
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
