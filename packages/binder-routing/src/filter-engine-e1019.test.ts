import { describe, it, expect } from 'vitest';
import { colorSelectionMatches, getColorKey, parseColorMatchMode } from './colors.js';
import { cardMatchesFilter, isFilterEmpty } from './rules.js';
import { compileManaSymbols, manaCostMatches, type ManaSymbolQuery } from './mana-cost.js';
import type { BinderFilter, EnrichedCard } from './types.js';

/**
 * Real Scryfall data for every named card here (mana_cost, cmc, color_identity,
 * type_line as printed), per the repo's real-oracle fixture rule.
 */
function card(over: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'x',
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'id',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...over,
  };
}

const LIGHTNING_HELIX = card({
  name: 'Lightning Helix',
  typeLine: 'Instant',
  manaCost: '{R}{W}',
  cmc: 2,
  colors: ['R', 'W'],
  colorIdentity: ['R', 'W'],
});
const SWORDS = card({
  name: 'Swords to Plowshares',
  typeLine: 'Instant',
  manaCost: '{W}',
  cmc: 1,
  colors: ['W'],
  colorIdentity: ['W'],
});
const BOLT = card({
  name: 'Lightning Bolt',
  typeLine: 'Instant',
  manaCost: '{R}',
  cmc: 1,
  colors: ['R'],
  colorIdentity: ['R'],
});
const SOL_RING = card({
  name: 'Sol Ring',
  typeLine: 'Artifact',
  manaCost: '{1}',
  cmc: 1,
  colors: [],
  colorIdentity: [],
});
const VINDICATE = card({
  name: 'Vindicate',
  typeLine: 'Sorcery',
  manaCost: '{1}{W}{B}',
  cmc: 3,
  colors: ['W', 'B'],
  colorIdentity: ['W', 'B'],
});
const WASTES = card({
  name: 'Wastes',
  typeLine: 'Basic Land',
  cmc: 0,
  colors: [],
  colorIdentity: [],
});
const GRAY_MERCHANT = card({
  name: 'Gray Merchant of Asphodel',
  typeLine: 'Creature — Zombie',
  manaCost: '{3}{B}{B}',
  cmc: 5,
  colors: ['B'],
  colorIdentity: ['B'],
});
const KITCHEN_FINKS = card({
  name: 'Kitchen Finks',
  typeLine: 'Creature — Elf Warrior',
  manaCost: '{1}{G/W}{G/W}',
  cmc: 3,
  colors: ['G', 'W'],
  colorIdentity: ['G', 'W'],
});
const GITAXIAN_PROBE = card({
  name: 'Gitaxian Probe',
  typeLine: 'Sorcery',
  manaCost: '{U/P}',
  cmc: 1,
  colors: ['U'],
  colorIdentity: ['U'],
});
const STROKE_OF_GENIUS = card({
  name: 'Stroke of Genius',
  typeLine: 'Instant',
  manaCost: '{X}{2}{U}',
  cmc: 3,
  colors: ['U'],
  colorIdentity: ['U'],
});
const ANCESTRAL_VISION = card({
  name: 'Ancestral Vision',
  typeLine: 'Sorcery',
  cmc: 0,
  colors: ['U'],
  colorIdentity: ['U'],
});
const SNOW_SWAMP = card({
  name: 'Snow-Covered Swamp',
  typeLine: 'Basic Snow Land — Swamp',
  cmc: 0,
  colors: [],
  colorIdentity: ['B'],
});
const FIRE_ICE = card({
  // Split card: faces joined by " // " exactly as backend/src/merge-card.ts builds it.
  name: 'Fire // Ice',
  typeLine: 'Instant // Instant',
  manaCost: '{1}{R} // {1}{U}',
  cmc: 4,
  colors: ['R', 'U'],
  colorIdentity: ['R', 'U'],
});
const DELVER = card({
  // Transform DFC: the back face is costless, joined as "front // ".
  name: 'Delver of Secrets // Insectile Aberration',
  typeLine: 'Creature — Human Wizard // Creature — Human Insect',
  manaCost: '{U} // ',
  cmc: 1,
  colors: ['U'],
  colorIdentity: ['U'],
});
const AGADEEM = card({
  name: 'Agadeem Awakening // Agadeem, the Undercrypt',
  typeLine: 'Sorcery // Land',
  manaCost: '{X}{B}{B}{B}',
  cmc: 3,
  colors: ['B'],
  colorIdentity: ['B'],
});

function within(selected: string[], c: EnrichedCard): boolean {
  return colorSelectionMatches(getColorKey(c), c.colorIdentity ?? [], new Set(selected), 'within');
}

