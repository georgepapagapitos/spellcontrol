/**
 * SSR-guarded, try/catch-wrapped localStorage reader.
 *
 * @param key      - localStorage key to read
 * @param parse    - transform the raw string into T (throw to trigger fallback)
 * @param fallback - returned when the key is absent, the parse throws, or
 *                   localStorage is unavailable
 */
export function readLocalStorage<T>(key: string, parse: (raw: string) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return parse(raw);
  } catch {
    /* ignore – SSR / private-browsing / quota errors */
  }
  return fallback;
}
