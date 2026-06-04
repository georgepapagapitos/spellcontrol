import { logger } from '@/lib/logger';
import { isNativePlatform } from '@/lib/platform';

/**
 * Tear down the retired service worker.
 *
 * SpellControl no longer ships a PWA (see vite.config.ts: the plugin is in
 * `selfDestroying` mode, kept only to retire existing SWs). The web app is a
 * plain SPA — the app-shell precache only ever caused stale-bundle confusion
 * after a deploy. Offline card data is IndexedDB-backed and SW-independent
 * (lib/offline/auto-sync), so removing the SW costs nothing.
 *
 * Both platforms now do the same thing: unregister any service worker a prior
 * build left behind and clear its caches so a returning browser drops straight
 * to the freshly-served bundle. Native gates the teardown behind a build-id
 * compare so a relaunched-but-unchanged install doesn't needlessly re-download
 * its cached assets; web tears down unconditionally (idempotent no-op once the
 * SW is gone). This complements the selfDestroying sw.js, which also frees
 * browsers via their own update check even when they never load this build.
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

const BUILD_ID_STORAGE_KEY = 'spellcontrol-build-id';

/**
 * Read the build id this device last booted with. Returns `null` if there
 * is no prior id or localStorage is unavailable (private mode, quota,
 * SecurityError). A read failure is treated as "no prior id" so the caller
 * falls back to the safe path (nuke + write the new id).
 */
function readStoredBuildId(): string | null {
  try {
    return localStorage.getItem(BUILD_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the current build id. Silent on failure — if localStorage can't
 * be written, the worst case is we re-nuke next boot, which is harmless.
 */
function writeStoredBuildId(id: string): void {
  try {
    localStorage.setItem(BUILD_ID_STORAGE_KEY, id);
  } catch {
    // ignore — see readStoredBuildId for rationale
  }
}

/**
 * Native boot path: only tear down SW + caches when the installed bundle
 * differs from what this device last saw. The old code nuked unconditionally
 * on every launch, costing the next-launch user a fresh download of every
 * cached asset; comparing build ids lets a re-launched-but-unchanged install
 * keep its offline cache intact. Exported for unit testing.
 */
export async function reconcileNativeBundle(currentBuildId: string): Promise<void> {
  const stored = readStoredBuildId();
  if (stored === currentBuildId) return;
  await unregisterServiceWorkers();
  writeStoredBuildId(currentBuildId);
}

export async function registerPwa(): Promise<void> {
  if (typeof window === 'undefined') return;

  // Native (Capacitor) bundles every asset in the APK and serves it from the
  // local `https://localhost` origin, so a precache layer adds nothing and a
  // stale one shows the previous build's shell. Gate the teardown behind a
  // build-id compare so a relaunched-but-unchanged install keeps its cache.
  // `__BUILD_ID__` is baked in at build time (see vite.config.ts).
  if (isNativePlatform()) {
    await reconcileNativeBundle(__BUILD_ID__);
    return;
  }

  // Web: the PWA is retired. Unconditionally unregister any SW a prior build
  // installed and clear its caches so the browser stops serving the cached
  // app shell. Idempotent — a no-op once no SW remains.
  await unregisterServiceWorkers();
}
