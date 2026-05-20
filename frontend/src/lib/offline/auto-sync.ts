import { useOfflineStore } from '@/store/offline';

const LAST_CHECK_KEY = 'spellcontrol-offline-last-check';
const ONCE_PER_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Silently keep the local card catalog + combo dataset fresh in the
 * background. Called from `App.tsx` whenever the auth store flips to
 * `authed`. Two passes:
 *
 *   1. **Bootstrap.** Hydrate the in-memory store from IndexedDB so the
 *      Scryfall/combos read paths can short-circuit immediately. Cheap; runs
 *      every authed mount.
 *   2. **Refresh.** If no manifest yet (first-ever sign-in on this device),
 *      OR the last successful check was more than 24h ago, kick off a
 *      `sync()` against the server. The server-side manifest endpoint is
 *      cheap (~5min Cache-Control) and the bulk endpoint short-circuits on
 *      ETag, so an up-to-date device pays one tiny HEAD-ish request and
 *      nothing else.
 *
 * Fully fire-and-forget. Failures land in `useOfflineStore.error` for
 * diagnostics; no toasts, no blocking, no retries — the next sign-in will
 * try again.
 *
 * Also asks the browser for persistent-storage permission so the cached
 * blob isn't first-in-line to be evicted under storage pressure. Browsers
 * may grant or silently deny; we don't care which.
 */
export async function autoSyncOfflineData(): Promise<void> {
  // Persistent-storage hint runs unconditionally — cheap, idempotent, browser
  // remembers the answer across reloads.
  void requestPersistentStorage();

  const store = useOfflineStore.getState();
  if (!store.bootstrapped) {
    try {
      await store.bootstrap();
    } catch {
      // bootstrap() already records errors on the store; no need to surface.
    }
  }

  const fresh = useOfflineStore.getState();
  const hasManifest = !!fresh.manifest && fresh.manifest.oracleCardCount > 0;
  const lastCheck = readLastCheck();
  const stale = !lastCheck || Date.now() - lastCheck > ONCE_PER_DAY_MS;

  if (!hasManifest || stale) {
    try {
      await fresh.sync();
      writeLastCheck(Date.now());
    } catch {
      // sync() already records errors on the store; swallow here.
    }
  }
}

function readLastCheck(): number | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastCheck(at: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(at));
  } catch {
    // Quota errors / Safari private mode — non-fatal; next mount just re-checks.
  }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    // Some browsers (Firefox) prompt the user the first time; most (Chrome,
    // Edge) grant silently based on engagement heuristics. We don't gate on
    // the result — just ask once per app load.
    await navigator.storage.persist();
  } catch {
    // No-op; nothing to fall back to.
  }
}
