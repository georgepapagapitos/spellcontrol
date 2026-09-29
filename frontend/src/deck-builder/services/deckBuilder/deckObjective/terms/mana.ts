/**
 * Mana: does the deck cast its spells on time? Read from the goldfish
 * simulator (lib/mana-sim) with the context's FIXED seed, so two decks
 * compared in one context see the same shuffles (common random numbers) and a
 * difference is the manabase, not the dice.
 *
 *   value = CAST_SCALE × castability on curve (per spell copy)
 *         + COMMANDER_SCALE × commander castable on curve (mean over the zone)
 *         − SCREW_SCALE × P(fewer than 3 lands by turn 3)
 *         − FLOOD_SCALE × P(flooded at turn 6)
 *
 * Scales in card-equivalents, chosen so each reads as roughly one card per
 * meaningful change: five points of deck castability (three spells in sixty a
 * turn late) ≈ 1; ten points of commander on-curve ≈ 1; ten points of screw
 * ≈ 1.5 (a missed third drop loses a game more often than a late spell);
 * ten points of flood ≈ 1. Card draw and cost reducers aren't simulated
 * (mana-sim's "not modelled" list), so this is a goldfish, and says so.
 */
import { buildManaDeck, simulateManaDeck, type ManaSimResult } from '@/lib/mana-sim';
import type { CardNote, ObjectiveDeck, ObjectiveContext } from '../types';
import { isLandCard } from '../context';
import { pct, type TermFn } from './shared';

export const CAST_SCALE = 20;
export const COMMANDER_SCALE = 10;
export const SCREW_SCALE = 15;
export const FLOOD_SCALE = 10;

/** Run the goldfish for a deck in this context (fixed seed and games). */
export function simulateDeckMana(deck: ObjectiveDeck, ctx: ObjectiveContext): ManaSimResult {
  const manaDeck = buildManaDeck(
    deck.commanders.map(ctx.manaCardOf),
    deck.cards.map(ctx.manaCardOf)
  );
  return simulateManaDeck(manaDeck, { games: ctx.sim.games, seed: ctx.sim.seed });
}

export const manaTerm: TermFn = (deck, ctx) => {
  const sim = simulateDeckMana(deck, ctx);
  const notes: CardNote[] = [];

  // Spell castability, attributed per distinct spell by its copies.
  const measured = sim.cards.filter((c) => c.onCurve != null);
  const copies = measured.reduce((s, c) => s + c.copies, 0);
  const cast = sim.castability.onCurve ?? 0;
  for (const c of measured) {
    notes.push({
      name: c.name,
      value: (CAST_SCALE * (c.onCurve ?? 0) * c.copies) / Math.max(1, copies),
      note: `castable on curve ${pct(c.onCurve ?? 0)} (turn ${c.mv})`,
    });
  }
  const castValue = copies > 0 ? CAST_SCALE * cast : 0;

  let cmdValue = 0;
  const cmdRates = sim.commanders.filter((c) => c.onCurve != null);
  for (const c of cmdRates) {
    const v = (COMMANDER_SCALE * (c.onCurve ?? 0)) / cmdRates.length;
    cmdValue += v;
    notes.push({ name: c.name, value: v, note: `commander on curve ${pct(c.onCurve ?? 0)}` });
  }

  // Screw and flood belong to the land base: split across the land cards.
  const screw = sim.screw.missedDropBy3;
  const flood = sim.flood.rate;
  const landPenalty = SCREW_SCALE * screw + FLOOD_SCALE * flood;
  const lands = deck.cards.filter(isLandCard);
  if (landPenalty > 0 && lands.length === 0) {
    notes.push({
      name: '(no lands)',
      value: -landPenalty,
      note: `no land base: screw ${pct(screw)} by turn 3, flood ${pct(flood)} at turn 6`,
    });
  } else if (landPenalty > 0) {
    const byName = new Map<string, number>();
    for (const l of lands) byName.set(l.name, (byName.get(l.name) ?? 0) + 1);
    for (const [name, n] of byName) {
      notes.push({
        name,
        value: (-landPenalty * n) / lands.length,
        note: `land base: screw ${pct(screw)} by turn 3, flood ${pct(flood)} at turn 6`,
      });
    }
  }

  const value = castValue + cmdValue - landPenalty;
  const commander = cmdRates.map((c) => pct(c.onCurve ?? 0)).join('/');
  const goldfish = `goldfish, ${sim.games} games, seed ${sim.seed}`;
  return {
    value,
    summary: `castable on curve ${pct(cast)}, commander ${commander}, screw ${pct(screw)}, flood ${pct(flood)} (${goldfish})`,
    cards: notes,
  };
};
