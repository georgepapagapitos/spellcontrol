/**
 * Force the PWA back to a clean state by clearing every service-worker-owned
 * cache, unregistering every active service worker, then reloading the page.
 *
 * This is the user-visible escape hatch for a Workbox `registerType: 'prompt'`
 * stale shell: the standard "update now" toast (see `register-pwa.ts`) only
 * fires if the user happens to be on the page when a new SW finishes
 * installing. Users who keep the PWA open between deploys, or who dismiss the
 * toast, can otherwise stay on an old bundle until the OS evicts the cache.
 *
 * The reload at the end is what actually picks up the new bundle — clearing
 * the caches without reloading still leaves the running JS unchanged.
 *
 * Returns once the caches are gone and the SW(s) are unregistered. The caller
 * is responsible for showing UI feedback and triggering the reload. Splitting
 * those concerns makes the helper testable: tests can assert "did we clear
 * everything" without actually navigating the test runner.
 */
export interface ResetResult {
  cachesCleared: number;
  serviceWorkersUnregistered: number;
}

export async function clearAppCaches(): Promise<ResetResult> {
  let cachesCleared = 0;
  let serviceWorkersUnregistered = 0;

  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      const results = await Promise.allSettled(keys.map((k) => caches.delete(k)));
      cachesCleared = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    } catch (err) {
      // Some browsers (Safari private mode, locked-down enterprise profiles)
      // throw on caches.keys(). Swallow — we still want to attempt SW
      // unregistration so the user gets at least partial benefit.
      console.warn('[reset-cache] failed to enumerate caches:', err);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const results = await Promise.allSettled(registrations.map((r) => r.unregister()));
      serviceWorkersUnregistered = results.filter(
        (r) => r.status === 'fulfilled' && r.value,
      ).length;
    } catch (err) {
      console.warn('[reset-cache] failed to unregister service workers:', err);
    }
  }

  return { cachesCleared, serviceWorkersUnregistered };
}

/**
 * Full reset flow: clear, then hard-reload. Extracted from `clearAppCaches`
 * so the reload step can be stubbed in tests.
 */
export async function resetAppCacheAndReload(
  reload: () => void = () => window.location.reload(),
): Promise<ResetResult> {
  const result = await clearAppCaches();
  reload();
  return result;
}
