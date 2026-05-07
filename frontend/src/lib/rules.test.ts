import { describe, it, expect } from 'vitest';
import {
  areAllGroupsEmpty,
  cardMatchesAnyGroup,
  cardMatchesFilter,
  compileFilterGroups,
  isFilterEmpty,
} from './rules';
import type { EnrichedCard, BinderFilter, NegatableChip } from '../types';

function chip(value: string, negate = false): NegatableChip {
  return { value, negate };
}
function chips(...values: string[]): NegatableChip[] {
  return values.map((v) => chip(v));
}

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'abc-123',
    purchasePrice: 0.5,
    sourceCategory: '',
    sourceFormat: 'plain',
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
    it('matches card legal in all selected formats (multiple IS chips AND together)', () => {
      const card = makeCard({ legalities: { commander: 'legal', modern: 'legal' } });
      expect(cardMatchesFilter(card, { legalities: chips('commander', 'modern') })).toBe(true);
    });

    it('rejects card not legal in one selected format', () => {
      const card = makeCard({ legalities: { commander: 'legal', modern: 'banned' } });
      expect(cardMatchesFilter(card, { legalities: chips('commander', 'modern') })).toBe(false);
    });

    it('rejects card with no legality data when filter is set', () => {
      expect(cardMatchesFilter(makeCard(), { legalities: chips('standard') })).toBe(false);
    });

    it('IS NOT excludes cards legal in that format', () => {
      const banned = makeCard({ legalities: { modern: 'banned' } });
      const legal = makeCard({ legalities: { modern: 'legal' } });
      const filter: BinderFilter = { legalities: [chip('modern', true)] };
      expect(cardMatchesFilter(banned, filter)).toBe(true);
      expect(cardMatchesFilter(legal, filter)).toBe(false);
    });
  });

  describe('rarity (IS / IS NOT)', () => {
    it('IS chip matches the card rarity, case-insensitive', () => {
      expect(
        cardMatchesFilter(makeCard({ rarity: 'Rare' }), {
          rarities: [{ value: 'rare', negate: false }],
        })
      ).toBe(true);
    });
    it('IS chip rejects mismatched rarity', () => {
      expect(
        cardMatchesFilter(makeCard({ rarity: 'common' }), {
          rarities: [{ value: 'rare', negate: false }],
        })
      ).toBe(false);
    });
    it('multiple IS chips OR among themselves', () => {
      const filter: BinderFilter = {
        rarities: [
          { value: 'rare', negate: false },
          { value: 'mythic', negate: false },
        ],
      };
      expect(cardMatchesFilter(makeCard({ rarity: 'mythic' }), filter)).toBe(true);
      expect(cardMatchesFilter(makeCard({ rarity: 'common' }), filter)).toBe(false);
    });
    it('IS NOT excludes the chip value', () => {
      const filter: BinderFilter = { rarities: [{ value: 'common', negate: true }] };
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
      const filter: BinderFilter = { colors: [chip('R', true)] };
      expect(cardMatchesFilter(red, filter)).toBe(false);
      expect(cardMatchesFilter(blue, filter)).toBe(true);
    });
  });

  describe('typeChips IS / IS NOT', () => {
    const card = makeCard({ typeLine: 'Legendary Creature — Human Wizard' });

    it('IS chip alone — substring match', () => {
      expect(cardMatchesFilter(card, { typeChips: [{ value: 'creature', negate: false }] })).toBe(
        true
      );
      expect(cardMatchesFilter(card, { typeChips: [{ value: 'instant', negate: false }] })).toBe(
        false
      );
    });

    it('multiple IS chips — OR among them', () => {
      const filter: BinderFilter = {
        typeChips: [
          { value: 'instant', negate: false },
          { value: 'creature', negate: false },
        ],
      };
      expect(cardMatchesFilter(card, filter)).toBe(true);
    });

    it('IS NOT chip excludes matching cards', () => {
      const filter: BinderFilter = {
        typeChips: [
          { value: 'creature', negate: false },
          { value: 'legendary', negate: true },
        ],
      };
      expect(cardMatchesFilter(card, filter)).toBe(false);
      const nonLegendary = makeCard({ typeLine: 'Creature — Human' });
      expect(cardMatchesFilter(nonLegendary, filter)).toBe(true);
    });

    it('IS NOT alone — accepts cards that lack the substring', () => {
      const filter: BinderFilter = { typeChips: [{ value: 'creature', negate: true }] };
      expect(cardMatchesFilter(makeCard({ typeLine: 'Sorcery' }), filter)).toBe(true);
      expect(cardMatchesFilter(card, filter)).toBe(false);
    });

    it('blank chip values are ignored', () => {
      const filter: BinderFilter = {
        typeChips: [
          { value: '', negate: false },
          { value: '   ', negate: true },
        ],
      };
      expect(cardMatchesFilter(card, filter)).toBe(true);
    });
  });

  describe('oracleChips', () => {
    it('matches oracle text substring', () => {
      const card = makeCard({ oracleText: 'Flying. When this creature dies, draw a card.' });
      expect(
        cardMatchesFilter(card, { oracleChips: [{ value: 'draw a card', negate: false }] })
      ).toBe(true);
      expect(cardMatchesFilter(card, { oracleChips: [{ value: 'trample', negate: false }] })).toBe(
        false
      );
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

  describe('finishes', () => {
    it('matches when card offers any selected finish', () => {
      const card = makeCard({ finishes: ['nonfoil', 'foil'] });
      expect(cardMatchesFilter(card, { finishes: chips('foil') })).toBe(true);
      expect(cardMatchesFilter(card, { finishes: chips('etched') })).toBe(false);
    });

    it('falls back to legacy foil flag when finishes data is missing', () => {
      expect(cardMatchesFilter(makeCard({ foil: true }), { finishes: chips('foil') })).toBe(true);
      expect(cardMatchesFilter(makeCard({ foil: false }), { finishes: chips('nonfoil') })).toBe(
        true
      );
      expect(cardMatchesFilter(makeCard({ foil: false }), { finishes: chips('foil') })).toBe(false);
    });

    it('IS NOT etched excludes etched-only printings', () => {
      const etched = makeCard({ finishes: ['etched'] });
      const normal = makeCard({ finishes: ['nonfoil'] });
      const filter: BinderFilter = { finishes: [chip('etched', true)] };
      expect(cardMatchesFilter(etched, filter)).toBe(false);
      expect(cardMatchesFilter(normal, filter)).toBe(true);
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
        rarities: [{ value: 'rare', negate: false }],
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
    expect(isFilterEmpty({ rarities: [{ value: 'rare', negate: false }] })).toBe(false);
    expect(isFilterEmpty({ legalities: chips('standard') })).toBe(false);
    expect(isFilterEmpty({ typeChips: [{ value: 'creature', negate: false }] })).toBe(false);
    expect(isFilterEmpty({ manaCost: '{R}' })).toBe(false);
  });
  it('treats blank chip values as empty', () => {
    expect(isFilterEmpty({ typeChips: [{ value: '   ', negate: false }] })).toBe(true);
    expect(isFilterEmpty({ oracleChips: [] })).toBe(true);
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
