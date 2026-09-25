import type { GameRecord } from '@/lib/game-state';
import { HORDE_CATALOG } from '@/lib/horde/catalog';

/** Per-horde co-op tally: how a player's table has fared against one horde
 *  deck across every recorded game (local device or synced from the server). */
export interface HordeRecordRow {
  /** Which horde deck, per `GameRecord.hordeId`. A game recorded without one
   *  (no host-chosen name) groups under this fallback key. */
  hordeId: string;
  won: number;
  lost: number;
  played: number;
  winRate: number;
  lastPlayedAt: number;
}

const UNKNOWN_HORDE = 'Unknown horde';

/**
 * Aggregate co-op win/loss per horde deck. Only `format === 'horde'` games
 * with a recorded `coopOutcome` count — a horde game predating that field, or
 * one still missing an outcome, contributes nothing rather than a false loss.
 */
export function aggregateHordeRecords(history: GameRecord[]): HordeRecordRow[] {
  const byHorde = new Map<string, HordeRecordRow>();
  for (const rec of history) {
    if (rec.format !== 'horde' || !rec.coopOutcome) continue;
    const key = rec.hordeId ?? UNKNOWN_HORDE;
    const cur = byHorde.get(key) ?? {
      hordeId: key,
      won: 0,
      lost: 0,
      played: 0,
      winRate: 0,
      lastPlayedAt: 0,
    };
    cur.played += 1;
    cur.lastPlayedAt = Math.max(cur.lastPlayedAt, rec.endedAt);
    if (rec.coopOutcome === 'won') cur.won += 1;
    else cur.lost += 1;
    byHorde.set(key, cur);
  }
  const rows = Array.from(byHorde.values());
  for (const r of rows) r.winRate = r.played > 0 ? r.won / r.played : 0;
  rows.sort((a, b) => b.played - a.played || b.winRate - a.winRate);
  return rows;
}

/**
 * The result line a co-op Horde game shows in Play history, where a PvP game
 * shows "Winner: …". A co-op game has no winning seat, so without this every
 * Horde result read "No winner recorded", won or lost. Null for any record
 * that isn't a finished Horde game.
 */
export function coopResultLabel(
  rec: Pick<GameRecord, 'format' | 'coopOutcome' | 'hordeId'>
): string | null {
  if (rec.format !== 'horde' || !rec.coopOutcome) return null;
  const name = HORDE_CATALOG.find((h) => h.id === rec.hordeId)?.name;
  const horde = name ? `the ${name} horde` : 'the horde';
  return rec.coopOutcome === 'won' ? `Survivors beat ${horde}` : `Overrun by ${horde}`;
}
