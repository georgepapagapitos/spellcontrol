import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { EnrichedCard } from '../types';
import { buildCardImageIndex, buildCardIndex } from './deck-card-index';

// ── Minimal stubs ────────────────────────────────────────────────────────────

function scryfall(
  name: string,
  oracleId: string,
  overrides: Partial<ScryfallCard> = {}
): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: oracleId,
    name,
    cmc: 0,
    type_line: 'Instant',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function enriched(
  name: string,
  oracleId?: string,
  imageNormal?: string,
  imageSmall?: string
): EnrichedCard {
  return {
    copyId: `copy-${name}`,
    name,
    oracleId,
    scryfallId: `scry-${name}`,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    imageNormal,
    imageSmall,
  } as EnrichedCard;
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Test Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    ...overrides,
  } as unknown as Deck;
}

// ── buildCardImageIndex ──────────────────────────────────────────────────────

describe('buildCardImageIndex', () => {
  it('indexes collection by oracle id and lowercased name', () => {
    const col = [enriched('Sol Ring', 'oracle-sol', 'https://cdn/sol.jpg')];
    const idx = buildCardImageIndex(col, null);

    expect(idx.byOracle.get('oracle-sol')).toBe('https://cdn/sol.jpg');
    expect(idx.byName.get('sol ring')).toBe('https://cdn/sol.jpg');
  });

  it('falls back to imageSmall when imageNormal is absent', () => {
    const col = [
      enriched('Lightning Bolt', 'oracle-bolt', undefined, 'https://cdn/bolt-small.jpg'),
    ];
    const idx = buildCardImageIndex(col, null);

    expect(idx.byName.get('lightning bolt')).toBe('https://cdn/bolt-small.jpg');
  });

  it('skips entries with no image', () => {
    const col = [enriched('Nameless Card', 'oracle-none', undefined, undefined)];
    const idx = buildCardImageIndex(col, null);

    expect(idx.byOracle.size).toBe(0);
    expect(idx.byName.size).toBe(0);
  });

  it('indexes deck commander by oracle id and name', () => {
    const d = deck({
      commander: scryfall('Atraxa', 'oracle-atraxa', {
        image_uris: {
          small: 'https://cdn/atraxa-sm.jpg',
          normal: 'https://cdn/atraxa.jpg',
          large: '',
          png: '',
          art_crop: '',
          border_crop: '',
        },
      }),
    });
    const idx = buildCardImageIndex([], d);

    expect(idx.byOracle.get('oracle-atraxa')).toBe('https://cdn/atraxa.jpg');
    expect(idx.byName.get('atraxa')).toBe('https://cdn/atraxa.jpg');
  });

  it('indexes deck mainboard cards', () => {
    const d = deck({
      cards: [
        {
          slotId: 's1',
          card: scryfall('Counterspell', 'oracle-counter', {
            image_uris: {
              small: '',
              normal: 'https://cdn/counter.jpg',
              large: '',
              png: '',
              art_crop: '',
              border_crop: '',
            },
          }),
          allocatedCopyId: null,
        },
      ],
    });
    const idx = buildCardImageIndex([], d);

    expect(idx.byName.get('counterspell')).toBe('https://cdn/counter.jpg');
  });

  it('uses card_faces image when image_uris is absent', () => {
    const d = deck({
      cards: [
        {
          slotId: 's1',
          card: scryfall('Delver of Secrets', 'oracle-delver', {
            card_faces: [
              {
                name: 'Delver of Secrets',
                type_line: 'Creature',
                image_uris: {
                  small: 'https://cdn/delver-sm.jpg',
                  normal: 'https://cdn/delver.jpg',
                  large: '',
                  art_crop: '',
                },
              },
            ],
          }),
          allocatedCopyId: null,
        },
      ],
    });
    const idx = buildCardImageIndex([], d);

    expect(idx.byName.get('delver of secrets')).toBe('https://cdn/delver.jpg');
  });

  it('collection wins over deck on duplicate name', () => {
    const col = [enriched('Brainstorm', 'oracle-bs', 'https://cdn/bs-collection.jpg')];
    const d = deck({
      cards: [
        {
          slotId: 's1',
          card: scryfall('Brainstorm', 'oracle-bs', {
            image_uris: {
              small: '',
              normal: 'https://cdn/bs-deck.jpg',
              large: '',
              png: '',
              art_crop: '',
              border_crop: '',
            },
          }),
          allocatedCopyId: null,
        },
      ],
    });
    const idx = buildCardImageIndex(col, d);

    // Collection's URL should win (indexed first).
    expect(idx.byName.get('brainstorm')).toBe('https://cdn/bs-collection.jpg');
    expect(idx.byOracle.get('oracle-bs')).toBe('https://cdn/bs-collection.jpg');
  });

  it('returns empty maps when called with no collection and null deck', () => {
    const idx = buildCardImageIndex([], null);
    expect(idx.byOracle.size).toBe(0);
    expect(idx.byName.size).toBe(0);
  });
});

