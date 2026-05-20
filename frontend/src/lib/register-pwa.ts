import { toast } from '@/store/toasts';

/**
 * Wire the Workbox-generated service worker to our toast system.
 *
 * - `onNeedRefresh` fires when a new SW has finished installing in the
 *   background — we surface a non-auto-dismissing toast with an "Update now"
 *   action that swaps to the new SW and reloads.
 * - `onOfflineReady` fires the first time the SW finishes its initial
 *   precache, so the user gets a tiny confirmation that the app shell is
 *   now available without a network.
 *
 * Plays nicely with the offline-mode feature: the SW caches the *app shell*
 * (HTML/JS/CSS), while the offline-mode toggle controls whether card data
 * comes from IndexedDB or the live API. Two layers, complementary.
 */
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
      toast.show({
        message: 'A new version of SpellControl is ready.',
        tone: 'info',
        actionLabel: 'Update now',
        // 0 → stay until the user dismisses or acts. The update isn't
        // disruptive if ignored — the SW just swaps on the next cold load.
        durationMs: 0,
        onAction: () => {
          void updateSW(true);
        },
      });
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
