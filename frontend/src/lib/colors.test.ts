import { describe, it, expect } from 'vitest';
import { getColorKey } from './colors';
import type { EnrichedCard } from '../types';

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
    ...overrides,
  };
}

describe('getColorKey', () => {
  it('returns "L" for cards with "land" in type line', () => {
    expect(getColorKey(makeCard({ typeLine: 'Basic Land — Forest', colorIdentity: ['G'] }))).toBe(
      'L'
    );
    expect(getColorKey(makeCard({ typeLine: 'Land', colorIdentity: [] }))).toBe('L');
  });

  it('returns "L" for basic land names when colorIdentity is missing', () => {
    expect(
      getColorKey(makeCard({ name: 'Forest', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('L');
    expect(
      getColorKey(makeCard({ name: 'Plains', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('L');
    expect(
      getColorKey(makeCard({ name: 'Island', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('L');
    expect(
      getColorKey(makeCard({ name: 'Swamp', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('L');
    expect(
      getColorKey(makeCard({ name: 'Mountain', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('L');
    expect(
      getColorKey(makeCard({ name: 'Wastes', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('L');
  });

  it('returns "?" when colorIdentity is missing and card is not a basic land', () => {
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: undefined }))).toBe('?');
  });

  it('returns "C" for colorless non-land cards', () => {
    expect(getColorKey(makeCard({ typeLine: 'Artifact', colorIdentity: [] }))).toBe('C');
    expect(getColorKey(makeCard({ typeLine: 'Creature — Eldrazi', colorIdentity: [] }))).toBe('C');
  });

  it('returns single color letter for mono-color cards', () => {
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: ['W'] }))).toBe('W');
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: ['U'] }))).toBe('U');
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: ['B'] }))).toBe('B');
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: ['R'] }))).toBe('R');
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: ['G'] }))).toBe('G');
  });

  it('returns "M" for multicolor cards', () => {
    expect(getColorKey(makeCard({ typeLine: 'Instant', colorIdentity: ['U', 'R'] }))).toBe('M');
    expect(
      getColorKey(makeCard({ typeLine: 'Creature', colorIdentity: ['W', 'U', 'B', 'R', 'G'] }))
    ).toBe('M');
  });

  it('land type takes precedence over colorIdentity', () => {
    // A fetch land has colorIdentity but should still be L
    expect(getColorKey(makeCard({ typeLine: 'Land', colorIdentity: ['U', 'R'] }))).toBe('L');
  });
});
