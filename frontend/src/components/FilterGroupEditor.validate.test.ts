import { describe, expect, it } from 'vitest';
import { validateGroups, validateRanges } from './FilterGroupEditor';
import { isFilterEmpty } from '../lib/rules';
import type { BinderFilter } from '../types';

describe('validateRanges', () => {
  it('accepts a sane range', () => {
    expect(validateRanges({ priceMin: 1, priceMax: 10 })).toBeNull();
  });

  it('rejects min above max', () => {
    expect(validateRanges({ priceMin: 10, priceMax: 1 })).toMatch(/Price minimum/);
    expect(validateRanges({ cmcMin: 6, cmcMax: 2 })).toMatch(/Mana value minimum/);
  });

  // A NaN reaches the filter from `parseFloat('')` in the number inputs. Every
  // comparison in this function is `false` against NaN, so it used to sail
  // through, compile into the matcher as a constraint nothing can fail, and
  // read as "no minimum" — while `cleanFilter` stripped it on save, so the live
  // count and the saved rule disagreed.
  it('catches NaN on every numeric field', () => {
    expect(validateRanges({ priceMin: NaN })).toMatch(/Price minimum isn't a number/);
    expect(validateRanges({ priceMax: NaN })).toMatch(/Price maximum isn't a number/);
    expect(validateRanges({ cmcMin: NaN })).toMatch(/Mana value minimum isn't a number/);
    expect(validateRanges({ cmcMax: NaN })).toMatch(/Mana value maximum isn't a number/);
    expect(validateRanges({ edhrecRankMax: NaN })).toMatch(/EDHREC top N isn't a number/);
  });

  // Only the MIN of each pair was checked. A lone negative max means "nothing
  // over -5", which matches zero cards — exactly the typo worth catching.
  it('rejects a negative maximum on its own', () => {
    expect(validateRanges({ priceMax: -5 })).toMatch(/Price can't be negative/);
    expect(validateRanges({ cmcMax: -1 })).toMatch(/Mana value can't be negative/);
  });

  it('still rejects a negative minimum', () => {
    expect(validateRanges({ priceMin: -1 })).toMatch(/Price can't be negative/);
    expect(validateRanges({ cmcMin: -1 })).toMatch(/Mana value can't be negative/);
  });

  it('rejects an EDHREC top-N below 1', () => {
    expect(validateRanges({ edhrecRankMax: 0 })).toMatch(/at least 1/);
  });
});

describe('validateGroups', () => {
  it('passes a clean chain', () => {
    expect(validateGroups([{ filter: { cmcMin: 1 } }, { filter: { priceMax: 5 } }])).toBeNull();
  });

  it('names the offending group when there is more than one', () => {
    const err = validateGroups([{ filter: {} }, { filter: { priceMin: 9, priceMax: 1 } }]);
    expect(err).toMatch(/^Rule group 2: /);
  });

  it('does not number a lone group', () => {
    expect(validateGroups([{ filter: { priceMin: 9, priceMax: 1 } }])).not.toMatch(/Rule group/);
  });
});

describe('isFilterEmpty — the shadowed copy is gone', () => {
  // FilterGroupEditor carried a private reimplementation that forgot
  // `scryfallQuery`, so a group whose ONLY rule was a Scryfall query read as
  // empty and kept the starter-template strip rendered on top of it.
  it('counts a Scryfall-query-only filter as non-empty', () => {
    const f: BinderFilter = { scryfallQuery: { query: 'is:shockland', oracleIds: [] } };
    expect(isFilterEmpty(f)).toBe(false);
  });

  it('still calls a blank filter empty', () => {
    expect(isFilterEmpty({})).toBe(true);
    expect(isFilterEmpty({ scryfallQuery: { query: '   ', oracleIds: [] } })).toBe(true);
  });
});
