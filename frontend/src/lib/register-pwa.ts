import { toast } from '@/store/toasts';
import { usePlayStore } from '@/store/play';
import { usePwaStore } from '@/store/pwa';

/**
 * Wire the Workbox-generated service worker into our app.
 *
 * - `onNeedRefresh` fires when a new SW has finished installing in the
 *   background. In the common case (no fragile local state) we apply
 *   silently — the SW swap reloads the tab, which is the only signal the
 *   user gets. If a playtest is active we defer instead and surface a
 *   passive "update available" control on the Settings page, so a tab
 *   doesn't reload out from under someone mid-game.
 * - `onOfflineReady` fires the first time the SW finishes its initial
 *   precache, so the user gets a tiny confirmation that the app shell is
 *   now available without a network.
 *
 * Plays nicely with the offline-mode feature: the SW caches the *app shell*
 * (HTML/JS/CSS), while the offline-mode toggle controls whether card data
 * comes from IndexedDB or the live API. Two layers, complementary.
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
    onOfflineReady() {
      toast.show({
        message: 'SpellControl is now available offline.',
        tone: 'success',
        durationMs: 4000,
      });
    },
    onRegisterError(error) {
      console.warn('[pwa] service worker registration failed:', error);
    },
  });
}
