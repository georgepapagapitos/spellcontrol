import { describe, expect, it } from 'vitest';
import {
  NO_DISCOVER_FILTERS,
  discoverFiltersToSearchParams,
  parseDiscoverFiltersFromSearchParams,
  type DiscoverFilters,
} from './discover-filters';

function roundTrip(filters: DiscoverFilters): DiscoverFilters {
  return parseDiscoverFiltersFromSearchParams(discoverFiltersToSearchParams(filters));
}

describe('discover-filters round trip', () => {
  it('absent filters parse to the no-filter shape', () => {
    expect(parseDiscoverFiltersFromSearchParams(new URLSearchParams())).toEqual(
      NO_DISCOVER_FILTERS
    );
    expect(discoverFiltersToSearchParams(NO_DISCOVER_FILTERS).toString()).toBe('');
  });

  it('round-trips a commander filter', () => {
    const filters: DiscoverFilters = {
      ...NO_DISCOVER_FILTERS,
      commander: "Atraxa, Praetors' Voice",
    };
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('round-trips a format filter', () => {
    const filters: DiscoverFilters = { ...NO_DISCOVER_FILTERS, format: 'commander' };
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('round-trips multi-value brackets, sorted and deduped', () => {
    const params = new URLSearchParams({ bracket: '3,1,3,5' });
    expect(parseDiscoverFiltersFromSearchParams(params).brackets).toEqual([1, 3, 5]);
    const filters: DiscoverFilters = { ...NO_DISCOVER_FILTERS, brackets: [2, 4] };
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('round-trips multi-value colors, canonicalized to WUBRGC order and deduped', () => {
    const params = new URLSearchParams({ colors: 'g,w,w,u' });
    expect(parseDiscoverFiltersFromSearchParams(params).colors).toEqual(['W', 'U', 'G']);
    const filters: DiscoverFilters = { ...NO_DISCOVER_FILTERS, colors: ['U', 'B', 'R'] };
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('round-trips a budget filter', () => {
    const filters: DiscoverFilters = { ...NO_DISCOVER_FILTERS, budget: '50to150' };
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('round-trips every dimension set at once', () => {
    const filters: DiscoverFilters = {
      commander: 'Korvold, Fae-Cursed King',
      format: 'commander',
      brackets: [2, 3],
      colors: ['B', 'R', 'G'],
      budget: '400plus',
    };
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('falls back to no-filter on a malformed/unknown format instead of throwing', () => {
    const params = new URLSearchParams({ format: 'nonsense-format' });
    expect(() => parseDiscoverFiltersFromSearchParams(params)).not.toThrow();
    expect(parseDiscoverFiltersFromSearchParams(params).format).toBeNull();
  });

  it('falls back to no-filter on malformed bracket values', () => {
    const params = new URLSearchParams({ bracket: 'abc,-1,0,99,' });
    expect(parseDiscoverFiltersFromSearchParams(params).brackets).toEqual([]);
  });

  it('falls back to no-filter on malformed color codes', () => {
    const params = new URLSearchParams({ colors: 'X,Y,' });
    expect(parseDiscoverFiltersFromSearchParams(params).colors).toEqual([]);
  });

  it('falls back to no-filter on an unknown budget value', () => {
    const params = new URLSearchParams({ budget: 'super-expensive' });
    expect(parseDiscoverFiltersFromSearchParams(params).budget).toBeNull();
  });

  it('trims whitespace from the commander filter and treats blank as absent', () => {
    expect(
      parseDiscoverFiltersFromSearchParams(new URLSearchParams({ commander: '  Sol Ring  ' }))
        .commander
    ).toBe('Sol Ring');
    expect(
      parseDiscoverFiltersFromSearchParams(new URLSearchParams({ commander: '   ' })).commander
    ).toBeNull();
  });
});
