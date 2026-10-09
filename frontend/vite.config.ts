import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Build identifier baked in at build time, so a bundle can identify itself.
// Honor VITE_BUILD_ID if the CI/release pipeline sets one (stable, reproducible);
// otherwise fall back to a per-build timestamp so each `npm run build` differs.
const BUILD_ID = process.env.VITE_BUILD_ID || Date.now().toString();

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  // Vite 8 / rolldown fails to resolve the implicit HTML entry on macOS
  // (`[UNRESOLVED_ENTRY] Cannot resolve entry module /index.html`); pin it to
  // the absolute path so the production build works everywhere.
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // The coverage HTML report (written by `npm run test:coverage`) sits
    // inside the watched tree and triggers a "page reload" log line for
    // every file under it. Ignore it so dev logs stay quiet.
    watch: {
      ignored: ['**/coverage/**'],
    },
    proxy: {
      '/api': {
        // Parallel worktree sessions collide on :3737; point this Vite at a
        // backend on another port with VITE_DEV_API_TARGET=http://localhost:3738.
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3737',
        changeOrigin: true,
      },
      '/edhrec-api': {
        target: 'https://json.edhrec.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/edhrec-api/, ''),
      },
      '/scryfall-api': {
        target: 'https://api.scryfall.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scryfall-api/, ''),
        headers: {
          'User-Agent': 'spellcontrol/1.0',
          Accept: 'application/json',
        },
      },
    },
  },
});