describe("color match mode 'within'", () => {
  it('matches subsets of the selection and colorless cards (Commander colors)', () => {
    const rw = ['R', 'W'];
    expect(within(rw, LIGHTNING_HELIX)).toBe(true);
    expect(within(rw, SWORDS)).toBe(true);
    expect(within(rw, BOLT)).toBe(true);
    expect(within(rw, SOL_RING)).toBe(true);
    expect(within(rw, WASTES)).toBe(true);
    expect(within(rw, VINDICATE)).toBe(false); // black is outside R+W
    expect(within(rw, GRAY_MERCHANT)).toBe(false);
  });

  it('a single color selection admits that mono color and colorless only', () => {
    expect(within(['B'], GRAY_MERCHANT)).toBe(true);
    expect(within(['B'], SOL_RING)).toBe(true);
    expect(within(['B'], VINDICATE)).toBe(false);
    expect(within(['B'], BOLT)).toBe(false);
  });

  it('selecting only C means colorless only', () => {
    expect(within(['C'], SOL_RING)).toBe(true);
    expect(within(['C'], WASTES)).toBe(true);
    expect(within(['C'], BOLT)).toBe(false);
    expect(within(['C'], GRAY_MERCHANT)).toBe(false);
  });

  it('lands bucket by identity: a Snow-Covered Swamp is black, not colorless', () => {
    expect(within(['B'], SNOW_SWAMP)).toBe(true);
    expect(within(['C'], SNOW_SWAMP)).toBe(false);
    expect(within(['R', 'W'], SNOW_SWAMP)).toBe(false);
  });

  it("an empty selection is no constraint, and 'all' / 'any' keep their meaning", () => {
    expect(colorSelectionMatches('C', [], new Set(), 'within')).toBe(true);
    const rw = new Set(['R', 'W']);
    // 'all' is unchanged: exactly R+W, so mono-R and colorless are out.
    expect(colorSelectionMatches('M', ['R', 'W'], rw, 'all')).toBe(true);
    expect(colorSelectionMatches('R', ['R'], rw, 'all')).toBe(false);
    expect(colorSelectionMatches('C', [], rw, 'all')).toBe(false);
    // 'any' is unchanged: shows any selected color.
    expect(colorSelectionMatches('R', ['R'], rw, 'any')).toBe(true);
    expect(colorSelectionMatches('M', ['W', 'B'], rw, 'any')).toBe(true);
  });

  it('treats an unknown-colors card (key ?) as a non-match rather than throwing', () => {
    expect(colorSelectionMatches('?', [], new Set(['R']), 'within')).toBe(false);
  });

  it('runs through a binder colorIdentity rule', () => {
    const f: BinderFilter = { colorIdentity: { colors: ['R', 'W'], mode: 'within' } };
    expect(cardMatchesFilter(LIGHTNING_HELIX, f)).toBe(true);
    expect(cardMatchesFilter(SOL_RING, f)).toBe(true);
    expect(cardMatchesFilter(VINDICATE, f)).toBe(false);
  });

  it('parseColorMatchMode accepts all three modes and falls back on junk', () => {
    expect(parseColorMatchMode('within')).toBe('within');
    expect(parseColorMatchMode('all')).toBe('all');
    expect(parseColorMatchMode('any')).toBe('any');
    expect(parseColorMatchMode('exact')).toBe('any');
    expect(parseColorMatchMode(undefined, 'all')).toBe('all');
  });
});

describe('manaValues (mana value set)', () => {
  const mv = (c: EnrichedCard, manaValues: BinderFilter['manaValues']) =>
    cardMatchesFilter(c, { manaValues });

  it('matches cmc in the value set', () => {
    expect(mv(BOLT, { values: [1, 2] })).toBe(true);
    expect(mv(LIGHTNING_HELIX, { values: [1, 2] })).toBe(true);
    expect(mv(VINDICATE, { values: [1, 2] })).toBe(false);
    expect(mv(WASTES, { values: [0] })).toBe(true);
  });

  it('atLeast adds an open-ended "7+" bucket', () => {
    const f = { values: [1], atLeast: 5 };
    expect(mv(GRAY_MERCHANT, f)).toBe(true); // 5 >= 5
    expect(mv(BOLT, f)).toBe(true); // in set
    expect(mv(VINDICATE, f)).toBe(false); // 3: neither
    expect(mv(card({ name: 'Emrakul, the Aeons Torn', cmc: 15 }), f)).toBe(true);
    expect(mv(GRAY_MERCHANT, { values: [], atLeast: 6 })).toBe(false);
  });

  it('drills into an exact large value', () => {
    const f = { values: [9] };
    expect(mv(card({ name: 'Blightsteel Colossus', cmc: 12 }), f)).toBe(false);
    expect(mv(card({ name: 'Void Winnower', cmc: 9 }), f)).toBe(true);
  });

  it('a card with unknown cmc never matches a constrained set', () => {
    expect(mv(card({ cmc: undefined }), { values: [0] })).toBe(false);
    expect(mv(card({ cmc: undefined }), { values: [], atLeast: 0 })).toBe(false);
  });

  it('ANDs with cmcMin/cmcMax, which keep working', () => {
    expect(cardMatchesFilter(GRAY_MERCHANT, { cmcMin: 4, manaValues: { values: [5] } })).toBe(true);
    expect(cardMatchesFilter(GRAY_MERCHANT, { cmcMax: 4, manaValues: { values: [5] } })).toBe(
      false
    );
    expect(cardMatchesFilter(GRAY_MERCHANT, { cmcMin: 5, cmcMax: 5 })).toBe(true);
  });

  it('empty value sets are no constraint and count as an empty filter', () => {
    expect(mv(card({ cmc: undefined }), { values: [] })).toBe(true);
    expect(isFilterEmpty({ manaValues: { values: [] } })).toBe(true);
    expect(isFilterEmpty({ manaValues: { values: [3] } })).toBe(false);
    expect(isFilterEmpty({ manaValues: { values: [], atLeast: 7 } })).toBe(false);
  });
});

