import { App as CapacitorApp } from '@capacitor/app';
import { useOfflineStore } from '@/store/offline';
import { isNativePlatform } from '@/lib/platform';

const LAST_CHECK_KEY = 'spellcontrol-offline-last-check';
/**
 * Minimum gap between manifest checks. Short on purpose: the manifest request
 * is tiny and ETag-cached, and `autoSyncOfflineData` also runs on every app
 * resume — so a server-side data fix reaches an actively-used device within a
 * few hours without the user ever touching a setting.
 */
const MIN_RECHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Silently keep the local card catalog + combo dataset fresh in the
 * background. Called from `App.tsx` whenever the auth store flips to
 * `authed`.
 *
 * **Native-only.** The bundled Android/iOS app has no live backend at the
 * relative `/api/*` paths it would otherwise reach, so a populated local
 * cache is the only way the deck builder and combo matcher work offline.
 * In the browser the backend is always one round-trip away, so the silent
 * ~30 MB IDB seed is pure bandwidth tax — we skip it entirely on web.
 *
 * Two passes when we do run:
 *
 *   1. **Bootstrap.** Hydrate the in-memory store from IndexedDB so the
 *      Scryfall/combos read paths can short-circuit immediately. Cheap; runs
 *      every authed mount.
 *   2. **Refresh.** Triggered when local IDB has no card rows (first
 *      sign-in OR the OS evicted the database — iOS Safari purges IDB
 *      after ~14 days of inactivity) OR the last successful manifest check
 *      is older than `MIN_RECHECK_INTERVAL_MS`. The server-side manifest
 *      endpoint is cheap (~5min Cache-Control) and the bulk endpoint
 *      short-circuits on ETag, so an up-to-date device pays one tiny
 *      HEAD-ish request and nothing else.
 *
 * Runs on every authed mount AND on every app resume (see
 * `registerOfflineSyncOnResume`), so a server-side data fix propagates to an
 * active device within `MIN_RECHECK_INTERVAL_MS` — no user action needed.
 *
 * Critically, the data-availability check looks at the *actual* IDB card
 * count (`stats.cardCount`), not the manifest. A leftover manifest from a
 * partial eviction would otherwise hide the fact that the cards are gone.
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
  if (!isNativePlatform()) return;

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
  const localCardCount = fresh.stats?.cardCount ?? 0;
  const hasLocalData = localCardCount > 0;
  const lastCheck = readLastCheck();
  const stale = !lastCheck || Date.now() - lastCheck > MIN_RECHECK_INTERVAL_MS;

  if (!hasLocalData) {
    // A manifest without cards is the eviction tell — IDB was wiped but the
    // zustand persist (or a stale read) left the manifest behind. Logged
    // separately so the cause is obvious in DevTools.
    if (fresh.manifest && fresh.manifest.oracleCardCount > 0) {
      console.info('[offline] cache miss (manifest present, no cards in IDB) — re-downloading');
    } else {
      console.info('[offline] no local card data — downloading');
    }
  } else if (stale) {
    console.info('[offline] cache stale — checking for a newer manifest');
  }

  if (!hasLocalData || stale) {
    try {
      await fresh.sync();
      writeLastCheck(Date.now());
    } catch {
      // sync() already records errors on the store; swallow here.
    }
  }
}

/**
 * Register a Capacitor `resume` listener that re-runs `autoSyncOfflineData`
 * whenever the app returns to the foreground. Combined with the short
 * `MIN_RECHECK_INTERVAL_MS` throttle this keeps the local catalog fresh
 * without the user ever asking — the cold-mount check alone could leave a
 * long-lived session stuck on stale data.
 *
 * Native-only and idempotent (the throttle no-ops resumes that are too close
 * together). Returns a cleanup function for the caller's effect teardown.
 */
export function registerOfflineSyncOnResume(): () => void {
  if (!isNativePlatform()) return () => {};
  const handle = CapacitorApp.addListener('resume', () => {
    void autoSyncOfflineData();
  });
  return () => {
    void handle.then((h) => h.remove());
  };
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
