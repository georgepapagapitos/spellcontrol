import { describe, it, expect } from 'vitest';
import {
  areAllGroupsEmpty,
  cardMatchesAnyGroup,
  cardMatchesFilter,
  compileFilter,
  compileFilterGroups,
  isFilterEmpty,
} from './rules';
import type { EnrichedCard, BinderFilter, ChipExpression } from '../types';

/**
 * Test builders for `ChipExpression` — match the legacy chip()/chips()
 * call sites but emit the new shape:
 *   chip('R')        → IS R
 *   chip('R', true)  → IS NOT R
 *   chips('R', 'B')  → IS R OR IS B
 *   chipsAnd(...)    → IS A AND IS B    (used for legalities, which
 *                                         historically required all)
 */
function chip(value: string, negate = false): ChipExpression {
  return { chips: [{ value, negate }], joiners: [] };
}
function chips(...values: string[]): ChipExpression {
  if (values.length === 0) return { chips: [], joiners: [] };
  return {
    chips: values.map((v) => ({ value: v, negate: false })),
    joiners: values.slice(1).map(() => 'OR' as const),
  };
}
function chipsAnd(...values: string[]): ChipExpression {
  if (values.length === 0) return { chips: [], joiners: [] };
  return {
    chips: values.map((v) => ({ value: v, negate: false })),
    joiners: values.slice(1).map(() => 'AND' as const),
  };
}

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'abc-123',
    purchasePrice: 0.5,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    colors: ['R'],
    ...overrides,
  };
}

