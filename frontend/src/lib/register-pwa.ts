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
  if (isNativePlatform()) {
    await unregisterServiceWorkers();
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
