// A deploy replaces every hashed chunk. A tab opened before it still points
// at the old names, so its next lazy page import 404s and throws. Re-rendering
// can never fix that (the import is the thing that's gone); only a reload,
// which fetches the new index.html, can. Each browser words the error
// differently: Chromium "Failed to fetch dynamically imported module",
// Firefox "error loading dynamically imported module", Safari "Importing a
// module script failed".
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i;

const KEY = 'sc-chunk-reload-at';
const WINDOW_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR.test(text);
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
  window.location.reload();
  return true;
}
