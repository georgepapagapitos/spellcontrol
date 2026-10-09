// Self-destroying service worker. The PWA was retired in #482; this file is
// what a browser still holding that old worker fetches on its update check.
// It unregisters itself, clears every cache, and reloads open tabs onto the
// live bundle. It must keep answering at /sw.js: a 404, or the SPA fallback's
// index.html, fails the update check and leaves the old worker in charge.
// Copied from vite-plugin-pwa's `selfDestroying` output when the plugin was
// dropped; lib/util/register-pwa.ts does the same teardown from the page.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', () => {
  self.registration
    .unregister()
    .then(() => self.clients.matchAll())
    .then((clients) => {
      clients.forEach((client) => {
        if (client instanceof WindowClient) client.navigate(client.url);
      });
    })
    .then(() => self.caches.keys())
    .then((names) => Promise.all(names.map((name) => self.caches.delete(name))));
});
