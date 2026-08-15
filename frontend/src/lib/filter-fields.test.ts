import { describe, expect, it } from 'vitest';
import {
  FILTER_FIELDS,
  searchFilterFields,
  setFilterFields,
  type FilterFieldId,
} from './filter-fields';
import { isFilterEmpty } from './rules';
import type { BinderFilter } from '../types';

const chips = (...values: string[]) => ({
  chips: values.map((value) => ({ value, negate: false })),
  joiners: values.slice(1).map(() => 'OR' as const),
});

describe('the registry covers the whole vocabulary', () => {
  it('has no duplicate ids', () => {
    const ids = FILTER_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The registry drives which rows can appear at all, so a field the engine
  // supports but the registry forgets becomes unreachable in the editor: it
  // would never render, and the picker would never offer it.
  it('every field it lists can be set and then cleared back to empty', () => {
    const samples: Partial<Record<FilterFieldId, BinderFilter>> = {
      typeChips: { typeChips: chips('creature') },
      supertypeChips: { supertypeChips: chips('legendary') },
      typeTokenChips: { typeTokenChips: chips('instant') },
      subtypeChips: { subtypeChips: chips('angel') },
      colors: { colors: chips('W') },
      commanderEligible: { commanderEligible: true },
      cmc: { cmcMin: 2, cmcMax: 5 },
      manaCost: { manaCost: '{2}{G}' },
      nameContains: { nameContains: 'dragon' },
      oracleChips: { oracleChips: chips('flying') },
      oracleTagChips: { oracleTagChips: chips('ramp') },
      rarities: { rarities: chips('mythic') },
      setCodes: { setCodes: ['MKM'] },
      layouts: { layouts: chips('split') },
      treatments: { treatments: chips('showcase') },
      borderColors: { borderColors: chips('borderless') },
      finishes: { finishes: chips('foil') },
      price: { priceMin: 1, priceMax: 10 },
      edhrecRankMax: { edhrecRankMax: 100 },
      legalities: { legalities: chips('commander') },
      proxy: { proxy: false },
      scryfallQuery: { scryfallQuery: { query: 'is:shockland', oracleIds: [] } },
    };

    for (const spec of FILTER_FIELDS) {
      const sample = samples[spec.id];
      expect(sample, `no sample for ${spec.id}`).toBeDefined();
      expect(spec.isSet(sample!), `${spec.id} should read as set`).toBe(true);
      // Clearing it must leave nothing behind — a `clear()` that misses half a
      // pair (price min but not max) would take the row away while the rule
      // kept filtering.
      expect(isFilterEmpty({ ...sample!, ...spec.clear() }), `${spec.id} clear()`).toBe(true);
    }
  });

  it('reports exactly the fields a filter carries', () => {
    const f: BinderFilter = { nameContains: 'sol', priceMax: 5 };
    expect(setFilterFields(f)).toEqual(new Set(['nameContains', 'price']));
    expect(setFilterFields({})).toEqual(new Set());
  });
});

describe('picker search', () => {
  const none = new Set<FilterFieldId>();

  it('returns every group when the query is blank', () => {
    const total = searchFilterFields('', none).flatMap((s) => s.fields).length;
    expect(total).toBe(FILTER_FIELDS.length);
  });

  it('hides fields already in the group', () => {
    const ids = searchFilterFields('', new Set<FilterFieldId>(['price', 'cmc']))
      .flatMap((s) => s.fields)
      .map((f) => f.id);
    expect(ids).not.toContain('price');
    expect(ids).not.toContain('cmc');
  });

  it('matches on keywords, not just the label', () => {
    // The point of the search box: you know what you want, not what we called it.
    const find = (q: string) =>
      searchFilterFields(q, none)
        .flatMap((s) => s.fields)
        .map((f) => f.id);
    expect(find('cmc')).toContain('cmc');
    expect(find('foil')).toContain('finishes');
    expect(find('staple')).toContain('edhrecRankMax');
    expect(find('modern')).toContain('legalities');
  });

  it('matches on the hint too', () => {
    expect(
      searchFilterFields('after the dash', none)
        .flatMap((s) => s.fields)
        .map((f) => f.id)
    ).toEqual(['subtypeChips']);
  });

  it('drops empty groups rather than rendering bare headings', () => {
    const sections = searchFilterFields('syntax', none);
    expect(sections).toHaveLength(1);
    expect(sections[0].group).toBe('Advanced');
  });

  it('matching across groups keeps each match under its own heading', () => {
    // "scryfall" is in the Scryfall query field AND in Oracle tags' hint
    // ("Scryfall's curated concepts") — both are genuine answers to that query.
    const sections = searchFilterFields('scryfall', none);
    expect(sections.map((s) => s.group)).toEqual(['Text', 'Advanced']);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchFilterFields('zzzznope', none)).toEqual([]);
  });

  // The four type predicates are the reason hints exist: their names alone
  // never said which one you wanted.
  it('gives every overlapping type field a distinguishing hint', () => {
    for (const id of ['typeChips', 'supertypeChips', 'typeTokenChips', 'subtypeChips'] as const) {
      expect(FILTER_FIELDS.find((f) => f.id === id)?.hint, id).toBeTruthy();
    }
  });
});
