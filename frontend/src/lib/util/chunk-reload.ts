// A deploy replaces every hashed chunk. A tab opened before it still points
// at the old names, so its next lazy page import 404s and throws. Re-rendering
// can never fix that (the import is the thing that's gone); only a reload,
// which fetches the new index.html, can. Each browser words the error
// differently: Chromium "Failed to fetch dynamically imported module",
// Firefox "error loading dynamically imported module", Safari "Importing a
// module script failed". Vite's own preload helper throws "Unable to preload
// CSS for /assets/<chunk>.css" when the page's stylesheet is the missing file,
// which is the most common of them in production.
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS for|ChunkLoadError/i;

const KEY = 'sc-chunk-reload-at';
const WINDOW_MS = 60_000;

/** Set once this page has asked for a reload; it lasts until the page unloads. */
let reloading = false;

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR.test(text);
}

/** True once a reload for the new build is under way: the page is about to go. */
export function isReloadingForNewBuild(): boolean {
  return reloading;
}

/**
 * Reloads the page once to pick up the new build. Returns false, without
 * reloading, if it already did so in the last minute (the chunk is missing
 * for some other reason, and a loop would be worse than the error screen) or
 * if sessionStorage is unavailable to remember that.
 */
export function reloadForNewBuild(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (last && now - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  reloading = true;
  window.location.reload();
  return true;
}

/**
 * The one entry point every path uses: true when `error` is a chunk load
 * error that a reload is now fixing (this call started it, or an earlier path
 * for the same failure did). One failed import can surface up to three times
 * (the preload event, then the rejection or the error boundary), and only the
 * first may spend the once-a-minute reload.
 */
export function recoverFromChunkError(error: unknown): boolean {
  return isChunkLoadError(error) && (reloading || reloadForNewBuild());
}

/**
 * Window listeners for the two paths the error boundary never sees. Installed
 * by installErrorReporting() ahead of its own listeners, so a reload is
 * already under way by the time the beacon looks at the error.
 *
 * - `vite:preloadError`: Vite's import helper fires it for every failed lazy
 *   import, including one whose caller catches the rejection itself. The
 *   event is left uncancelled on purpose: cancelling makes the import resolve
 *   to undefined, which the page would then render as a different crash in
 *   the moment before the reload lands.
 * - `unhandledrejection`: a failed import nobody awaited inside React. Once a
 *   reload is under way it is cancelled, so the console stays quiet.
 */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (e) => {
    recoverFromChunkError((e as Event & { payload?: unknown }).payload);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (recoverFromChunkError(e.reason)) e.preventDefault();
  });
}

/** Test seam: forget that this page asked for a reload. */
export function _resetForTests(): void {
  reloading = false;
}
