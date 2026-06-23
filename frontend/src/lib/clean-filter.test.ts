import { describe, it, expect } from 'vitest';
import { cleanFilter } from './clean-filter';
import type { BinderFilter } from '../types';

describe('cleanFilter', () => {
  it('preserves commanderEligible: true through save (regression for #235 leak)', () => {
    // Before the fix, cleanFilter's field whitelist omitted commanderEligible,
    // so a saved "Is commander" group silently lost the constraint and the
    // binder matched every cheap/popular artifact and land.
    expect(cleanFilter({ commanderEligible: true })).toEqual({ commanderEligible: true });
  });

  it('preserves commanderEligible: false', () => {
    expect(cleanFilter({ commanderEligible: false })).toEqual({ commanderEligible: false });
  });

  it('keeps commanderEligible absent when unset (no spurious key)', () => {
    expect(cleanFilter({}).commanderEligible).toBeUndefined();
    expect('commanderEligible' in cleanFilter({ priceMin: 0.4 })).toBe(false);
  });

  it('still passes representative scalar and chip fields through unchanged', () => {
    const f: BinderFilter = {
      priceMin: 0.4,
      edhrecRankMax: 500,
      typeChips: { chips: [{ value: 'Legendary Creature', negate: false }], joiners: [] },
      commanderEligible: true,
    };
    expect(cleanFilter(f)).toEqual(f);
  });

  // A3 — round-trip guards for chip fields that must survive cleanFilter.
  it('preserves supertypeChips through cleanFilter (regression guard)', () => {
    const f: BinderFilter = {
      supertypeChips: { chips: [{ value: 'legendary', negate: false }], joiners: [] },
    };
    expect(cleanFilter(f)).toEqual(f);
  });

  it('preserves subtypeChips through cleanFilter (regression guard)', () => {
    const f: BinderFilter = {
      subtypeChips: { chips: [{ value: 'angel', negate: false }], joiners: [] },
    };
    expect(cleanFilter(f)).toEqual(f);
  });

  it('preserves typeTokenChips through cleanFilter (regression guard)', () => {
    const f: BinderFilter = {
      typeTokenChips: { chips: [{ value: 'creature', negate: false }], joiners: [] },
    };
    expect(cleanFilter(f)).toEqual(f);
  });

  it('preserves oracleTagChips through cleanFilter (regression guard)', () => {
    const f: BinderFilter = {
      oracleTagChips: { chips: [{ value: 'mana-rock', negate: false }], joiners: [] },
    };
    expect(cleanFilter(f)).toEqual(f);
  });

  it('drops blank chips and empty fields as before', () => {
    expect(
      cleanFilter({
        typeChips: { chips: [{ value: '  ', negate: false }], joiners: [] },
        nameContains: '   ',
      })
    ).toEqual({});
  });

  it('re-indexes joiners when a middle chip is dropped (leading-no-joiner invariant)', () => {
    // chips: A  OR  (blank)  AND  B  → drop blank → A <joiner that was after A> B
    const cleaned = cleanFilter({
      typeChips: {
        chips: [
          { value: 'A', negate: false },
          { value: '  ', negate: false },
          { value: 'B', negate: true },
        ],
        joiners: ['OR', 'AND'],
      },
    });
    expect(cleaned.typeChips).toEqual({
      chips: [
        { value: 'A', negate: false },
        { value: 'B', negate: true },
      ],
      joiners: ['OR'],
    });
  });

  it('trims chip values and applies scalar guards (NaN dropped, setCodes upper-cased)', () => {
    const cleaned = cleanFilter({
      typeChips: { chips: [{ value: '  Goblin  ', negate: false }], joiners: [] },
      cmcMin: NaN,
      cmcMax: 4,
      priceMin: NaN,
      setCodes: ['neo', 'mh3'],
      manaCost: '  {1}{R}  ',
    });
    expect(cleaned).toEqual({
      typeChips: { chips: [{ value: 'Goblin', negate: false }], joiners: [] },
      cmcMax: 4,
      setCodes: ['NEO', 'MH3'],
      manaCost: '{1}{R}',
    });
  });

  it('preserves a resolved scryfallQuery through save (whitelist regression guard)', () => {
    const f: BinderFilter = {
      scryfallQuery: { query: 'is:shockland', oracleIds: ['a', 'b'], resolvedAt: 123 },
    };
    expect(cleanFilter(f)).toEqual(f);
  });

  it('trims the query and keeps empty oracleIds (authored but unresolved)', () => {
    expect(cleanFilter({ scryfallQuery: { query: '  is:dual  ', oracleIds: [] } })).toEqual({
      scryfallQuery: { query: 'is:dual', oracleIds: [] },
    });
  });

  it('drops a blank-query scryfallQuery entirely', () => {
    expect('scryfallQuery' in cleanFilter({ scryfallQuery: { query: '   ', oracleIds: [] } })).toBe(
      false
    );
  });
});
