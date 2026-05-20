import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  clearOfflineData,
  getOfflineDataStats,
  readOfflineManifest,
  syncOfflineData,
  type DownloadProgress,
  type OfflineManifest,
} from '@/lib/offline';

/**
 * Persisted offline-mode preferences + live download status.
 *
 * Only `enabled` is persisted — everything else (progress, last manifest) is
 * loaded from IndexedDB on app boot via `bootstrapOfflineMode()`. Keeping
 * status in zustand (not IDB-only) gives the settings UI a single source to
 * subscribe to.
 */
interface OfflineState {
  /** User's preference: should the app prefer offline data when available? */
  enabled: boolean;
  /** Latest manifest stored in IDB. Null = no data has ever been downloaded. */
  manifest: OfflineManifest | null;
  /** Counts in the local DB, useful for diagnosing stuck/incomplete syncs. */
  stats: { cardCount: number; comboCount: number } | null;
  /** Live progress during a sync. `null` when no sync is running. */
  progress: DownloadProgress | null;
  /** Last sync error message, if any. */
  error: string | null;
  /** Has bootstrap (load manifest + stats from IDB) completed? */
  bootstrapped: boolean;

  setEnabled: (enabled: boolean) => void;
  bootstrap: () => Promise<void>;
  sync: (opts?: { force?: boolean }) => Promise<void>;
  clear: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      enabled: false,
      manifest: null,
      stats: null,
      progress: null,
      error: null,
      bootstrapped: false,

      setEnabled: (enabled) => set({ enabled }),

      bootstrap: async () => {
        if (get().bootstrapped) return;
        try {
          const [manifest, stats] = await Promise.all([
            readOfflineManifest(),
            getOfflineDataStats(),
          ]);
          set({ manifest, stats, bootstrapped: true });
        } catch (err) {
          console.warn('[offline] bootstrap failed:', err);
          set({ bootstrapped: true, error: errorMessage(err) });
        }
      },

      sync: async (opts) => {
        set({ progress: { phase: 'fetching-manifest', fraction: null }, error: null });
        try {
          const result = await syncOfflineData({
            force: opts?.force,
            onProgress: (p) => set({ progress: p }),
          });
          const stats = await getOfflineDataStats();
          set({
            manifest: result.manifest,
            stats,
            progress: { phase: 'done', fraction: 1 },
          });
        } catch (err) {
          console.warn('[offline] sync failed:', err);
          set({ progress: { phase: 'error', fraction: null }, error: errorMessage(err) });
        }
      },

      clear: async () => {
        await clearOfflineData();
        set({ manifest: null, stats: { cardCount: 0, comboCount: 0 }, error: null });
      },
    }),
    {
      name: 'spellcontrol-offline-prefs',
      storage: createJSONStorage(() => localStorage),
      // Only persist the user preference; everything else comes from IDB at bootstrap.
      partialize: (s) => ({ enabled: s.enabled }),
    }
  )
);

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Selector to ask "should I read from the local offline DB right now?" — true
 * when the user has opted in AND data is actually present. Used by the
 * Scryfall + combos client interceptors.
 */
export function shouldUseOfflineData(state: OfflineState): boolean {
  return state.enabled && !!state.manifest && state.manifest.oracleCardCount > 0;
}
