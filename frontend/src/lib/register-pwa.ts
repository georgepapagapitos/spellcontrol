import { logger } from '@/lib/logger';
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

export async function registerPwa(): Promise<void> {
  if (typeof window === 'undefined') return;
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