describe('cardMatchesFilter', () => {
  it('matches when filter has no constraints', () => {
    expect(cardMatchesFilter(makeCard(), {})).toBe(true);
  });

  describe('legalities', () => {
    it('matches card legal in all selected formats (AND chips)', () => {
      const card = makeCard({ legalities: { commander: 'legal', modern: 'legal' } });
      expect(cardMatchesFilter(card, { legalities: chipsAnd('commander', 'modern') })).toBe(true);
    });

    it('rejects card not legal in one selected AND-joined format', () => {
      const card = makeCard({ legalities: { commander: 'legal', modern: 'banned' } });
      expect(cardMatchesFilter(card, { legalities: chipsAnd('commander', 'modern') })).toBe(false);
    });

    it('rejects card with no legality data when filter is set', () => {
      expect(cardMatchesFilter(makeCard(), { legalities: chips('standard') })).toBe(false);
    });

    it('IS NOT excludes cards legal in that format', () => {
      const banned = makeCard({ legalities: { modern: 'banned' } });
      const legal = makeCard({ legalities: { modern: 'legal' } });
      const filter: BinderFilter = { legalities: chip('modern', true) };
      expect(cardMatchesFilter(banned, filter)).toBe(true);
      expect(cardMatchesFilter(legal, filter)).toBe(false);
    });
  });

  describe('rarity (IS / IS NOT)', () => {
    it('IS chip matches the card rarity, case-insensitive', () => {
      expect(
        cardMatchesFilter(makeCard({ rarity: 'Rare' }), {
          rarities: chip('rare'),
        })
      ).toBe(true);
    });
    it('IS chip rejects mismatched rarity', () => {
      expect(
        cardMatchesFilter(makeCard({ rarity: 'common' }), {
          rarities: chip('rare'),
        })
      ).toBe(false);
    });
    it('multiple IS chips OR among themselves', () => {
      const filter: BinderFilter = { rarities: chips('rare', 'mythic') };
      expect(cardMatchesFilter(makeCard({ rarity: 'mythic' }), filter)).toBe(true);
      expect(cardMatchesFilter(makeCard({ rarity: 'common' }), filter)).toBe(false);
    });
    it('IS NOT excludes the chip value', () => {
      const filter: BinderFilter = { rarities: chip('common', true) };
      expect(cardMatchesFilter(makeCard({ rarity: 'rare' }), filter)).toBe(true);
      expect(cardMatchesFilter(makeCard({ rarity: 'common' }), filter)).toBe(false);
    });
  });

  describe('price range', () => {
    it('matches in range, boundaries inclusive', () => {
      expect(cardMatchesFilter(makeCard({ purchasePrice: 5 }), { priceMin: 1, priceMax: 10 })).toBe(
        true
      );
      expect(cardMatchesFilter(makeCard({ purchasePrice: 1 }), { priceMin: 1 })).toBe(true);
      expect(cardMatchesFilter(makeCard({ purchasePrice: 10 }), { priceMax: 10 })).toBe(true);
    });
    it('rejects outside range', () => {
      expect(cardMatchesFilter(makeCard({ purchasePrice: 0.5 }), { priceMin: 1 })).toBe(false);
      expect(cardMatchesFilter(makeCard({ purchasePrice: 20 }), { priceMax: 10 })).toBe(false);
    });
  });

  describe('colors', () => {
    it('matches mono-red against red', () => {
      const card = makeCard({ colorIdentity: ['R'], typeLine: 'Instant' });
      expect(cardMatchesFilter(card, { colors: chips('R') })).toBe(true);
    });
    it('rejects mono-red against blue', () => {
      const card = makeCard({ colorIdentity: ['R'], typeLine: 'Instant' });
      expect(cardMatchesFilter(card, { colors: chips('U') })).toBe(false);
    });
    it('matches Wastes as colorless', () => {
      const card = makeCard({ typeLine: 'Basic Land — Wastes', colorIdentity: [] });
      expect(cardMatchesFilter(card, { colors: chips('C') })).toBe(true);
    });
    it('IS NOT excludes that color', () => {
      const red = makeCard({ colorIdentity: ['R'] });
      const blue = makeCard({ colorIdentity: ['U'] });
      const filter: BinderFilter = { colors: chip('R', true) };
      expect(cardMatchesFilter(red, filter)).toBe(false);
      expect(cardMatchesFilter(blue, filter)).toBe(true);
    });
  });

  describe('typeChips IS / IS NOT', () => {
    const card = makeCard({ typeLine: 'Legendary Creature — Human Wizard' });

    it('IS chip alone — substring match', () => {
      expect(cardMatchesFilter(card, { typeChips: chip('creature') })).toBe(true);
      expect(cardMatchesFilter(card, { typeChips: chip('instant') })).toBe(false);
    });

    it('multiple IS chips — OR among them', () => {
      const filter: BinderFilter = { typeChips: chips('instant', 'creature') };
      expect(cardMatchesFilter(card, filter)).toBe(true);
    });

    it('IS NOT chip excludes matching cards', () => {
      // "creature AND NOT legendary" — only non-legendary creatures pass.
      const filter: BinderFilter = {
        typeChips: {
          chips: [
            { value: 'creature', negate: false },
            { value: 'legendary', negate: true },
          ],
          joiners: ['AND'],
        },
      };
      expect(cardMatchesFilter(card, filter)).toBe(false);
      const nonLegendary = makeCard({ typeLine: 'Creature — Human' });
      expect(cardMatchesFilter(nonLegendary, filter)).toBe(true);
    });

    it('IS NOT alone — accepts cards that lack the substring', () => {
      const filter: BinderFilter = { typeChips: chip('creature', true) };
      expect(cardMatchesFilter(makeCard({ typeLine: 'Sorcery' }), filter)).toBe(true);
      expect(cardMatchesFilter(card, filter)).toBe(false);
    });

    it('blank chip values are ignored', () => {
      const filter: BinderFilter = {
        typeChips: {
          chips: [
            { value: '', negate: false },
            { value: '   ', negate: true },
          ],
          joiners: ['AND'],
        },
      };
      expect(cardMatchesFilter(card, filter)).toBe(true);
    });
  });

  describe('oracleChips', () => {
    it('matches oracle text substring', () => {
      const card = makeCard({ oracleText: 'Flying. When this creature dies, draw a card.' });
      expect(cardMatchesFilter(card, { oracleChips: chip('draw a card') })).toBe(true);
      expect(cardMatchesFilter(card, { oracleChips: chip('trample') })).toBe(false);
    });
  });

  describe('mana cost', () => {
    it('exact match, whitespace insensitive', () => {
      const card = makeCard({ manaCost: '{2}{G}{W}' });
      expect(cardMatchesFilter(card, { manaCost: '{2}{G}{W}' })).toBe(true);
      expect(cardMatchesFilter(card, { manaCost: '  {2}{g}{w}  ' })).toBe(true);
      expect(cardMatchesFilter(card, { manaCost: '{2}{G}' })).toBe(false);
    });
  });

  describe('CMC range', () => {
    it('respects bounds; missing cmc treated as 0', () => {
      expect(cardMatchesFilter(makeCard({ cmc: 3 }), { cmcMin: 2, cmcMax: 5 })).toBe(true);
      expect(cardMatchesFilter(makeCard({ cmc: 1 }), { cmcMin: 2 })).toBe(false);
      expect(cardMatchesFilter(makeCard({ cmc: undefined }), { cmcMax: 0 })).toBe(true);
    });
  });

  describe('finishes (tests the finish the user OWNS, not the printing)', () => {
    it('IS foil matches a foil copy regardless of printing availability', () => {
      const foilCopy = makeCard({ finish: 'foil', foil: true, finishes: ['nonfoil', 'foil'] });
      expect(cardMatchesFilter(foilCopy, { finishes: chips('foil') })).toBe(true);
    });

    it('IS foil rejects a nonfoil copy of a printing that exists in foil', () => {
      const nonfoilCopy = makeCard({
        finish: 'nonfoil',
        foil: false,
        finishes: ['nonfoil', 'foil'],
      });
      expect(cardMatchesFilter(nonfoilCopy, { finishes: chips('foil') })).toBe(false);
    });

    it('IS nonfoil matches nonfoil copies and rejects foil copies', () => {
      expect(
        cardMatchesFilter(makeCard({ finish: 'nonfoil', foil: false }), {
          finishes: chips('nonfoil'),
        })
      ).toBe(true);
      expect(
        cardMatchesFilter(makeCard({ finish: 'foil', foil: true }), { finishes: chips('nonfoil') })
      ).toBe(false);
    });

    it('IS NOT foil excludes foil copies', () => {
      const filter: BinderFilter = { finishes: chip('foil', true) };
      expect(cardMatchesFilter(makeCard({ finish: 'foil', foil: true }), filter)).toBe(false);
      expect(cardMatchesFilter(makeCard({ finish: 'nonfoil', foil: false }), filter)).toBe(true);
    });

    it('IS etched matches etched copies', () => {
      const etched = makeCard({ finish: 'etched', foil: true, finishes: ['etched'] });
      expect(cardMatchesFilter(etched, { finishes: chips('etched') })).toBe(true);
      expect(cardMatchesFilter(etched, { finishes: chips('foil') })).toBe(false);
      expect(cardMatchesFilter(etched, { finishes: chips('nonfoil') })).toBe(false);
    });
  });

  describe('layout', () => {
    it('matches selected layout', () => {
      expect(cardMatchesFilter(makeCard({ layout: 'saga' }), { layouts: chips('saga') })).toBe(
        true
      );
      expect(cardMatchesFilter(makeCard({ layout: 'normal' }), { layouts: chips('saga') })).toBe(
        false
      );
    });
    it('rejects when layout missing', () => {
      expect(cardMatchesFilter(makeCard({ layout: undefined }), { layouts: chips('normal') })).toBe(
        false
      );
    });
  });

  describe('setCodes / nameContains / edhrec / treatments / borders', () => {
    it('setCodes case-insensitive', () => {
      expect(cardMatchesFilter(makeCard({ setCode: 'cmr' }), { setCodes: ['CMR'] })).toBe(true);
      expect(cardMatchesFilter(makeCard({ setCode: 'IKO' }), { setCodes: ['CMR'] })).toBe(false);
    });
    it('nameContains case-insensitive', () => {
      expect(
        cardMatchesFilter(makeCard({ name: 'Lightning Bolt' }), { nameContains: 'bolt' })
      ).toBe(true);
    });
    it('edhrecRankMax bounds', () => {
      expect(cardMatchesFilter(makeCard({ edhrecRank: 50 }), { edhrecRankMax: 100 })).toBe(true);
      expect(cardMatchesFilter(makeCard({ edhrecRank: 200 }), { edhrecRankMax: 100 })).toBe(false);
      expect(cardMatchesFilter(makeCard(), { edhrecRankMax: 100 })).toBe(false);
    });
    it('treatments match fullart via flag or frame effect', () => {
      expect(cardMatchesFilter(makeCard({ fullArt: true }), { treatments: chips('fullart') })).toBe(
        true
      );
      expect(
        cardMatchesFilter(makeCard({ frameEffects: ['showcase'] }), {
          treatments: chips('showcase'),
        })
      ).toBe(true);
    });
    it('borderColors match', () => {
      expect(
        cardMatchesFilter(makeCard({ borderColor: 'borderless' }), {
          borderColors: chips('borderless'),
        })
      ).toBe(true);
    });
  });

  describe('AND across fields', () => {
    it('all set fields must pass', () => {
      const filter: BinderFilter = {
        rarities: chip('rare'),
        priceMin: 5,
      };
      expect(cardMatchesFilter(makeCard({ rarity: 'rare', purchasePrice: 10 }), filter)).toBe(true);
      expect(cardMatchesFilter(makeCard({ rarity: 'rare', purchasePrice: 1 }), filter)).toBe(false);
      expect(cardMatchesFilter(makeCard({ rarity: 'common', purchasePrice: 10 }), filter)).toBe(
        false
      );
    });
  });
});

