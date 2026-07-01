import { describe, it, expect } from 'vitest';
import {
  collectionFiltersToFilterGroup,
  deriveBinderName,
  hasStructuredFilter,
  type CollectionFilterInput,
} from './collection-filters-to-binder';
import type { ChipExpression } from '../types';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

function chip(value: string, negate = false): ChipExpression {
  return { chips: [{ value, negate }], joiners: [] };
}
function chips(...values: string[]): ChipExpression {
  if (values.length === 0) return { chips: [], joiners: [] };
  return {
    chips: values.map((v) => ({ value: v, negate: false })),
    joiners: values.slice(1).map((): 'OR' => 'OR'),
  };
}

function makeInput(overrides: Partial<CollectionFilterInput> = {}): CollectionFilterInput {
  return {
    colorFilter: new Set(),
    supertypeExpr: EMPTY_EXPR,
    typesExpr: EMPTY_EXPR,
    subtypeExpr: EMPTY_EXPR,
    rarityExpr: EMPTY_EXPR,
    oracleExpr: EMPTY_EXPR,
    oracleTagExpr: EMPTY_EXPR,
    legalityExpr: EMPTY_EXPR,
    layoutExpr: EMPTY_EXPR,
    treatmentExpr: EMPTY_EXPR,
    borderExpr: EMPTY_EXPR,
    finishExpr: EMPTY_EXPR,
    conditionExpr: EMPTY_EXPR,
    binderExpr: EMPTY_EXPR,
    setFilter: new Set(),
    priceMin: undefined,
    priceMax: undefined,
    cmcMin: undefined,
    cmcMax: undefined,
    search: '',
    ...overrides,
  };
}

describe('hasStructuredFilter', () => {
  it('false when everything is empty', () => {
    expect(hasStructuredFilter(makeInput())).toBe(false);
  });

  it('false when only search is set', () => {
    expect(hasStructuredFilter(makeInput({ search: 'bolt' }))).toBe(false);
  });

  it('true when color filter is set', () => {
    expect(hasStructuredFilter(makeInput({ colorFilter: new Set(['R']) }))).toBe(true);
  });

  it('true when a chip expression is set', () => {
    expect(hasStructuredFilter(makeInput({ rarityExpr: chip('rare') }))).toBe(true);
  });

  it('true when setFilter is set', () => {
    expect(hasStructuredFilter(makeInput({ setFilter: new Set(['IKO']) }))).toBe(true);
  });

  it('true when priceMin is set', () => {
    expect(hasStructuredFilter(makeInput({ priceMin: 5 }))).toBe(true);
  });

  it('true when an oracle tag is set', () => {
    expect(hasStructuredFilter(makeInput({ oracleTagExpr: chip('mana-rock') }))).toBe(true);
  });
});

