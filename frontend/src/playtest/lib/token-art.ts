import { searchTokenArt } from '@/deck-builder/services/scryfall/client';

/**
 * Session-lifetime cache of token-name → resolved art (or null on a miss),
 * keyed case-insensitively so "Treasure" and "treasure" share one lookup.
 * Module-level: survives across every token created in this tab, cleared on
 * reload (no persistence needed — a fresh session just re-resolves).
 */
const cache = new Map<string, Promise<string | null>>();

/** Resolve token art for a display name, in-memory cached for the session. */
export function resolveTokenArt(displayName: string): Promise<string | null> {
  const key = displayName.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  let pending = cache.get(key);
  if (!pending) {
    pending = searchTokenArt(displayName).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

/** Test-only: clear the module-level cache between cases. */
export function __resetTokenArtCacheForTests(): void {
  cache.clear();
}
