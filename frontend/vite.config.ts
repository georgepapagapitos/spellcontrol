import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Build identifier baked in at build time. Native (Capacitor) boot uses it
// to decide whether the previous build's service-worker cache needs nuking;
// unchanged build id => same bundle => leave the offline cache alone.
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
  plugins: [
    react(),
    // The PWA / service worker has been RETIRED. SpellControl ships a native
    // app for real offline use, and the web app-shell precache only ever
    // caused stale-bundle confusion: a Fly deploy would land but returning
    // browsers kept serving the previously-cached bundle until the SW updated.
    // The web app is now a plain SPA (always online); offline card data is
    // IndexedDB-backed and SW-independent (lib/offline/auto-sync).
    //
    // `selfDestroying: true` is the supported teardown path — it emits a
    // service worker that UNREGISTERS any SW a prior build installed and
    // purges its caches, so existing browsers self-heal on their next
    // update check (a bare plugin removal would strand them on the old SW,
    // since a 404 on sw.js does not reliably unregister it). Keep this for a
    // few weeks until old SWs have aged out, then the plugin can be deleted
    // entirely (register-pwa.ts already only tears SWs down — see there).
    // `injectRegister: false` leaves registration to register-pwa.ts so the
    // native (Capacitor) path can opt out.
    VitePWA({
      selfDestroying: true,
      injectRegister: false,
      devOptions: { enabled: false },
    }),
  ],
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
        target: 'http://localhost:3737',
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
