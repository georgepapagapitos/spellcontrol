import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' hands control of the SW swap to us so we can apply it
      // silently in the common case but defer (see `register-pwa.ts`) when
      // a local playtest is active — auto-reload mid-game would be hostile.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['tagger-tags.json', 'sc-icon.svg'],
      manifest: {
        name: 'SpellControl',
        short_name: 'SpellControl',
        description: 'Plan physical Magic: The Gathering binders, decks, and games.',
        theme_color: '#0a1f3d',
        background_color: '#0a1f3d',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // Single SVG icon — modern PWA spec accepts SVG for all sizes via
        // `purpose: 'any maskable'`. Saves us from generating 8 PNG sizes.
        icons: [
          {
            src: '/sc-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the build output. globPatterns covers HTML/JS/CSS/fonts;
        // tagger-tags.json is added via includeAssets above so the offline
        // deck builder works cold.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf,json}'],
        // Scanner v2 (Phase 0 spike) vendors opencv.js into
        // public/scanner-v2/opencv.js (~10MB) and loads it via a classic
        // <script> tag — see lib/scanner-v2/opencv-loader.ts for why we
        // bypassed Vite's ESM dynamic-import path. Excluded from precache
        // so the build doesn't fail Workbox's size gate; first scanner open
        // fetches it (native APK ships it bundled either way). Revisit
        // if/when v2 ships and offline scanner is a requirement.
        globIgnores: ['**/opencv*.js'],
        // Keep the precache cap generous — the tagger JSON + font subsets
        // alone push past Workbox's 2MB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Backend routes must reach the server. Without this, top-level
        // navigations to /api/* (notably the Google OAuth start /api/auth/google
        // and its callback /api/auth/google/callback) get the cached index.html
        // instead — the backend never runs, no Set-Cookie ever happens, and
        // the SPA's catch-all silently lands the user on /collection as a
        // guest. Password login works only because it's an XHR (handled by
        // runtimeCaching below), not a navigation.
        navigateFallbackDenylist: [/^\/api\//],
        // Routes the SW handles at request time (vs. precache).
        runtimeCaching: [
          {
            // Scryfall card images — viewed once, kept forever-ish. CacheFirst
            // means the browser doesn't even re-validate, which matches the
            // immutable nature of Scryfall's image URLs (they version via
            // the path so URLs change when art changes).
            urlPattern: /^https:\/\/cards\.scryfall\.io\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scryfall-images',
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Offline bulk endpoints — never SW-cache, they're huge and the
            // app stores them in IndexedDB via lib/offline/download.ts. SW
            // caching would double-store and confuse the manifest version check.
            urlPattern: /\/api\/offline\//,
            handler: 'NetworkOnly',
          },
          {
            // Generic /api fall-through. NetworkFirst with a short timeout
            // so a slow/offline backend doesn't strand the UI — falls back
            // to whatever was last cached. Offline-toggle-on flows don't
            // hit /api at all so this only matters when toggle is off.
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Google Fonts CSS + woff files used by the app.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // Dev SW is intentionally OFF — it makes HMR flaky and only matters
      // for production behavior. Test the PWA via `npm run build && npm run preview`.
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
