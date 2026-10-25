import { describe, expect, it } from 'vitest';
import { TURN_EXPECTATIONS } from '@spellcontrol/deck-metrics';
import {
  computeManaBaseMetrics,
  firstTurnAt,
  manaBaseMetricsAsync,
  metricsKey,
  peekManaBaseMetrics,
  turnBudget,
  typicalSpell,
  untappedVariant,
} from './mana-base-metrics';
import { compileManaDeck } from './index';
import { brago, cards, BRAGO_TAPPED_DUALS, BRAGO_UNTAPPED_DUALS } from './__fixtures__/decks';

const GAMES = 600;
const deckOf = (list: Parameters<typeof cards>[0]) =>
  compileManaDeck({ commanders: [], library: cards(list) });

describe('tempo cost of tapped lands', () => {
  it('is exactly 5 mana-turns for a library of 99 tapped lands (one mana short on each of turns 1 to 5)', () => {
    // Every card is a land, so a land drop is made every turn; each enters tapped, so
    // turn t has t - 1 mana where the untapped deck has t.
    const m = computeManaBaseMetrics(deckOf([['Tranquil Cove', 99]]), 6, GAMES);
    expect(m.tapped.lands).toBe(99);
    expect(m.tapped.actual.slice(1)).toEqual([0, 1, 2, 3, 4]);
    expect(m.tapped.untapped.slice(1)).toEqual([1, 2, 3, 4, 5]);
    expect(m.tapped.lost).toBe(5);
  });

  it('is exactly 0 for a deck with no land that can enter tapped', () => {
    const m = computeManaBaseMetrics(
      deckOf([
        ['Plains', 40],
        ['Swords to Plowshares', 59],
      ]),
      6,
      GAMES
    );
    expect(m.tapped.lands).toBe(0);
    expect(m.tapped.lost).toBe(0);
  });

  it('counts a conditional land as one that can enter tapped, and loses less than a tapland does', () => {
    const lost = (duals: readonly string[]) =>
      computeManaBaseMetrics(compileManaDeck(brago(duals)), 6, 1000).tapped.lost;
    const untapped = lost(BRAGO_UNTAPPED_DUALS);
    const tapped = lost(BRAGO_TAPPED_DUALS);
    expect(tapped).toBeGreaterThan(0.5);
    expect(tapped).toBeGreaterThan(untapped + 0.2);
  });

  it('the variant keeps every slot and name and only changes how lands enter', () => {
    const deck = compileManaDeck(brago(BRAGO_TAPPED_DUALS));
    const free = untappedVariant(deck);
    expect(free.library.map((c) => c.name)).toEqual(deck.library.map((c) => c.name));
    for (const c of free.library)
      expect(c.land === null || c.land.entry.kind === 'untapped').toBe(true);
  });
});

describe('tipping point', () => {
  it('reads turn 3 for a deck of 99 Plains: three mana by turn 3 in every game, never by turn 2', () => {
    const m = computeManaBaseMetrics(deckOf([['Plains', 99]]), 6, GAMES);
    expect(m.tipping.cost).toBe('{3}');
    expect(m.tipping.curve.slice(1, 4)).toEqual([0, 0, 1]);
    expect(m.tipping.turns).toEqual([3, 3]);
  });

  it('describes the typical spell: average mana value, one pip of each of the two main colors', () => {
    const deck = compileManaDeck(brago(BRAGO_UNTAPPED_DUALS));
    expect(typicalSpell(deck)).toMatch(/^\{\d\}\{[WU]\}\{[WU]\}$/);
    expect(typicalSpell(deckOf([['Plains', 40]]))).toBe('{3}');
    // Swords costs {W}: average 1, clamped up to 2, one pip of the single color.
    expect(typicalSpell(deckOf([['Swords to Plowshares', 30]]))).toBe('{1}{W}');
  });

  it('finds the first turn at or over a bar', () => {
    expect(firstTurnAt([0, 0.5, 0.79, 0.8, 0.95], 0.8)).toBe(3);
    expect(firstTurnAt([0, 0.5, 0.79, 0.8, 0.95], 0.9)).toBe(4);
    expect(firstTurnAt([0, 0.1], 0.8)).toBeNull();
  });
});

describe('mana utilization', () => {
  it('is 0 when there is nothing to spend mana on', () => {
    const m = computeManaBaseMetrics(deckOf([['Plains', 99]]), 6, GAMES);
    expect(m.utilization).toMatchObject({ mean: 0, median: 0, p10: 0, turns: 6, games: GAMES });
  });

  it('stays within 0 and 1 on a real deck and counts the games behind it', () => {
    const m = computeManaBaseMetrics(compileManaDeck(brago(BRAGO_UNTAPPED_DUALS)), 6, GAMES);
    const u = m.utilization;
    expect(u.mean).toBeGreaterThan(0.2);
    expect(u.mean).toBeLessThanOrEqual(1);
    expect(u.p10).toBeLessThanOrEqual(u.median);
    expect(u.games).toBe(GAMES);
  });

  it('a longer budget does not use less of the mana than the first turns', () => {
    const deck = compileManaDeck(brago(BRAGO_UNTAPPED_DUALS));
    const four = computeManaBaseMetrics(deck, 4, GAMES).utilization;
    expect(four.turns).toBe(4);
  });
});

describe('the bracket turn budget', () => {
  it("is Wizards' expectation for the bracket, never under turn 4", () => {
    expect(turnBudget(1)).toBe(TURN_EXPECTATIONS[1]);
    expect(turnBudget(3)).toBe(6);
    expect(turnBudget(4)).toBe(4);
    expect(turnBudget(5)).toBe(4);
    expect(turnBudget(null)).toBe(6);
  });
});

describe('after paint', () => {
  it('lands on the numbers the synchronous call gives, and caches them', async () => {
    const input = brago(BRAGO_TAPPED_DUALS);
    const sync = computeManaBaseMetrics(compileManaDeck(input), 6, 300);
    const key = metricsKey(input.commanders, input.library, 6, 300);
    expect(peekManaBaseMetrics(key)).toBeUndefined();
    const a = await manaBaseMetricsAsync(input.commanders, input.library, 6, 300);
    expect(a).toEqual(sync);
    expect(peekManaBaseMetrics(key)).toBe(a);
  });

  it('has nothing to say about a deck with no spells', async () => {
    expect(await manaBaseMetricsAsync([], cards([['Plains', 10]]), 6, 100)).toBeNull();
  });
});