// ── buildCardIndex ───────────────────────────────────────────────────────────

describe('buildCardIndex', () => {
  it('indexes collection by oracle id and lowercased name', () => {
    const col = [enriched('Sol Ring', 'oracle-sol')];
    const idx = buildCardIndex(col, null);

    expect(idx.byOracle.get('oracle-sol')).toBe(col[0]);
    expect(idx.byName.get('sol ring')).toBe(col[0]);
  });

  it('populates byOracle (the superset field)', () => {
    const col = [
      enriched('Mana Crypt', 'oracle-crypt'),
      enriched('Arcane Signet', 'oracle-signet'),
    ];
    const idx = buildCardIndex(col, null);

    expect(idx.byOracle.size).toBe(2);
    expect(idx.byOracle.get('oracle-crypt')?.name).toBe('Mana Crypt');
    expect(idx.byOracle.get('oracle-signet')?.name).toBe('Arcane Signet');
  });

  it('falls back to deck Scryfall card when not in collection', () => {
    const d = deck({
      commander: scryfall('Atraxa', 'oracle-atraxa'),
    });
    const idx = buildCardIndex([], d);

    const entry = idx.byOracle.get('oracle-atraxa');
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('Atraxa');
    // Also indexed by name
    expect(idx.byName.get('atraxa')).toBe(entry);
  });

  it('collection wins over deck Scryfall card on same oracle id', () => {
    const col = [enriched('Brainstorm', 'oracle-bs')];
    const d = deck({
      cards: [
        {
          slotId: 's1',
          card: scryfall('Brainstorm', 'oracle-bs'),
          allocatedCopyId: null,
        },
      ],
    });
    const idx = buildCardIndex(col, d);

    // Collection copy (richest) should win.
    expect(idx.byOracle.get('oracle-bs')).toBe(col[0]);
  });

  it('indexes sideboard cards', () => {
    const d = deck({
      sideboard: [
        {
          slotId: 's1',
          card: scryfall('Negate', 'oracle-negate'),
          allocatedCopyId: null,
        },
      ],
    });
    const idx = buildCardIndex([], d);

    expect(idx.byName.get('negate')).toBeDefined();
    expect(idx.byOracle.get('oracle-negate')).toBeDefined();
  });

  it('skips deck card when already indexed by oracle id (collection priority)', () => {
    const col = [enriched('Ponder', 'oracle-ponder')];
    const deckCard = scryfall('Ponder', 'oracle-ponder');
    const d = deck({
      cards: [{ slotId: 's1', card: deckCard, allocatedCopyId: null }],
    });
    const idx = buildCardIndex(col, d);

    // Should still be exactly one entry — the collection copy.
    expect(idx.byOracle.get('oracle-ponder')).toBe(col[0]);
    expect(idx.byName.get('ponder')).toBe(col[0]);
  });

  it('returns empty maps when called with no collection and null deck', () => {
    const idx = buildCardIndex([], null);
    expect(idx.byOracle.size).toBe(0);
    expect(idx.byName.size).toBe(0);
  });

  it('handles collection cards without oracleId (name-only index)', () => {
    const card = enriched('Ancient Grudge');
    // oracleId is undefined
    const idx = buildCardIndex([card], null);

    expect(idx.byOracle.size).toBe(0);
    expect(idx.byName.get('ancient grudge')).toBe(card);
  });
});
