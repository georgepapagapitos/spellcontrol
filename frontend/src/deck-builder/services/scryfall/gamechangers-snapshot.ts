/**
 * The last complete live Game Changer list, kept in localStorage so a cold page can
 * score against it at once instead of queueing a Scryfall search behind the other
 * requests on the shared limiter (E1039: that wait was the 14-40 s Coach objective).
 * Only a complete live fetch is written, so the snapshot is never the hardcoded floor.
 */
const KEY = 'sc-game-changers-v1';
/** Past this the snapshot is ignored and the hardcoded list stands in until the live fetch lands. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function readGameChangerSnapshot(now = Date.now()): Set<string> | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      at?: number;
      names?: unknown;
    } | null;
    if (!raw || typeof raw.at !== 'number' || now - raw.at > MAX_AGE_MS) return null;
    if (!Array.isArray(raw.names) || raw.names.length === 0) return null;
    return new Set(raw.names.filter((n): n is string => typeof n === 'string'));
  } catch {
    return null;
  }
}

export function writeGameChangerSnapshot(names: ReadonlySet<string>, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: now, names: [...names] }));
  } catch {
    // Private window or full storage: the next cold page waits on the live fetch, as before.
  }
}
