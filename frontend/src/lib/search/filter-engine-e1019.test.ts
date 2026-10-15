import { describe, expect, it } from 'vitest';
import { compileFilter } from '@spellcontrol/binder-routing';
import { cleanFilter } from './clean-filter';
import { countMatchingRows, rowMatchesCollectionFilter } from './collection-filter';
import {
  collectionFiltersToFilterGroup,
  hasStructuredFilter,
} from './collection-filters-to-binder';
import type { CollectionFilterInput } from './collection-filters-to-binder';
import { FILTER_FIELDS } from './filter-fields';
import { autoSummary, colorChipLabel, manaSymbolsLabel, manaValuesLabel } from './filter-summary';
import {
  buildMatchFilter,
  type MatchFilterState,
} from '@/components/collection/card-list-table-derive';
import { buildSharedBinderFilter, type SharedFilterState } from '@/lib/social/shared-filter';
import type { BinderFilter, EnrichedCard } from '@/types/index';

// Real Scryfall data (mana_cost / cmc / color_identity as printed).
const card = (over: Partial<EnrichedCard>): EnrichedCard =>
  ({ setCode: 'TST', setName: 'Test', collectorNumber: '1', quantity: 1, ...over }) as EnrichedCard;
const HELIX = card({
  name: 'Lightning Helix',
  manaCost: '{R}{W}',
  cmc: 2,
  colors: ['R', 'W'],
  colorIdentity: ['R', 'W'],
});
const SOL_RING = card({ name: 'Sol Ring', manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [] });
const VINDICATE = card({
  name: 'Vindicate',
  manaCost: '{1}{W}{B}',
  cmc: 3,
  colors: ['W', 'B'],
  colorIdentity: ['W', 'B'],
});
const GRAY = card({
  name: 'Gray Merchant of Asphodel',
  manaCost: '{3}{B}{B}',
  cmc: 5,
  colors: ['B'],
  colorIdentity: ['B'],
});

const empty = { chips: [], joiners: [] };

describe('collection filter with within mode', () => {
  const c = (colors: string[]) => ({
    matchFilter: compileFilter({}),
    colors: new Set(colors),
    colorMode: 'within' as const,
  });
  const rows = [HELIX, SOL_RING, VINDICATE, GRAY].map((card) => ({ card, binderName: null }));

  it('counts a Boros commander pool: Helix and Sol Ring, never Vindicate', () => {
    expect(countMatchingRows(rows, c(['R', 'W']))).toBe(2);
    expect(rowMatchesCollectionFilter(rows[2], c(['R', 'W']))).toBe(false);
  });

  it('selecting only C is colorless only', () => {
    expect(countMatchingRows(rows, c(['C']))).toBe(1);
  });
});

describe('mana value set and mana symbols through the collection filter state', () => {
  const state = (over: Partial<MatchFilterState>): MatchFilterState => ({
    supertypeExpr: empty,
    typesExpr: empty,
    subtypeExpr: empty,
    rarityExpr: empty,
    oracleExpr: empty,
    oracleTagExpr: empty,
    scryfallQuery: undefined,
    legalityExpr: empty,
    layoutExpr: empty,
    treatmentExpr: empty,
    borderExpr: empty,
    finishExpr: empty,
    setFilter: new Set(),
    priceMin: undefined,
    priceMax: undefined,
    cmcMin: undefined,
    cmcMax: undefined,
    debouncedSearch: '',
    ...over,
  });
  const rows = [HELIX, SOL_RING, VINDICATE, GRAY].map((card) => ({ card, binderName: null }));
  const count = (f: BinderFilter) =>
    countMatchingRows(rows, {
      matchFilter: compileFilter(f),
      colors: new Set(),
      colorMode: 'any',
    });

  it('buildMatchFilter carries both fields and the engine applies them', () => {
    const f = buildMatchFilter(state({ manaValues: { values: [1, 2], atLeast: 5 } }));
    expect(f.manaValues).toEqual({ values: [1, 2], atLeast: 5 });
    expect(count(f)).toBe(3); // Helix 2, Sol Ring 1, Gray Merchant 5+
    const g = buildMatchFilter(state({ manaSymbols: { counts: { B: 2 }, mode: 'atLeast' } }));
    expect(count(g)).toBe(1);
  });

  it('inactive values are omitted from the engine filter', () => {
    const f = buildMatchFilter(
      state({ manaValues: { values: [] }, manaSymbols: { counts: {}, mode: 'atLeast' } })
    );
    expect(f).toEqual({});
  });

  it('shared views build the same fields', () => {
    const s: SharedFilterState = {
      supertypeExpr: empty,
      typesExpr: empty,
      subtypeExpr: empty,
      colorFilter: new Set(),
      colorMode: 'within',
      rarityExpr: empty,
      oracleExpr: empty,
      oracleTagExpr: empty,
      legalityExpr: empty,
      layoutExpr: empty,
      treatmentExpr: empty,
      borderExpr: empty,
      finishExpr: empty,
      setFilter: new Set(),
      manaValues: { values: [3] },
      manaSymbols: { counts: { W: 1 }, mode: 'exactColored' },
    };
    const f = buildSharedBinderFilter(s);
    expect(f.manaValues).toEqual({ values: [3] });
    expect(f.manaSymbols).toEqual({ counts: { W: 1 }, mode: 'exactColored' });
  });
});

