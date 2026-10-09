/**
 * Run an IndexedDB open so the page cannot freeze into the back/forward cache
 * while the open is still in flight.
 *
 * Why: on a fresh profile the first open creates the database, and the
 * `upgradeneeded` callback has to run in THIS document. If the user navigates
 * away in the few milliseconds before it fires, the browser freezes the
 * document in bfcache with the version-change transaction still pending, and
 * every later open of that database from any tab hangs until the frozen page
 * is evicted or closed (E588: sync never started, "Loading your collection…"
 * forever, no error). A page holding a Web Lock is not bfcache-eligible, so
 * the lock is held exactly while the open is pending and released the moment
 * it settles. Without Web Locks the open runs as before.
 */
const LOCK_NAME = 'sc-idb-open';

export function openWithoutBfcache<T>(open: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return open();
  return new Promise<T>((resolve, reject) => {
    // 'shared' so concurrent opens of different databases don't queue behind
    // each other; the lock only exists to be held.
    locks.request(LOCK_NAME, { mode: 'shared' }, () => open().then(resolve, reject)).catch(reject);
  });
}
