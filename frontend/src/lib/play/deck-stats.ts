import type { GameRecord } from '@spellcontrol/game-core';
import { seatCountsForDeck } from './table-read';

/**
 * Decided games a deck (or a player) needs before a win rate is shown.
 *
 * Below it the record still shows (3W-1L is a fact), but a percentage does not:
 * 1 win in 1 game reads "100%", and at 4 games one result moves the figure 25
 * points. Five is where a rate stops swinging by 20 or more points on a single
 * game, and it is reachable inside a season by a pod that plays weekly, which
 * a floor of ten (the Bracket panel's verdict floor, `TABLE_READ_MIN_GAMES`)
 * mostly is not. That verdict is a stronger claim (above or below an even
 * share), so it keeps its higher floor; this one only gates a plain percentage.
 */
export const DECK_RATE_MIN_GAMES = 5;

/** Wins over decided games, or null while the sample is under the floor. */
export function rateAboveFloor(wins: number, losses: number): number | null {
  const decided = wins + losses;
  return decided >= DECK_RATE_MIN_GAMES ? wins / decided : null;
}

/** "60%", or the placeholder while the sample is under the floor. */
export function formatRate(wins: number, losses: number, placeholder = '—'): string {
  const rate = rateAboveFloor(wins, losses);
  return rate === null ? placeholder : `${Math.round(rate * 100)}%`;
}

export interface PilotRow {
  /** Account id when the seat had one, else the lower-cased seat name. */
  key: string;
  name: string;
  isYou: boolean;
  played: number;
  wins: number;
  losses: number;
}

/**
 * Who sat behind this deck. A seat's player is its pilot: a borrowed deck is a
 * deck in a seat whose player is someone else (a guest, or a friend), so the
 * seat already says who piloted it and no second field is stored. Counted by
 * the same rule as the deck's own record, so the rows add up to it.
 */
export function deckPilots(
  history: GameRecord[],
  deckId: string,
  userId: string | null
): PilotRow[] {
  const byPilot = new Map<string, PilotRow>();
  for (const rec of history) {
    for (const p of rec.players) {
      if (p.deckId !== deckId || !seatCountsForDeck(rec, p, userId)) continue;
      const key = p.userId ?? `name:${p.name.trim().toLowerCase()}`;
      const cur = byPilot.get(key) ?? {
        key,
        name: p.name,
        isYou: userId !== null && p.userId === userId,
        played: 0,
        wins: 0,
        losses: 0,
      };
      cur.played += 1;
      if (rec.winnerSeat !== null) {
        if (rec.winnerSeat === p.seat) cur.wins += 1;
        else cur.losses += 1;
      }
      byPilot.set(key, cur);
    }
  }
  return [...byPilot.values()].sort(
    (a, b) => Number(b.isYou) - Number(a.isYou) || b.played - a.played
  );
}