describe('collectionFiltersToFilterGroup', () => {
  it('returns an empty filter when all inputs are empty', () => {
    const { group, flagged } = collectionFiltersToFilterGroup(makeInput());
    expect(group.filter).toEqual({});
    expect(flagged).toEqual([]);
  });

  it('maps rarityExpr → rarities', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ rarityExpr: chip('rare') }));
    expect(group.filter.rarities).toEqual(chip('rare'));
    expect(group.filter.typeChips).toBeUndefined();
  });

  it('maps supertypeExpr → supertypeChips', () => {
    const { group } = collectionFiltersToFilterGroup(
      makeInput({ supertypeExpr: chip('legendary') })
    );
    expect(group.filter.supertypeChips).toEqual(chip('legendary'));
  });

  it('maps typesExpr → typeTokenChips (exact-token, not substring typeChips)', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ typesExpr: chip('creature') }));
    expect(group.filter.typeTokenChips).toEqual(chip('creature'));
    expect(group.filter.typeChips).toBeUndefined();
  });

  it('maps subtypeExpr → subtypeChips', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ subtypeExpr: chip('angel') }));
    expect(group.filter.subtypeChips).toEqual(chip('angel'));
  });

  it('maps oracleTagExpr → oracleTagChips (cloned)', () => {
    const oracleTagExpr = chips('mana-rock', 'mana-dork');
    const { group } = collectionFiltersToFilterGroup(makeInput({ oracleTagExpr }));
    expect(group.filter.oracleTagChips).toEqual(oracleTagExpr);
    // clone guard — mutating the result must not touch the input
    group.filter.oracleTagChips!.chips.push({ value: 'ramp', negate: false });
    expect(oracleTagExpr.chips).toHaveLength(2);
  });

  it('maps setFilter → setCodes (uppercased)', () => {
    const { group } = collectionFiltersToFilterGroup(
      makeInput({ setFilter: new Set(['iko', 'cmr']) })
    );
    expect(group.filter.setCodes?.sort()).toEqual(['CMR', 'IKO']);
  });

  it('maps priceMin/priceMax → filter fields', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ priceMin: 5, priceMax: 20 }));
    expect(group.filter.priceMin).toBe(5);
    expect(group.filter.priceMax).toBe(20);
  });

  it('maps cmcMin/cmcMax → filter fields', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ cmcMin: 2, cmcMax: 4 }));
    expect(group.filter.cmcMin).toBe(2);
    expect(group.filter.cmcMax).toBe(4);
  });

  it('maps colorFilter → colors ChipExpression and flags color', () => {
    const { group, flagged } = collectionFiltersToFilterGroup(
      makeInput({ colorFilter: new Set(['R', 'B']) })
    );
    expect(group.filter.colors).toBeDefined();
    expect(group.filter.colors!.chips.map((c) => c.value).sort()).toEqual(['B', 'R']);
    expect(group.filter.colors!.joiners).toEqual(['OR']);
    expect(flagged).toContain('color');
  });

  it('flags condition when conditionExpr is set, does NOT carry it', () => {
    const { group, flagged } = collectionFiltersToFilterGroup(
      makeInput({ conditionExpr: chip('nm') })
    );
    expect((group.filter as Record<string, unknown>).conditionExpr).toBeUndefined();
    // condition is a per-copy field, not on BinderFilter
    expect(flagged).toContain('condition');
  });

  it('flags binder when binderExpr is set, does NOT carry it', () => {
    const { flagged } = collectionFiltersToFilterGroup(makeInput({ binderExpr: chip('myBinder') }));
    expect(flagged).toContain('binder');
  });

  it('does NOT set nameContains from search alone', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ search: 'bolt' }));
    expect(group.filter.nameContains).toBeUndefined();
  });

  it('carries search as nameContains when structured filters are also present', () => {
    const { group } = collectionFiltersToFilterGroup(
      makeInput({ search: 'bolt', rarityExpr: chip('rare') })
    );
    expect(group.filter.nameContains).toBe('bolt');
  });

  // A2 — clone guard: seed ChipExpressions must not share object identity with input.
  it('clones ChipExpressions — mutating returned filter does not affect input', () => {
    const rarityExpr = chip('rare');
    const { group } = collectionFiltersToFilterGroup(makeInput({ rarityExpr }));
    // Mutate the returned filter's chips array
    group.filter.rarities!.chips.push({ value: 'mythic', negate: false });
    // Input should be unchanged
    expect(rarityExpr.chips).toHaveLength(1);
  });

  it('clones typeTokenChips — mutating returned filter does not affect input typesExpr', () => {
    const typesExpr = chip('creature');
    const { group } = collectionFiltersToFilterGroup(makeInput({ typesExpr }));
    group.filter.typeTokenChips!.chips.push({ value: 'instant', negate: false });
    expect(typesExpr.chips).toHaveLength(1);
  });

  // A7 — flagged field coverage.
  it('flags condition and drops conditionExpr from the binder filter', () => {
    const { group, flagged } = collectionFiltersToFilterGroup(
      makeInput({ conditionExpr: chip('nm') })
    );
    expect(flagged).toContain('condition');
    expect(flagged).not.toContain('color');
    expect(flagged).not.toContain('binder');
    expect(Object.keys(group.filter)).toHaveLength(0);
  });

  it('flags binder and drops binderExpr from the binder filter', () => {
    const { group, flagged } = collectionFiltersToFilterGroup(
      makeInput({ binderExpr: chip('myBinder') })
    );
    expect(flagged).toContain('binder');
    expect(Object.keys(group.filter)).toHaveLength(0);
  });

  it('does NOT flag price or cmc — they are faithfully mapped', () => {
    const { flagged } = collectionFiltersToFilterGroup(
      makeInput({ priceMin: 5, priceMax: 20, cmcMin: 2, cmcMax: 4 })
    );
    expect(flagged).not.toContain('price');
    expect(flagged).not.toContain('cmc');
    expect(flagged).toHaveLength(0);
  });

  it('omits empty fields from the returned filter', () => {
    const { group } = collectionFiltersToFilterGroup(makeInput({ rarityExpr: chip('rare') }));
    // Only rarities should be set; all others omitted
    expect(group.filter.typeChips).toBeUndefined();
    expect(group.filter.typeTokenChips).toBeUndefined();
    expect(group.filter.colors).toBeUndefined();
    expect(group.filter.setCodes).toBeUndefined();
  });
});

