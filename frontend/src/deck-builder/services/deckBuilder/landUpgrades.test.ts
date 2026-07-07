import { describe, it, expect } from 'vitest';
import { computeLandUpgrades } from './landUpgrades';
import type { ScryfallCard } from '@/deck-builder/types';

const card = (p: Partial<ScryfallCard>): ScryfallCard =>
  ({ name: 'x', cmc: 2, ...p }) as ScryfallCard;
const WU = new Set(['W', 'U']);

const plains = () =>
  card({ name: 'Plains', type_line: 'Basic Land — Plains', produced_mana: ['W'] });
const island = () =>
  card({ name: 'Island', type_line: 'Basic Land — Island', produced_mana: ['U'] });
// blue-heavy spells → the deck leans on U, so W-only sources look fine and a
// second color of fixing is welcome.
const blueSpell = () => card({ name: 'Counterspell', mana_cost: '{U}{U}', type_line: 'Instant' });
const wuDual = (name = 'Owned WU Dual') =>
  card({
    name,
    type_line: 'Land — Plains Island',
    produced_mana: ['W', 'U'],
    oracle_text: '{T}: Add {W} or {U}.',
  });
const monoRedLand = () => card({ name: 'Owned Red Land', type_line: 'Land', produced_mana: ['R'] });

describe('computeLandUpgrades', () => {
  it('swaps a basic for a stronger dual, flagged owned when the user has it', () => {
    const deck = [plains(), plains(), island(), blueSpell(), blueSpell()];
    const moves = computeLandUpgrades(deck, WU, [wuDual()], new Set(['Owned WU Dual']));
    expect(moves).toHaveLength(1);
    expect(moves[0].outName).toBe('Plains');
    expect(moves[0].inName).toBe('Owned WU Dual');
    expect(moves[0].owned).toBe(true);
    expect(moves[0].inScore).toBeGreaterThan(moves[0].outScore);
  });

  it('flags an unowned candidate as an acquire (owned=false)', () => {
    const deck = [plains(), plains(), island(), blueSpell(), blueSpell()];
    // Not in ownedNames → a dual worth acquiring.
    const moves = computeLandUpgrades(deck, WU, [wuDual('Fetchable Dual')], new Set());
    expect(moves).toHaveLength(1);
    expect(moves[0].inName).toBe('Fetchable Dual');
    expect(moves[0].owned).toBe(false);
    expect(moves[0].reason.toLowerCase()).toContain('acquir');
  });

  it('prefers an owned land over an unowned one of comparable merit', () => {
    const deck = [plains(), blueSpell(), blueSpell()];
    const owned = wuDual('Owned Dual');
    const unowned = wuDual('Unowned Dual'); // same merit score
    const moves = computeLandUpgrades(deck, WU, [unowned, owned], new Set(['Owned Dual']));
    expect(moves).toHaveLength(1);
    expect(moves[0].inName).toBe('Owned Dual'); // owned wins the tie
    expect(moves[0].owned).toBe(true);
  });

  it('never proposes a swap that drops a color (no regression)', () => {
    // The only candidate makes red — it can't replace a Plains without losing W.
    const deck = [plains(), island(), blueSpell()];
    expect(computeLandUpgrades(deck, WU, [monoRedLand()], new Set())).toHaveLength(0);
  });

  it('ignores lands already in the deck and returns [] with no candidates', () => {
    const deck = [plains(), wuDual(), blueSpell()];
    // wuDual is already in the deck, so it's not a candidate.
    expect(computeLandUpgrades(deck, WU, [wuDual()], new Set())).toHaveLength(0);
  });

  it('does not cut an already-strong land', () => {
    // Deck is all strong duals; a mediocre land shouldn't displace them.
    const deck = [wuDual(), wuDual(), blueSpell()];
    const mediocre = card({
      name: 'Tapped Gate',
      type_line: 'Land',
      produced_mana: ['W', 'U'],
      oracle_text: 'This land enters the battlefield tapped.',
    });
    expect(computeLandUpgrades(deck, WU, [mediocre], new Set())).toHaveLength(0);
  });
});