describe('isFilterEmpty', () => {
  it('true for empty object', () => {
    expect(isFilterEmpty({})).toBe(true);
  });
  it('false when any field is set', () => {
    expect(isFilterEmpty({ rarities: chip('rare') })).toBe(false);
    expect(isFilterEmpty({ legalities: chips('standard') })).toBe(false);
    expect(isFilterEmpty({ typeChips: chip('creature') })).toBe(false);
    expect(isFilterEmpty({ manaCost: '{R}' })).toBe(false);
  });
  it('treats blank chip values as empty', () => {
    expect(isFilterEmpty({ typeChips: chip('   ') })).toBe(true);
    expect(isFilterEmpty({ oracleChips: { chips: [], joiners: [] } })).toBe(true);
  });
  it('treats whitespace-only nameContains and manaCost as empty', () => {
    expect(isFilterEmpty({ nameContains: '   ', manaCost: '   ' })).toBe(true);
  });
});

describe('cardMatchesAnyGroup (OR semantics)', () => {
  it('matches if any group matches', () => {
    const card = makeCard({ rarity: 'rare', purchasePrice: 0.1, edhrecRank: 50 });
    const groups = compileFilterGroups([
      { filter: { rarities: chips('common') } }, // doesn't match
      { filter: { edhrecRankMax: 100 } }, // matches
    ]);
    expect(cardMatchesAnyGroup(card, groups)).toBe(true);
  });

  it('rejects if no group matches', () => {
    const card = makeCard({ rarity: 'rare', purchasePrice: 0.1 });
    const groups = compileFilterGroups([
      { filter: { rarities: chips('common') } },
      { filter: { priceMin: 5 } },
    ]);
    expect(cardMatchesAnyGroup(card, groups)).toBe(false);
  });

  it('a single empty group matches every card', () => {
    const groups = compileFilterGroups([{ filter: {} }]);
    expect(cardMatchesAnyGroup(makeCard(), groups)).toBe(true);
  });

  it('zero groups matches nothing (defensive)', () => {
    expect(cardMatchesAnyGroup(makeCard(), [])).toBe(false);
  });
});

