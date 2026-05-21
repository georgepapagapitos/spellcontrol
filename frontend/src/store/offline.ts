import { logger } from '@/lib/logger';
import { create } from 'zustand';
import {
  clearOfflineData,
  getOfflineDataStats,
  readOfflineManifest,
  syncOfflineData,
  type DownloadProgress,
  type OfflineManifest,
} from '@/lib/offline';

/**
 * Live offline-data status. There is no user-facing on/off — the app always
 * keeps a local copy of the Scryfall + combo bulks once authed (downloaded
 * silently on first authed load, refreshed at most once per day). Settings
 * surface this for inspection + an escape-hatch "Clear" button only.
 *
 * Nothing is persisted to localStorage; manifest + counts live in IndexedDB
 * and rehydrate via `bootstrap()` on app boot.
 */
interface OfflineState {
  /** Latest manifest stored in IDB. Null = no data has ever been downloaded. */
  manifest: OfflineManifest | null;
  /** Counts in the local DB, useful for diagnosing stuck/incomplete syncs. */
  stats: { cardCount: number; comboCount: number } | null;
  /** Live progress during a sync. `null` when no sync is running. */
  progress: DownloadProgress | null;
  /** Last sync error message, if any (kept for diagnostics; not surfaced as UI by default). */
  error: string | null;
  /** Has bootstrap (load manifest + stats from IDB) completed? */
  bootstrapped: boolean;

  bootstrap: () => Promise<void>;
  sync: (opts?: { force?: boolean }) => Promise<void>;
  clear: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>()((set, get) => ({
  manifest: null,
  stats: null,
  progress: null,
  error: null,
  bootstrapped: false,

  bootstrap: async () => {
    if (get().bootstrapped) return;
    try {
      const [manifest, stats] = await Promise.all([readOfflineManifest(), getOfflineDataStats()]);
      set({ manifest, stats, bootstrapped: true });
    } catch (err) {
      logger.warn('[offline] bootstrap failed:', err);
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
      logger.warn('[offline] sync failed:', err);
      set({ progress: { phase: 'error', fraction: null }, error: errorMessage(err) });
    }
  },

  clear: async () => {
    await clearOfflineData();
    set({ manifest: null, stats: { cardCount: 0, comboCount: 0 }, error: null });
  },
}));

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * "Is the local offline data populated enough to serve a query?" — used by
 * the Scryfall + combos client interceptors to decide between local read
 * and network fetch. No user preference involved; this is purely a data-
 * availability check.
 */
export function offlineDataAvailable(state: OfflineState): boolean {
  return !!state.manifest && state.manifest.oracleCardCount > 0;
}
