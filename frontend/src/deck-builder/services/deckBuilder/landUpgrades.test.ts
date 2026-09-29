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
    expect(moves[0].reason.toLowerCase()).toContain('not owned');
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

  it('rejects a candidate whose own identity escapes the deck (off-color dual)', () => {
    // A UR dual produces usable U in a WU deck (so the color clamp passes it),
    // but its identity includes R — not Commander-legal here.
    const deck = [island(), island(), blueSpell(), blueSpell()];
    const urDual = card({
      name: 'Steam Vents',
      type_line: 'Land — Island Mountain',
      produced_mana: ['U', 'R'],
      color_identity: ['U', 'R'],
      oracle_text: '{T}: Add {U} or {R}.',
    });
    expect(computeLandUpgrades(deck, WU, [urDual], new Set(['Steam Vents']))).toHaveLength(0);
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

  it('reads a painland without produced_mana as both its colors (no phantom "adds red")', () => {
    // Deck cards mapped from EnrichedCard lack produced_mana; "Add {B} or {R}"
    // must not be read as black only, or a basic-fetch claims to add red over it.
    const WBR = new Set(['W', 'B', 'R']);
    const springs = card({
      name: 'Sulfurous Springs',
      type_line: 'Land',
      oracle_text: '{T}: Add {C}.\n{T}: Add {B} or {R}. This land deals 1 damage to you.',
    });
    const passage = card({
      name: 'Elven Passage',
      type_line: 'Land',
      oracle_text:
        '{T}, Pay 1 life, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    const spell = card({ name: 'Spell', mana_cost: '{W}{B}{R}', type_line: 'Instant' });
    const moves = computeLandUpgrades([springs, spell], WBR, [passage], new Set(['Elven Passage']));
    for (const m of moves) {
      expect(m.addsColors).not.toContain('R');
      expect(m.addsColors).not.toContain('B');
    }
  });
});
