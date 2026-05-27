import { logger } from '@/lib/logger';
import { isNativePlatform } from '@/lib/platform';
import { usePlayStore } from '@/store/play';
import { usePwaStore } from '@/store/pwa';

/**
 * Wire the Workbox-generated service worker into our app.
 *
 * Only `onNeedRefresh` is handled. It fires when a new SW has finished
 * installing in the background — in the common case (no fragile local
 * state) we apply silently and the SW swap reloads the tab. If a
 * playtest is active we defer instead and surface a passive "update
 * available" control on the Settings page so a tab doesn't reload out
 * from under someone mid-game.
 *
 * `onOfflineReady` is intentionally omitted: with always-on card data
 * (see `lib/offline/auto-sync`), the app just works offline, full stop —
 * a "now available offline" confirmation toast is redundant, and it
 * tended to re-fire on every watchtower-driven SW update which looked
 * like a bug to the user.
 */
function isPlaytestActive(): boolean {
  const { local, online } = usePlayStore.getState();
  const localActive = local && local.status !== 'finished';
  const onlineActive = online && online.status !== 'finished';
  return Boolean(localActive || onlineActive);
}

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

  // The native (Capacitor) app bundles every asset in the APK and serves
  // it from the local `https://localhost` origin, so a Workbox precache
  // layer adds nothing — and it actively hurts: a freshly installed build
  // boots the *previous* build's cached app-shell (a white screen until
  // the SW silently updates). Skip registration on native, and tear down
  // any SW/caches an earlier build left behind so existing installs
  // self-heal. Native offline support is handled by lib/offline/auto-sync,
  // independent of the service worker.
  //
  // Build-id gate: we previously nuked on *every* native boot, which was
  // wasteful — a relaunched-but-unchanged install would re-download every
  // cached asset for no reason. `__BUILD_ID__` is baked in at build time
  // (see vite.config.ts); compare it to the id this device last saw and
  // only tear down when they differ (or on first boot).
  if (isNativePlatform()) {
    await reconcileNativeBundle(__BUILD_ID__);
    return;
  }

  // The `virtual:pwa-register` module is injected by vite-plugin-pwa at
  // build time. Dynamic import keeps the unit-test bundle from choking on
  // the unresolved specifier under Vitest's node environment.
  let registerSW: typeof import('virtual:pwa-register').registerSW;
  try {
    ({ registerSW } = await import('virtual:pwa-register'));
  } catch {
    // No PWA register module — running under tests, an unsupported browser,
    // or the plugin is disabled. Silent skip; the app works fine without.
    return;
  }

  const updateSW = registerSW({
    onNeedRefresh() {
      const apply = () => updateSW(true);
      if (isPlaytestActive()) {
        usePwaStore.getState().setPending(apply);
        return;
      }
      void apply();
    },
    onRegisterError(error) {
      logger.warn('[pwa] service worker registration failed:', error);
    },
  });
}
