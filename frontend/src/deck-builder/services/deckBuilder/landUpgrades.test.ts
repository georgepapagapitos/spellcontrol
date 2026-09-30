import { describe, it, expect } from 'vitest';
import { computeLandUpgrades, isUtilityLand, landSlotMerit } from './landUpgrades';
import type { ScryfallCard } from '@/deck-builder/types';
import { COACH_CARDS } from './__fixtures__/coach-cards.fixtures';

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

// Guard (T171 lane M): a land swap is a real upgrade for THIS deck. Lane L's
// harness applied 97 land swaps that were downgrades: Evolving Wilds, Ash
// Barrens, Escape Tunnel and the Panoramas came in, and Yavimaya, Castle
// Garenbrig, Takenuma and Reliquary Tower went out. Real cards, Scryfall's
// 2026-09-29 bulk.
describe('computeLandUpgrades — real cards (T171)', () => {
  const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
  const BG = new Set(['B', 'G']);
  const G = new Set(['G']);
  const spells = ['Murder', 'Harmonize', 'Beast Within', 'Doom Blade'].map(real);
  const basicFetchers = ['Evolving Wilds', 'Escape Tunnel', 'Jund Panorama', 'Ash Barrens'];

  it('never offers a land that only fetches a basic as the upgrade', () => {
    const deck = [real('Swamp'), real('Swamp'), real('Forest'), real('Forest'), ...spells];
    const moves = computeLandUpgrades(deck, BG, basicFetchers.map(real), new Set());
    expect(moves).toEqual([]);
  });

  it('never cuts a utility land for a fixer', () => {
    const utility = [
      'Yavimaya, Cradle of Growth',
      'Castle Garenbrig',
      'Takenuma, Abandoned Mire',
      'Reliquary Tower',
    ].map(real);
    for (const u of utility) expect(isUtilityLand(u), u.name).toBe(true);
    const moves = computeLandUpgrades(
      [...utility, ...spells],
      BG,
      [real('Overgrown Tomb'), real('Woodland Cemetery'), real('Command Tower')],
      new Set()
    );
    expect(moves).toEqual([]);
  });

  it('swaps a land that only fetches a basic for an untapped dual', () => {
    const deck = [real('Evolving Wilds'), real('Forest'), real('Swamp'), ...spells];
    const moves = computeLandUpgrades(deck, BG, [real('Overgrown Tomb')], new Set());
    expect(moves.map((m) => [m.outName, m.inName])).toContainEqual([
      'Evolving Wilds',
      'Overgrown Tomb',
    ]);
  });

  it('reads the tapped sentence itself: Public Thoroughfare and Shimmerdrift Vale enter tapped', () => {
    const deck = [real('Swamp'), real('Forest'), ...spells];
    const tapped = computeLandUpgrades(
      deck,
      BG,
      [real('Public Thoroughfare'), real('Shimmerdrift Vale'), real('Jungle Hollow')],
      new Set()
    );
    expect(tapped).toEqual([]);
    // A shockland's "If you don't, it enters tapped" is a condition.
    const shock = computeLandUpgrades(deck, BG, [real('Overgrown Tomb')], new Set());
    expect(shock).toHaveLength(1);
  });

  it('never offers mana it can only spend on some spells (Cavern of Souls)', () => {
    const deck = [real('Forest'), real('Forest'), ...spells];
    expect(computeLandUpgrades(deck, G, [real('Cavern of Souls')], new Set())).toEqual([]);
  });

  it('reads a land that fetches a basic as one basic, not every color it finds', () => {
    expect(landSlotMerit(real('Evolving Wilds'), BG)).toBeLessThan(
      landSlotMerit(real('Swamp'), BG)
    );
    expect(landSlotMerit(real('Overgrown Tomb'), BG)).toBeGreaterThan(
      landSlotMerit(real('Golgari Rot Farm'), BG)
    );
  });

  it('keeps two basics per basic fetcher in the deck', () => {
    const deck = [real('Forest'), real('Forest'), real('Cultivate'), real('Murder')];
    // Cultivate needs its basics: nothing to swap.
    expect(computeLandUpgrades(deck, BG, [real('Overgrown Tomb')], new Set())).toEqual([]);
  });

  it('swaps a channel land in for the basic of its color', () => {
    const deck = [real('Swamp'), real('Swamp'), real('Murder'), real('Harmonize')];
    const moves = computeLandUpgrades(deck, BG, [real('Takenuma, Abandoned Mire')], new Set());
    expect(moves.map((m) => [m.outName, m.inName])).toEqual([
      ['Swamp', 'Takenuma, Abandoned Mire'],
    ]);
  });

  // T171 re-gate: Path of Ancestry went out for Reflecting Pool in a Lathril
  // elves deck that plays it in over half its lists.
  it("never swaps out a land this commander's decks play at the staple line", () => {
    const deck = [real('Path of Ancestry'), real('Murder'), real('Harmonize')];
    const pool = [real('Reflecting Pool')];
    const swap = computeLandUpgrades(deck, BG, pool, new Set());
    expect(swap.map((m) => m.outName)).toEqual(['Path of Ancestry']);
    const onPage = { 'Path of Ancestry': 56 };
    expect(computeLandUpgrades(deck, BG, pool, new Set(), {}, onPage)).toEqual([]);
  });
});
