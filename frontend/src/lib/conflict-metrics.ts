import { logger } from './logger';

const COUNT_KEY = 'spellcontrol-deck-conflict-count';

/**
 * How many deck push-conflicts this device has ever hit — a localStorage
 * counter + a log line, not an analytics pipeline (E170). The call to keep
 * whole-deck last-write-wins (over a per-slot `deckSlot` schema) rests on
 * "revisit if evidence shows real loss"; this is that evidence. Called once
 * per conflicting deck row from `applyPushResult` (lib/sync.ts), regardless
 * of whether that conflict gets the diff panel or falls back to a toast.
 */
export function recordDeckConflict(deckId: string): number {
  let n = 1;
  try {
    n = Number(localStorage.getItem(COUNT_KEY) ?? '0') + 1;
    localStorage.setItem(COUNT_KEY, String(n));
  } catch {
    /* best-effort — a private-mode localStorage failure shouldn't break sync */
  }
  logger.warn('[sync] deck push conflict', { deckId, totalConflicts: n });
  return n;
}

/** Lifetime conflict count for this device. Exposed for tests / future surfacing. */
export function getDeckConflictCount(): number {
  try {
    return Number(localStorage.getItem(COUNT_KEY) ?? '0');
  } catch {
    return 0;
  }
}