describe('deriveBinderName', () => {
  it('returns "Filtered binder" for empty input', () => {
    expect(deriveBinderName(makeInput())).toBe('Filtered binder');
  });

  it('uses rarity abbreviations', () => {
    const name = deriveBinderName(makeInput({ rarityExpr: chips('rare', 'mythic') }));
    expect(name).toContain('R');
    expect(name).toContain('M');
  });

  it('includes color filter', () => {
    const name = deriveBinderName(makeInput({ colorFilter: new Set(['U', 'B']) }));
    expect(name).toBeTruthy();
    expect(name).not.toBe('Filtered binder');
  });

  it('includes price range', () => {
    const name = deriveBinderName(makeInput({ priceMin: 5 }));
    expect(name).toContain('$5+');
  });

  it('is deterministic', () => {
    const input = makeInput({ rarityExpr: chip('rare'), priceMin: 10 });
    expect(deriveBinderName(input)).toBe(deriveBinderName(input));
  });

  // A7 — deriveBinderName branch coverage.
  it('price min-only', () => {
    expect(deriveBinderName(makeInput({ priceMin: 10 }))).toContain('$10+');
  });

  it('price max-only', () => {
    expect(deriveBinderName(makeInput({ priceMax: 5 }))).toContain('≤$5');
  });

  it('price min+max', () => {
    const name = deriveBinderName(makeInput({ priceMin: 1, priceMax: 10 }));
    expect(name).toContain('$1');
    expect(name).toContain('10');
  });

  it('cmc min-only', () => {
    expect(deriveBinderName(makeInput({ rarityExpr: chip('rare'), cmcMin: 3 }))).toContain(
      'Mana value 3+'
    );
  });

  it('cmc max-only', () => {
    expect(deriveBinderName(makeInput({ rarityExpr: chip('rare'), cmcMax: 2 }))).toContain(
      'Mana value ≤2'
    );
  });

  it('cmc min+max', () => {
    const name = deriveBinderName(makeInput({ rarityExpr: chip('rare'), cmcMin: 2, cmcMax: 4 }));
    expect(name).toContain('Mana value 2–4');
  });

  it('set filter included in name when under 3 parts', () => {
    const name = deriveBinderName(makeInput({ setFilter: new Set(['NEO', 'IKO']) }));
    expect(name).toContain('NEO');
    expect(name).toContain('IKO');
  });

  it('empty input returns "Filtered binder"', () => {
    expect(deriveBinderName(makeInput())).toBe('Filtered binder');
  });

  it('primary type chips included in name', () => {
    const name = deriveBinderName(makeInput({ typesExpr: chip('creature') }));
    expect(name).toContain('creature');
  });

  it('supertype chips included in name', () => {
    const name = deriveBinderName(makeInput({ supertypeExpr: chip('legendary') }));
    expect(name).toContain('legendary');
  });
});
