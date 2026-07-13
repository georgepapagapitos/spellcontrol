/**
 * Device-local playtest session history (E141) — per-deck append-only log of
 * `PlaytestSessionRecord`s backing cross-session analytics.
 *
 * Deliberately NOT the sync path, same reasoning as `session-snapshot.ts`:
 * this is scratch/ephemeral play data, never synced, device-local only (see
 * `project_offline_vs_sync_caches`). One key per deck, capped at
 * `MAX_RECORDS` (oldest pruned first); corrupt or malformed data is discarded
 * silently rather than surfacing an error.
 */

import type { PlaytestSessionRecord } from './session-record';

const KEY_PREFIX = 'spellcontrol:playtest-history:';
const MAX_RECORDS = 50;

function isValidRecord(v: unknown): v is PlaytestSessionRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.deckId === 'string' &&
    typeof r.endedAt === 'number' &&
    typeof r.turns === 'number' &&
    typeof r.mulligans === 'number' &&
    (r.killTurn === null || typeof r.killTurn === 'number') &&
    typeof r.opponentCount === 'number' &&
    typeof r.opponentsDefeated === 'number' &&
    typeof r.resistance === 'boolean' &&
    typeof r.resistanceCounters === 'number' &&
    typeof r.resistanceRemovals === 'number' &&
    typeof r.resistanceBounces === 'number' &&
    typeof r.resistanceWipesSurvived === 'number' &&
    typeof r.landDropsHit === 'number' &&
    typeof r.landDropsMissed === 'number' &&
    typeof r.landDropTurnsChecked === 'number' &&
    (r.cardsDrawn === null || typeof r.cardsDrawn === 'number')
  );
}

/** Loads a deck's session history. Never throws — missing, corrupt, or
 *  malformed data reads as an empty list. */
export function loadSessionHistory(deckId: string): PlaytestSessionRecord[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY_PREFIX + deckId);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord);
  } catch {
    return [];
  }
}

/**
 * Appends `record` to `deckId`'s history, pruning to the most recent
 * `MAX_RECORDS` (oldest dropped first). Any pre-existing corrupt data is
 * discarded rather than blocking the append. Returns the updated list.
 */
export function appendSessionRecord(
  deckId: string,
  record: PlaytestSessionRecord
): PlaytestSessionRecord[] {
  const updated = [...loadSessionHistory(deckId), record].slice(-MAX_RECORDS);
  try {
    localStorage.setItem(KEY_PREFIX + deckId, JSON.stringify(updated));
  } catch {
    /* storage unavailable/full — best-effort persistence, drop silently */
  }
  return updated;
}
