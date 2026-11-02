import type { PlayerDeckFacts } from '@spellcontrol/game-core';
import type { Deck } from '@/store/decks';
import { assemblyClockAsync } from '@/lib/mana-sim/clock';
import { toClockLibrary } from '@/lib/mana-sim/hand-classify';
import { speedPathOf } from '@/lib/mana-sim/speed-path';

/**
 * The pod sheet: what each seat's deck says about itself, side by side, so a
 * table can see a mismatch before the first shuffle. Every number here is
 * computed on the device that owns the deck and published with the seat, so a
 * seat only ever shows what its owner sent (a friend's or starter deck sends
 * nothing and reads as unknown, never as zero).
 */

/** The counts from the deck's last bracket estimate, or null when it has none. */
export function deckFactsOf(
  deck: Pick<Deck, 'bracketEstimation'>,
  winTurn: number | null = null
): PlayerDeckFacts | null {
  const b = deck.bracketEstimation?.breakdown;
  if (!b) return null;
  return { gameChangers: b.gameChangerCount, combos: b.twoCardComboCount, winTurn };
}

/**
 * The median turn the deck's win path comes online, from the same seeded
 * assembly clock the deck page quotes. Null when the deck has no win path to
 * time, or the median falls past the clock's horizon (it would read as a turn
 * the deck never reaches).
 */
export async function winTurnOf(
  deck: Pick<Deck, 'cards' | 'winConditions'>
): Promise<number | null> {
  const path = speedPathOf(deck.winConditions);
  if (!path || deck.cards.length === 0) return null;
  const clock = await assemblyClockAsync(
    toClockLibrary(deck.cards.map((c) => c.card)),
    path.assembly,
    { iterations: 1000, wildcards: [...path.tutors] }
  );
  if (!clock) return null;
  if (clock.horizon !== undefined && clock.typicalTurn > clock.horizon) return null;
  return clock.typicalTurn;
}

/** "2 Game Changers", "1 combo": the counts said the way a pod says them. */
export function gameChangersLabel(n: number): string {
  return n === 1 ? '1 Game Changer' : `${n} Game Changers`;
}
export function combosLabel(n: number): string {
  return n === 1 ? '1 combo' : `${n} combos`;
}
export function winTurnLabel(turn: number): string {
  return `Win path by turn ${turn}`;
}

export interface BracketSpread {
  low: number;
  high: number;
}

/**
 * Set when the seated brackets sit more than one apart (a 2 and a 4 is a
 * mismatch; a 3 and a 4 is a normal table). Seats with no known bracket are
 * left out, and fewer than two known brackets can't differ.
 */
export function bracketSpread(
  brackets: ReadonlyArray<number | null | undefined>
): BracketSpread | null {
  const known = brackets.filter((b): b is number => b != null);
  if (known.length < 2) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  return high - low > 1 ? { low, high } : null;
}