describe('areAllGroupsEmpty', () => {
  it('true when every group has no constraints', () => {
    expect(areAllGroupsEmpty([{ filter: {} }, { filter: {} }])).toBe(true);
  });
  it('false when at least one group has a constraint', () => {
    expect(areAllGroupsEmpty([{ filter: {} }, { filter: { priceMin: 1 } }])).toBe(false);
  });
});

describe('commanderEligible filter', () => {
  const legend = makeCard({
    typeLine: 'Legendary Creature — Human Wizard',
    oracleText: '',
    legalities: { commander: 'legal' },
  });
  const pwCommander = makeCard({
    typeLine: 'Legendary Planeswalker — Daretti',
    oracleText: 'daretti can be your commander.',
    legalities: { commander: 'legal' },
  });
  const bannedLegend = makeCard({
    typeLine: 'Legendary Creature — Human',
    oracleText: '',
    legalities: { commander: 'banned' },
  });
  const vanilla = makeCard({
    typeLine: 'Creature — Bear',
    oracleText: '',
    legalities: { commander: 'legal' },
  });

  it('true matches legendary creatures and planeswalker-commanders', () => {
    const f: BinderFilter = { commanderEligible: true };
    expect(cardMatchesFilter(legend, f)).toBe(true);
    expect(cardMatchesFilter(pwCommander, f)).toBe(true);
  });

  it('true rejects banned legends and vanilla creatures', () => {
    const f: BinderFilter = { commanderEligible: true };
    expect(cardMatchesFilter(bannedLegend, f)).toBe(false);
    expect(cardMatchesFilter(vanilla, f)).toBe(false);
  });

  it('false inverts the match', () => {
    const f: BinderFilter = { commanderEligible: false };
    expect(cardMatchesFilter(legend, f)).toBe(false);
    expect(cardMatchesFilter(vanilla, f)).toBe(true);
  });

  it('undefined imposes no constraint', () => {
    const f: BinderFilter = {};
    expect(cardMatchesFilter(legend, f)).toBe(true);
    expect(cardMatchesFilter(vanilla, f)).toBe(true);
  });

  it('compileFilter round-trips the flag', () => {
    expect(compileFilter({ commanderEligible: true }).commanderEligible).toBe(true);
    expect(compileFilter({ commanderEligible: false }).commanderEligible).toBe(false);
    expect(compileFilter({}).commanderEligible).toBeUndefined();
  });

  it('isFilterEmpty is false when only commanderEligible is set', () => {
    expect(isFilterEmpty({ commanderEligible: true })).toBe(false);
    expect(isFilterEmpty({ commanderEligible: false })).toBe(false);
    expect(isFilterEmpty({})).toBe(true);
  });
});
