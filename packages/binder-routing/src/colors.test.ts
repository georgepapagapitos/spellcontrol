import { describe, it, expect } from 'vitest';
import { getColorKey, getColorKeyFromIdentity, isLand, COLOR_INFO } from './colors.js';
import type { EnrichedCard } from './types.js';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
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
    finish: 'nonfoil',
    ...overrides,
  };
}

describe('getColorKey', () => {
  it('groups lands by their color identity', () => {
    expect(getColorKey(makeCard({ typeLine: 'Basic Land — Forest', colorIdentity: ['G'] }))).toBe(
      'G'
    );
    expect(getColorKey(makeCard({ typeLine: 'Basic Land — Plains', colorIdentity: ['W'] }))).toBe(
      'W'
    );
    // Wastes / colorless lands → C
    expect(getColorKey(makeCard({ typeLine: 'Basic Land — Wastes', colorIdentity: [] }))).toBe('C');
    // Dual / fetch lands → M
    expect(getColorKey(makeCard({ typeLine: 'Land', colorIdentity: ['U', 'R'] }))).toBe('M');
  });

  it('falls back to basic land names when colorIdentity is missing', () => {
    expect(
      getColorKey(makeCard({ name: 'Forest', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('G');
    expect(
      getColorKey(makeCard({ name: 'Plains', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('W');
    expect(
      getColorKey(makeCard({ name: 'Island', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('U');
    expect(
      getColorKey(makeCard({ name: 'Swamp', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('B');
    expect(
      getColorKey(makeCard({ name: 'Mountain', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('R');
    expect(
      getColorKey(makeCard({ name: 'Wastes', typeLine: undefined, colorIdentity: undefined }))
    ).toBe('C');
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

  it('groups non-lands by printed color, not color identity from rules text', () => {
    // Shalai, Voice of Plenty: {3}{W} cost but a "{4}{G}{G}:" ability, so
    // Scryfall reports color_identity ['G','W']. ManaBox-style: this is White.
    expect(
      getColorKey(
        makeCard({
          name: 'Shalai, Voice of Plenty',
          typeLine: 'Legendary Creature — Angel',
          colors: ['W'],
          colorIdentity: ['G', 'W'],
        })
      )
    ).toBe('W');
  });

  it('groups a transform card by its front face, not the combined identity', () => {
    // "Ashling, Rekindled // Ashling, Rimebound": front {1}{R} (red), back is
    // blue, so Scryfall color_identity is ['R','U']. Enrichment resolves
    // colors to the front face (['R']) since transform has no top-level
    // colors, so this groups under Red — not Multicolor.
    expect(
      getColorKey(
        makeCard({
          name: 'Ashling, Rekindled // Ashling, Rimebound',
          typeLine: 'Legendary Creature — Elemental Sorcerer',
          colors: ['R'],
          colorIdentity: ['R', 'U'],
        })
      )
    ).toBe('R');
  });

  it('treats devoid / colorless-but-identity-colored cards as colorless', () => {
    // Devoid: colors [] even though the {U} cost gives it color_identity ['U'].
    expect(
      getColorKey(
        makeCard({ typeLine: 'Creature — Eldrazi Drone', colors: [], colorIdentity: ['U'] })
      )
    ).toBe('C');
  });

  it('still groups lands by color identity even when colors is empty', () => {
    // Lands are colorless (colors []) but should bucket by identity.
    expect(
      getColorKey(
        makeCard({ typeLine: 'Land', name: 'Temple Garden', colors: [], colorIdentity: ['G', 'W'] })
      )
    ).toBe('M');
    expect(
      getColorKey(makeCard({ typeLine: 'Basic Land — Forest', colors: [], colorIdentity: ['G'] }))
    ).toBe('G');
  });
});

describe('COLOR_INFO', () => {
  it('has an entry for every color key the rest of the app consumes', () => {
    for (const k of ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L', '?', 'ALL']) {
      expect(COLOR_INFO[k], `missing COLOR_INFO entry for "${k}"`).toBeDefined();
      expect(COLOR_INFO[k].pip).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(COLOR_INFO[k].label.length).toBeGreaterThan(0);
    }
  });
});

describe('getColorKeyFromIdentity', () => {
  it('returns C for empty identity (colorless)', () => {
    expect(getColorKeyFromIdentity([])).toBe('C');
  });
  it('returns the single color letter for mono-color identity', () => {
    expect(getColorKeyFromIdentity(['W'])).toBe('W');
    expect(getColorKeyFromIdentity(['G'])).toBe('G');
  });
  it('returns M for multicolor identity', () => {
    expect(getColorKeyFromIdentity(['U', 'R'])).toBe('M');
    expect(getColorKeyFromIdentity(['W', 'U', 'B', 'R', 'G'])).toBe('M');
  });
});

describe('isLand', () => {
  it('detects lands by type line', () => {
    expect(isLand(makeCard({ typeLine: 'Basic Land — Forest' }))).toBe(true);
    expect(isLand(makeCard({ typeLine: 'Land — Swamp Mountain' }))).toBe(true);
    expect(isLand(makeCard({ typeLine: 'Legendary Land' }))).toBe(true);
  });

  it('detects basic lands by name when type line is missing', () => {
    expect(isLand(makeCard({ name: 'Forest', typeLine: undefined }))).toBe(true);
    expect(isLand(makeCard({ name: 'Wastes', typeLine: undefined }))).toBe(true);
  });

  it('returns false for non-lands', () => {
    expect(isLand(makeCard({ typeLine: 'Instant' }))).toBe(false);
    expect(isLand(makeCard({ typeLine: 'Creature — Bear' }))).toBe(false);
  });
});
