import { describe, it, expect } from 'vitest';
import {
  buildSharedBinderFilter,
  colorMatches,
  countActiveSharedFilters,
  makeSharedMatcher,
  publicCardToEnriched,
  type SharedFilterState,
} from './shared-filter';
import type { ChipExpression } from '../types';
import type { PublicCard } from './shared-types';

const EMPTY: ChipExpression = { chips: [], joiners: [] };
const chips = (...values: string[]): ChipExpression => ({
  chips: values.map((value) => ({ value, negate: false })),
  joiners: values.slice(1).map(() => 'OR' as const),
});

function state(overrides: Partial<SharedFilterState> = {}): SharedFilterState {
  return {
    supertypeExpr: EMPTY,
    typesExpr: EMPTY,
    subtypeExpr: EMPTY,
    colorFilter: new Set(),
    rarityExpr: EMPTY,
    oracleTagExpr: EMPTY,
    layoutExpr: EMPTY,
    finishExpr: EMPTY,
    setFilter: new Set(),
    ...overrides,
  };
}

function card(overrides: Partial<PublicCard> = {}): PublicCard {
  return {
    name: 'Sol Ring',
    scryfallId: 'sol-id',
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '472',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1.5,
    cmc: 1,
    typeLine: 'Artifact',
    colorIdentity: [],
    ...overrides,
  };
}

describe('publicCardToEnriched', () => {
  it('maps PublicCard fields onto the engine card shape', () => {
    const e = publicCardToEnriched(card({ typeLine: 'Instant', colorIdentity: ['U'], cmc: 2 }));
    expect(e.typeLine).toBe('Instant');
    expect(e.colorIdentity).toEqual(['U']);
    expect(e.cmc).toBe(2);
    expect(e.setCode).toBe('cmr');
    // required-but-unread fields get harmless stubs; tags default empty (snapshot unloaded)
    expect(e.copyId).toBe('sol-id');
    expect(e.tags).toEqual([]);
  });
});

describe('buildSharedBinderFilter', () => {
  it('routes each expr to its engine field and omits empty facets', () => {
    const f = buildSharedBinderFilter(
      state({
        typesExpr: chips('artifact'),
        rarityExpr: chips('mythic'),
        layoutExpr: chips('transform'),
        setFilter: new Set(['cmr', 'mh2']),
        cmcMin: 1,
      })
    );
    expect(f.typeTokenChips).toEqual(chips('artifact'));
    expect(f.rarities).toEqual(chips('mythic'));
    expect(f.layouts).toEqual(chips('transform'));
    expect(f.setCodes).toEqual(['CMR', 'MH2']); // uppercased
    expect(f.cmcMin).toBe(1);
    expect(f.oracleChips).toBeUndefined();
    expect(f.supertypeChips).toBeUndefined();
  });
});

describe('colorMatches', () => {
  it('passes everything when no color is selected', () => {
    expect(colorMatches(publicCardToEnriched(card({ colorIdentity: ['U'] })), new Set())).toBe(
      true
    );
  });

  it('matches any selected color in identity', () => {
    const counterspell = publicCardToEnriched(card({ colorIdentity: ['U'] }));
    expect(colorMatches(counterspell, new Set(['U']))).toBe(true);
    expect(colorMatches(counterspell, new Set(['W']))).toBe(false);
  });

  it("treats 'C' as colorless (empty identity)", () => {
    const solRing = publicCardToEnriched(card({ colorIdentity: [] }));
    expect(colorMatches(solRing, new Set(['C']))).toBe(true);
    expect(colorMatches(solRing, new Set(['U']))).toBe(false);
  });
});

describe('makeSharedMatcher', () => {
  const sol = card({ name: 'Sol Ring', typeLine: 'Artifact', rarity: 'uncommon', cmc: 1 });
  const counter = card({
    name: 'Counterspell',
    typeLine: 'Instant',
    rarity: 'common',
    colorIdentity: ['U'],
    setCode: 'mh2',
    cmc: 2,
  });

  it('passes all cards when no facet is active', () => {
    const m = makeSharedMatcher(state());
    expect(m(sol)).toBe(true);
    expect(m(counter)).toBe(true);
  });

  it('filters by type token, rarity, set, and cmc via the engine', () => {
    expect(makeSharedMatcher(state({ typesExpr: chips('instant') }))(sol)).toBe(false);
    expect(makeSharedMatcher(state({ typesExpr: chips('instant') }))(counter)).toBe(true);
    expect(makeSharedMatcher(state({ rarityExpr: chips('mythic') }))(sol)).toBe(false);
    expect(makeSharedMatcher(state({ setFilter: new Set(['cmr']) }))(sol)).toBe(true);
    expect(makeSharedMatcher(state({ setFilter: new Set(['cmr']) }))(counter)).toBe(false);
    expect(makeSharedMatcher(state({ cmcMin: 2, cmcMax: 2 }))(counter)).toBe(true);
    expect(makeSharedMatcher(state({ cmcMin: 2, cmcMax: 2 }))(sol)).toBe(false);
  });

  it('composes facets and the color post-check with AND', () => {
    const m = makeSharedMatcher(
      state({ typesExpr: chips('artifact'), colorFilter: new Set(['C']) })
    );
    expect(m(sol)).toBe(true);
    expect(m(counter)).toBe(false); // instant + blue
  });
});

describe('countActiveSharedFilters', () => {
  it('counts each expr/set-selection/range once', () => {
    expect(countActiveSharedFilters(state())).toBe(0);
    expect(
      countActiveSharedFilters(
        state({
          colorFilter: new Set(['U']),
          rarityExpr: chips('mythic'),
          setFilter: new Set(['cmr', 'mh2']),
          priceMin: 1,
          cmcMin: 0,
          cmcMax: 3,
        })
      )
    ).toBe(6); // 1 color + 1 rarity + 2 sets + 1 price range + 1 cmc range
  });
});
