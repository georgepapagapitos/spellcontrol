import { describe, it, expect } from 'vitest';
import { flavorNameOf, printedName, nameMatchesNormalized } from './printed-name.js';
import { normalizeForSearch } from './normalize-search.js';
import { sortCards } from './sorting.js';
import { cardMatchesFilter } from './rules.js';
import { getSectionMeta } from './sections.js';
import { FLAVOR_NAMES } from './flavor-names.js';
import type { EnrichedCard } from './types.js';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Alpha',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'abc-123',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

// The Final Fantasy "through the ages" printing that reads "A Promise Fulfilled".
const promise = makeCard({ name: 'Light Up the Stage', setCode: 'FCA', collectorNumber: '39' });
const plainStage = makeCard({ name: 'Light Up the Stage', setCode: 'RNA', collectorNumber: '107' });
const bolt = makeCard({ name: 'Lightning Bolt' });

describe('printed name', () => {
  it('reads the flavor name for a flavor-named printing, from any card shape', () => {
    expect(printedName(promise)).toBe('A Promise Fulfilled');
    expect(printedName({ name: 'Light Up the Stage', set: 'fca', collector_number: '39' })).toBe(
      'A Promise Fulfilled'
    );
    expect(printedName(plainStage)).toBe('Light Up the Stage');
    expect(flavorNameOf(plainStage)).toBeUndefined();
  });

  it("prefers a live Scryfall card's own flavor_name", () => {
    expect(printedName({ name: 'X', set: 'zzz', collector_number: '1', flavor_name: 'Y' })).toBe(
      'Y'
    );
  });

  it('keeps both faces of a double-faced flavor-named printing', () => {
    expect(FLAVOR_NAMES['sld:1675']).toBe('African Swallow // European Swallow');
  });

  it('sorts by the name on the card', () => {
    const sorted = sortCards([bolt, plainStage, promise], [{ field: 'name', dir: 'asc' }]);
    expect(sorted.map(printedName)).toEqual([
      'A Promise Fulfilled',
      'Light Up the Stage',
      'Lightning Bolt',
    ]);
  });

  it('files the A–Z section under the printed name', () => {
    expect(getSectionMeta(promise, 'name').label).toBe('A');
  });

  it('matches a search on either name', () => {
    const q = (s: string) => normalizeForSearch(s);
    expect(nameMatchesNormalized(promise, q('a promise'))).toBe(true);
    expect(nameMatchesNormalized(promise, q('light up'))).toBe(true);
    expect(nameMatchesNormalized(plainStage, q('a promise'))).toBe(false);
    const f = { nameContains: 'promise fulfilled' };
    expect(cardMatchesFilter(promise, f)).toBe(true);
    expect(cardMatchesFilter(plainStage, f)).toBe(false);
  });
});