describe('Save as binder carries the new collection filters', () => {
  const input = (over: Partial<CollectionFilterInput> = {}): CollectionFilterInput => ({
    colorFilter: new Set(),
    supertypeExpr: empty,
    typesExpr: empty,
    subtypeExpr: empty,
    rarityExpr: empty,
    oracleExpr: empty,
    oracleTagExpr: empty,
    scryfallQuery: undefined,
    legalityExpr: empty,
    layoutExpr: empty,
    treatmentExpr: empty,
    borderExpr: empty,
    finishExpr: empty,
    conditionExpr: empty,
    languageExpr: empty,
    binderExpr: empty,
    setFilter: new Set(),
    priceMin: undefined,
    priceMax: undefined,
    cmcMin: undefined,
    cmcMax: undefined,
    search: '',
    ...over,
  });

  it('keeps within mode on the binder colorIdentity rule', () => {
    const { group } = collectionFiltersToFilterGroup(
      input({ colorFilter: new Set(['R', 'W']), colorMode: 'within' })
    );
    expect(group.filter.colorIdentity).toEqual({ colors: ['R', 'W'], mode: 'within' });
  });

  it('maps manaValues and manaSymbols, and they count as structured filters', () => {
    const i = input({
      manaValues: { values: [2], atLeast: 7 },
      manaSymbols: { counts: { B: 2 }, mode: 'atLeast' },
    });
    expect(hasStructuredFilter(i)).toBe(true);
    const { group } = collectionFiltersToFilterGroup(i);
    expect(group.filter.manaValues).toEqual({ values: [2], atLeast: 7 });
    expect(group.filter.manaSymbols).toEqual({ counts: { B: 2 }, mode: 'atLeast' });
    expect(hasStructuredFilter(input())).toBe(false);
  });
});

describe('cleanFilter keeps the new fields (the whitelist guard)', () => {
  it('persists manaValues sorted and de-duplicated, with atLeast', () => {
    expect(cleanFilter({ manaValues: { values: [3, 1, 3, NaN], atLeast: 7 } }).manaValues).toEqual({
      values: [1, 3],
      atLeast: 7,
    });
  });

  it('persists manaSymbols and drops inactive ones', () => {
    const q = { counts: { B: 2, W: 0 }, mode: 'atLeast' as const, hybrid: false, noCost: true };
    expect(cleanFilter({ manaSymbols: q }).manaSymbols).toEqual({
      counts: { B: 2 },
      mode: 'atLeast',
      hybrid: false,
      noCost: true,
    });
    expect(cleanFilter({ manaSymbols: { counts: {}, mode: 'atLeast' } })).toEqual({});
    expect(cleanFilter({ manaValues: { values: [] } })).toEqual({});
  });

  it('keeps the within color mode', () => {
    expect(
      cleanFilter({ colorIdentity: { colors: ['G'], mode: 'within' } }).colorIdentity?.mode
    ).toBe('within');
  });

  it('survives a JSON round trip (sync / share payload shape)', () => {
    const f = cleanFilter({
      colorIdentity: { colors: ['U', 'B'], mode: 'within' },
      manaValues: { values: [0, 1], atLeast: 7 },
      manaSymbols: { counts: { U: 1 }, mode: 'exactColored', noColored: true },
    });
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);
  });
});

describe('registry and summaries know the new fields', () => {
  const field = (id: string) => FILTER_FIELDS.find((f) => f.id === id)!;

  it('Mana value and Mana symbols report set and clear the new fields', () => {
    const mv: BinderFilter = { manaValues: { values: [2] } };
    expect(field('cmc').isSet(mv)).toBe(true);
    expect(field('cmc').clear()).toMatchObject({ manaValues: undefined });
    const ms: BinderFilter = { manaSymbols: { counts: { B: 2 }, mode: 'atLeast' } };
    expect(field('manaSymbols').isSet(ms)).toBe(true);
    expect(field('manaSymbols').clear()).toMatchObject({ manaSymbols: undefined });
    expect(field('cmc').isSet({ manaValues: { values: [] } })).toBe(false);
  });

  it('labels', () => {
    expect(colorChipLabel(['R', 'W'], 'within')).toBe('within Red, White');
    expect(manaValuesLabel({ values: [1, 2], atLeast: 7 })).toBe('Mana value 1, 2, 7+');
    expect(manaValuesLabel({ values: [] })).toBe('');
    expect(manaSymbolsLabel({ counts: { B: 2 }, mode: 'atLeast' })).toBe('Cost BB');
    expect(manaSymbolsLabel({ counts: { W: 1, U: 1 }, mode: 'exactColored' })).toBe(
      'Cost exactly WU'
    );
    expect(manaSymbolsLabel({ counts: {}, mode: 'atLeast', noCost: true })).toBe('Cost no cost');
    expect(autoSummary({ manaValues: { values: [3] } })).toBe('Mana value 3');
  });
});
