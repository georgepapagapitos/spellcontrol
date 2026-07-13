import { describe, expect, it } from 'vitest';
import { resolveGenerationDestination, checkGenerationGate } from './use-deck-generation';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { GeneratedDeck, ScryfallCard } from '@/deck-builder/types';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    oracle_id: 'oid-1',
    name: 'Test Card',
    cmc: 1,
    type_line: 'Instant',
    color_identity: ['U'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: {},
    ...overrides,
  } as ScryfallCard;
}

function generatedDeck(overrides: Partial<GeneratedDeck['categories']> = {}): GeneratedDeck {
  const lands = Array.from({ length: 37 }, (_, i) =>
    card({ name: `Land ${i}`, type_line: 'Land', color_identity: [] })
  );
  const spells = Array.from({ length: 62 }, (_, i) => card({ name: `Spell ${i}` }));
  return {
    commander: card({ name: 'Talrand', color_identity: ['U'] }),
    partnerCommander: null,
    categories: {
      lands,
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: spells,
      synergy: [],
      utility: [],
      ...overrides,
    },
    stats: {
      totalCards: 99,
      averageCmc: 3,
      manaCurve: {},
      colorDistribution: {},
      typeDistribution: {},
    },
  };
}

describe('checkGenerationGate', () => {
  const commander = DECK_FORMAT_CONFIGS.commander;

  it('passes a valid generated deck through untouched', () => {
    const result = checkGenerationGate(generatedDeck(), commander);
    expect(result).toEqual({ ok: true });
  });

  it('rejects and does not save an illegal/off-color card', () => {
    const bad = generatedDeck({ creatures: [card({ name: 'Off Color', color_identity: ['R'] })] });
    const result = checkGenerationGate(bad, commander);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/color identity/i);
    }
  });

  it('rejects a copy-limit violation', () => {
    const dupe = card({ name: 'Sol Ring', color_identity: [] });
    const bad = generatedDeck({ creatures: [dupe, dupe] });
    const result = checkGenerationGate(bad, commander);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Sol Ring/);
  });

  it('rejects a near-landless deck (land floor)', () => {
    const bad = generatedDeck({
      lands: Array.from({ length: 5 }, (_, i) => card({ name: `Land ${i}`, type_line: 'Land' })),
    });
    const result = checkGenerationGate(bad, commander);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/land floor/);
  });
});

describe('resolveGenerationDestination', () => {
  it('routes to the compare diff when the regenerate source deck still exists', () => {
    expect(resolveGenerationDestination('new-id', 'source-id', new Set(['source-id']))).toBe(
      '/decks/compare?a=source-id&b=new-id'
    );
  });

  it('falls back to the new deck editor when there is no source (a fresh build)', () => {
    expect(resolveGenerationDestination('new-id', undefined, new Set(['source-id']))).toBe(
      '/decks/new-id'
    );
  });

  it('falls back to the new deck editor when the source deck was deleted mid-generation', () => {
    expect(resolveGenerationDestination('new-id', 'source-id', new Set())).toBe('/decks/new-id');
  });
});
