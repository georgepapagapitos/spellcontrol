import { create } from 'zustand';

/**
 * Tracks whether a new service worker is waiting and exposes a manual apply
 * hook. `register-pwa.ts` auto-applies silently in the common case; this
 * store is the deferred path for when the user is in the middle of something
 * fragile (an active playtest), and the Settings page is the manual escape
 * hatch that lets them apply on demand instead of having the tab reload
 * under them.
 */
interface PwaState {
  updateAvailable: boolean;
  setPending: (apply: () => Promise<void> | void) => void;
  applyPendingUpdate: () => Promise<void>;
}

export const usePwaStore = create<PwaState>((set) => {
  let pendingApply: (() => Promise<void> | void) | null = null;
  return {
    updateAvailable: false,
    setPending: (apply) => {
      pendingApply = apply;
      set({ updateAvailable: true });
    },
    applyPendingUpdate: async () => {
      const fn = pendingApply;
      if (!fn) return;
      pendingApply = null;
      set({ updateAvailable: false });
      await fn();
    },
  };
});