describe('manaSymbols (printed mana cost symbols)', () => {
  const q = (query: ManaSymbolQuery) => (c: EnrichedCard) =>
    cardMatchesFilter(c, { manaSymbols: query });

  it('atLeast counts printed colored pips', () => {
    const bb = q({ counts: { B: 2 }, mode: 'atLeast' });
    expect(bb(GRAY_MERCHANT)).toBe(true);
    expect(bb(VINDICATE)).toBe(false); // one B
    expect(bb(AGADEEM)).toBe(true); // {X}{B}{B}{B}
    const b = q({ counts: { B: 1 }, mode: 'atLeast' });
    expect(b(VINDICATE)).toBe(true);
    expect(b(SOL_RING)).toBe(false);
  });

  it('atLeast across several colors requires all of them', () => {
    const wb = q({ counts: { W: 1, B: 1 }, mode: 'atLeast' });
    expect(wb(VINDICATE)).toBe(true);
    expect(wb(SWORDS)).toBe(false);
  });

  it('a hybrid symbol counts toward each of its colors', () => {
    expect(q({ counts: { G: 2 }, mode: 'atLeast' })(KITCHEN_FINKS)).toBe(true);
    expect(q({ counts: { W: 2 }, mode: 'atLeast' })(KITCHEN_FINKS)).toBe(true);
    expect(q({ counts: { G: 3 }, mode: 'atLeast' })(KITCHEN_FINKS)).toBe(false);
  });

  it('hybrid: false leaves hybrid symbols out of the color counts', () => {
    expect(q({ counts: { G: 1 }, mode: 'atLeast', hybrid: false })(KITCHEN_FINKS)).toBe(false);
    expect(q({ counts: { G: 1 }, mode: 'atLeast', hybrid: true })(KITCHEN_FINKS)).toBe(true);
    // Single-color pips still count with hybrid off.
    expect(q({ counts: { B: 2 }, mode: 'atLeast', hybrid: false })(GRAY_MERCHANT)).toBe(true);
  });

  it('a Phyrexian symbol counts as its color and as P', () => {
    expect(q({ counts: { U: 1 }, mode: 'atLeast' })(GITAXIAN_PROBE)).toBe(true);
    expect(q({ counts: { P: 1 }, mode: 'atLeast' })(GITAXIAN_PROBE)).toBe(true);
    expect(q({ counts: { P: 1 }, mode: 'atLeast' })(STROKE_OF_GENIUS)).toBe(false);
    // Phyrexian symbols are not "hybrid" for the hybrid switch.
    expect(q({ counts: { U: 1 }, mode: 'atLeast', hybrid: false })(GITAXIAN_PROBE)).toBe(true);
  });

  it('counts X and ignores generic mana', () => {
    expect(q({ counts: { X: 1 }, mode: 'atLeast' })(STROKE_OF_GENIUS)).toBe(true);
    expect(q({ counts: { X: 1 }, mode: 'atLeast' })(GRAY_MERCHANT)).toBe(false);
    expect(q({ counts: { U: 1 }, mode: 'atLeast' })(STROKE_OF_GENIUS)).toBe(true);
  });

  it('counts colorless {C} and snow {S} symbols (synthetic cost strings)', () => {
    // Synthetic strings: only the counting of these two keys is under test.
    const c = compileManaSymbols({ counts: { C: 2, S: 1 }, mode: 'atLeast' });
    expect(manaCostMatches('{S}{C}{C}', c!)).toBe(true);
    expect(manaCostMatches('{S}{C}', c!)).toBe(false);
    expect(manaCostMatches('{2}{C}{C}', c!)).toBe(false);
  });

  it('exactColored: the colored counts are exactly these, generic is free', () => {
    const bb = q({ counts: { B: 2 }, mode: 'exactColored' });
    expect(bb(GRAY_MERCHANT)).toBe(true);
    expect(bb(VINDICATE)).toBe(false);
    expect(bb(AGADEEM)).toBe(false); // BBB
    const wb = q({ counts: { W: 1, B: 1 }, mode: 'exactColored' });
    expect(wb(VINDICATE)).toBe(true); // {1} generic ignored
    expect(wb(SWORDS)).toBe(false);
    // A color not listed must be absent.
    expect(q({ counts: { R: 1 }, mode: 'exactColored' })(LIGHTNING_HELIX)).toBe(false);
  });

  it('exactColored treats a hybrid pair as both colors, or none when hybrid is off', () => {
    expect(q({ counts: { G: 2, W: 2 }, mode: 'exactColored' })(KITCHEN_FINKS)).toBe(true);
    expect(q({ counts: { G: 2 }, mode: 'exactColored' })(KITCHEN_FINKS)).toBe(false);
    expect(q({ counts: { G: 0 }, mode: 'exactColored', hybrid: false })(KITCHEN_FINKS)).toBe(true);
  });

  it('exactColored checks C/X/P/S only when listed', () => {
    // Stroke of Genius has an X: asking for exactly U1 ignores it, listing X0 rejects it.
    expect(q({ counts: { U: 1 }, mode: 'exactColored' })(STROKE_OF_GENIUS)).toBe(true);
    expect(q({ counts: { U: 1, X: 0 }, mode: 'exactColored' })(STROKE_OF_GENIUS)).toBe(false);
    expect(q({ counts: { U: 1, X: 1 }, mode: 'exactColored' })(STROKE_OF_GENIUS)).toBe(true);
  });

  it('noColored matches costs with no colored symbol, not costless cards', () => {
    const f = q({ counts: {}, mode: 'atLeast', noColored: true });
    expect(f(SOL_RING)).toBe(true); // {1}
    expect(f(GRAY_MERCHANT)).toBe(false);
    expect(f(GITAXIAN_PROBE)).toBe(false); // {U/P} is colored
    expect(f(KITCHEN_FINKS)).toBe(false);
    expect(f(ANCESTRAL_VISION)).toBe(false); // no cost at all
  });

  it('noCost matches only costless cards (lands, Ancestral Vision)', () => {
    const f = q({ counts: {}, mode: 'atLeast', noCost: true });
    expect(f(ANCESTRAL_VISION)).toBe(true);
    expect(f(SNOW_SWAMP)).toBe(true);
    expect(f(WASTES)).toBe(true);
    expect(f(SOL_RING)).toBe(false);
    expect(f(card({ manaCost: undefined }))).toBe(true);
    expect(f(card({ manaCost: '' }))).toBe(true);
  });

  it('counts, noColored and noCost are alternatives that OR together', () => {
    const f = q({ counts: { B: 2 }, mode: 'atLeast', noCost: true });
    expect(f(GRAY_MERCHANT)).toBe(true);
    expect(f(ANCESTRAL_VISION)).toBe(true);
    expect(f(SOL_RING)).toBe(false);
  });

  it('matches a multi-face card when any face satisfies the query', () => {
    expect(q({ counts: { U: 1 }, mode: 'atLeast' })(FIRE_ICE)).toBe(true);
    expect(q({ counts: { R: 1 }, mode: 'atLeast' })(FIRE_ICE)).toBe(true);
    // Faces are not summed: no single face has R and U together.
    expect(q({ counts: { R: 1, U: 1 }, mode: 'atLeast' })(FIRE_ICE)).toBe(false);
    // A costless back face does not make a costed card "no cost".
    expect(q({ counts: {}, mode: 'atLeast', noCost: true })(DELVER)).toBe(false);
    expect(q({ counts: { U: 1 }, mode: 'atLeast' })(DELVER)).toBe(true);
  });

  it('no counts and no flags is no constraint', () => {
    expect(q({ counts: {}, mode: 'atLeast' })(SOL_RING)).toBe(true);
    expect(q({ counts: {}, mode: 'exactColored' })(GRAY_MERCHANT)).toBe(true);
    expect(isFilterEmpty({ manaSymbols: { counts: {}, mode: 'atLeast' } })).toBe(true);
    expect(isFilterEmpty({ manaSymbols: { counts: { B: 1 }, mode: 'atLeast' } })).toBe(false);
    expect(isFilterEmpty({ manaSymbols: { counts: {}, mode: 'atLeast', noCost: true } })).toBe(
      false
    );
  });

  it('is independent of the exact-string manaCost field', () => {
    const f: BinderFilter = {
      manaCost: '{3}{B}{B}',
      manaSymbols: { counts: { B: 2 }, mode: 'atLeast' },
    };
    expect(cardMatchesFilter(GRAY_MERCHANT, f)).toBe(true);
  });
});
