import { logger } from '@/lib/logger';

/**
 * Tear down the retired service worker.
 *
 * SpellControl no longer ships a PWA (see vite.config.ts: the plugin is in
 * `selfDestroying` mode, kept only to retire existing SWs). The web app is a
 * plain SPA — the app-shell precache only ever caused stale-bundle confusion
 * after a deploy. Offline card data is IndexedDB-backed and SW-independent
 * (lib/offline/auto-sync), so removing the SW costs nothing.
 *
 * Unregister any service worker a prior build left behind and clear its caches
 * so a returning browser drops straight to the freshly-served bundle. This
 * complements the selfDestroying sw.js, which also frees browsers via their own
 * update check even when they never load this build.
 */

/**
 * Tear down any service worker (and its caches) a previous build left
 * registered for this origin. Best-effort: cleanup must never block boot.
 */
async function unregisterServiceWorkers(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (error) {
    logger.warn('[pwa] service worker teardown failed:', error);
  }
}

export async function registerPwa(): Promise<void> {
  if (typeof window === 'undefined') return;
  // Idempotent — a no-op once no SW remains.
  await unregisterServiceWorkers();
}
