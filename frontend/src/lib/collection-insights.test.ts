import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { SavedCube } from '../store/cube';
import type { BinderDef, EnrichedCard } from '../types';
import { buildAllocationMap } from './allocations-core';
import {
  computeAllocationSplit,
  computeSparesSummary,
  computeSharedCopies,
  computeCloseToDone,
  computeConcentration,
  computeGroupedBreakdown,
} from './collection-insights';

// ── Fixtures (mirrors ownership-lens.test.ts / home-signals.test.ts) ───────

let copyCounter = 0;
function owned(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: over.copyId ?? `copy-${copyCounter++}`,
    name: over.name ?? 'Sol Ring',
    setCode: over.setCode ?? 'lea',
    setName: over.setName ?? 'Limited Edition Alpha',
    collectorNumber: over.collectorNumber ?? '1',
    rarity: over.rarity ?? 'uncommon',
    scryfallId: over.scryfallId ?? `sf-${copyCounter}`,
    purchasePrice: over.purchasePrice ?? 0,
    sourceCategory: over.sourceCategory ?? '',
    sourceFormat: over.sourceFormat ?? 'manual',
    finish: over.finish ?? 'nonfoil',
    foil: over.foil ?? false,
    typeLine: over.typeLine ?? 'Artifact',
    colorIdentity: over.colorIdentity ?? [],
    ...over,
  };
}

function scryfallCard(overrides: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: overrides.name,
    oracle_id: overrides.name,
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

let deckIdCounter = 0;
function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: `deck-${deckIdCounter++}`,
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

function deckCard(card: ScryfallCard) {
  return { slotId: card.name, card, allocatedCopyId: null };
}

let cubeIdCounter = 0;
function makeCube(overrides: Partial<SavedCube> = {}): SavedCube {
  return {
    id: `cube-${cubeIdCounter++}`,
    name: 'Cube',
    isPhysical: true,
    picks: [],
    savedAt: 0,
    ...overrides,
  } as SavedCube;
}

function binder(over: Partial<BinderDef> = {}): BinderDef {
  return {
    id: over.id ?? 'binder-1',
    name: over.name ?? 'Binder',
    position: over.position ?? 0,
    filterGroups: over.filterGroups ?? [],
    sorts: over.sorts ?? [],
    pocketSize: over.pocketSize ?? null,
    doubleSided: over.doubleSided ?? false,
    fixedCapacity: over.fixedCapacity ?? null,
    color: over.color ?? '#ff0000',
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
    ...over,
  };
}

describe('computeAllocationSplit', () => {
  it('splits bound vs idle, excluding basics from both', () => {
    const decks = [makeDeck({ cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] })];
    const allocations = buildAllocationMap(decks);
    const cards = [
      owned({ name: 'Sol Ring', copyId: 'c1', purchasePrice: 2 }),
      owned({ name: 'Lightning Bolt', copyId: 'c2', purchasePrice: 1 }),
      owned({ name: 'Plains', copyId: 'c3', purchasePrice: 0.25 }),
    ];
    // Sol Ring's copy isn't the allocated one (allocation binds by name via a
    // separate flow in the real app; here we simulate directly).
    const alloc = new Map(allocations);
    alloc.set('c1', [...allocations.values()][0]);
    const split = computeAllocationSplit(cards, alloc);
    expect(split).toEqual({ boundCount: 1, boundValue: 2, idleCount: 1, idleValue: 1 });
  });

  it('returns null for an empty (post-basics-exclusion) collection', () => {
    const cards = [owned({ name: 'Plains' })];
    expect(computeAllocationSplit(cards, new Map())).toBeNull();
  });
});

describe('computeSparesSummary', () => {
  it('keeps the most valuable unclaimed copy per name, counts the rest as spare', () => {
    const cards = [
      owned({ name: 'Sol Ring', copyId: 'c1', purchasePrice: 5 }),
      owned({ name: 'Sol Ring', copyId: 'c2', purchasePrice: 2 }),
      owned({ name: 'Sol Ring', copyId: 'c3', purchasePrice: 1 }),
    ];
    const summary = computeSparesSummary(cards, new Map());
    // Keeps the $5 copy; the $2 + $1 copies are spare.
    expect(summary).toEqual({ count: 2, value: 3 });
  });

  it('excludes basics and allocated copies', () => {
    const decks = [makeDeck({ cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] })];
    const cards = [
      owned({ name: 'Sol Ring', copyId: 'c1' }),
      owned({ name: 'Sol Ring', copyId: 'c2' }),
      owned({ name: 'Plains', copyId: 'c3' }),
      owned({ name: 'Plains', copyId: 'c4' }),
    ];
    const allocations = new Map([['c1', [...buildAllocationMap(decks).values()][0]]]);
    // c1 is claimed, leaving c2 as the single unclaimed Sol Ring (no surplus)
    // and two unclaimed Plains (excluded by isBasicLandName regardless).
    expect(computeSparesSummary(cards, allocations)).toBeNull();
  });

  it('returns null when nothing is spare', () => {
    expect(computeSparesSummary([owned({ name: 'Sol Ring' })], new Map())).toBeNull();
  });
});

describe('computeSharedCopies', () => {
  it('lists a card only when demand exceeds ownership and owned >= 1', () => {
    const decks = [
      makeDeck({ name: 'Deck A', cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] }),
      makeDeck({ name: 'Deck B', cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] }),
      makeDeck({ name: 'Deck C', cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] }),
    ];
    const cards = [owned({ name: 'Sol Ring', copyId: 'c1' })];
    const rows = computeSharedCopies(cards, decks, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cardName: 'Sol Ring', owned: 1, demand: 3, shortfall: 2 });
    expect(rows[0].wantedBy.map((w) => w.name).sort()).toEqual(['Deck A', 'Deck B', 'Deck C']);
  });

  it('omits a card the user owns zero of', () => {
    const decks = [makeDeck({ cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] })];
    expect(computeSharedCopies([], decks, [])).toEqual([]);
  });

  it('omits a card whose demand does not exceed ownership', () => {
    const decks = [makeDeck({ cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] })];
    const cards = [
      owned({ name: 'Sol Ring', copyId: 'c1' }),
      owned({ name: 'Sol Ring', copyId: 'c2' }),
    ];
    expect(computeSharedCopies(cards, decks, [])).toEqual([]);
  });

  it('counts a physical cube as a wanter, ignores a non-physical (draft) cube', () => {
    const cube = makeCube({
      name: 'Vintage Cube',
      isPhysical: true,
      picks: [
        {
          slotId: '0',
          card: {
            name: 'Sol Ring',
            oracleId: 'sol',
            colors: [],
            cmc: 1,
            typeLine: 'Artifact',
            role: null,
          },
          allocatedCopyId: null,
          printingFinishKey: null,
        },
      ],
    });
    const draftCube = makeCube({ name: 'Draft Cube', isPhysical: false });
    const decks = [makeDeck({ cards: [deckCard(scryfallCard({ name: 'Sol Ring' }))] })];
    const cards = [owned({ name: 'Sol Ring', copyId: 'c1' })];
    const rows = computeSharedCopies(cards, decks, [cube, draftCube]);
    expect(rows[0].demand).toBe(2);
    expect(rows[0].wantedBy.some((w) => w.kind === 'cube' && w.name === 'Vintage Cube')).toBe(true);
    expect(rows[0].wantedBy.some((w) => w.name === 'Draft Cube')).toBe(false);
  });
});

describe('computeCloseToDone', () => {
  it('lists a deck missing 1-5 unowned cards, with cost', () => {
    const deck = makeDeck({
      name: 'Krenko, Mob Boss',
      cards: [
        deckCard(scryfallCard({ name: 'Owned Card' })),
        deckCard(scryfallCard({ name: 'Missing Card', prices: { usd: '4.00' } })),
      ],
    });
    const rows = computeCloseToDone([deck], new Set(['Owned Card']), 'USD');
    expect(rows).toEqual([
      {
        deckId: deck.id,
        deckName: 'Krenko, Mob Boss',
        deckColor: '#888888',
        missingNames: ['Missing Card'],
        costToFinish: 4,
      },
    ]);
  });

  it('excludes a deck missing more than 5 cards', () => {
    const deck = makeDeck({
      cards: Array.from({ length: 6 }, (_, i) => deckCard(scryfallCard({ name: `Missing ${i}` }))),
    });
    expect(computeCloseToDone([deck], new Set(), 'USD')).toEqual([]);
  });

  it('excludes a deck missing nothing', () => {
    const deck = makeDeck({ cards: [deckCard(scryfallCard({ name: 'Owned Card' }))] });
    expect(computeCloseToDone([deck], new Set(['Owned Card']), 'USD')).toEqual([]);
  });

  it('never counts a basic land as missing', () => {
    const deck = makeDeck({ cards: [deckCard(scryfallCard({ name: 'Forest' }))] });
    expect(computeCloseToDone([deck], new Set(), 'USD')).toEqual([]);
  });

  it('counts a missing commander', () => {
    const deck = makeDeck({ commander: scryfallCard({ name: 'Krenko, Mob Boss' }) });
    const rows = computeCloseToDone([deck], new Set(), 'USD');
    expect(rows[0].missingNames).toEqual(['Krenko, Mob Boss']);
  });

  it('sorts by missing count ascending', () => {
    const closer = makeDeck({
      name: 'Closer',
      cards: [deckCard(scryfallCard({ name: 'A' }))],
    });
    const further = makeDeck({
      name: 'Further',
      cards: [deckCard(scryfallCard({ name: 'B' })), deckCard(scryfallCard({ name: 'C' }))],
    });
    const rows = computeCloseToDone([further, closer], new Set(), 'USD');
    expect(rows.map((r) => r.deckName)).toEqual(['Closer', 'Further']);
  });
});

describe('computeConcentration', () => {
  it('returns null below the priced-copy floor', () => {
    const cards = Array.from({ length: 29 }, () => owned({ purchasePrice: 10 }));
    expect(computeConcentration(cards)).toBeNull();
  });

  it('reports the top-10 share once the floor is met', () => {
    const expensive = Array.from({ length: 10 }, () => owned({ purchasePrice: 100 }));
    const cheap = Array.from({ length: 20 }, () => owned({ purchasePrice: 1 }));
    const result = computeConcentration([...expensive, ...cheap]);
    // 1000 / (1000 + 20) ≈ 98%
    expect(result?.topCount).toBe(10);
    expect(result?.topSharePct).toBe(98);
  });
});

describe('computeGroupedBreakdown', () => {
  it('groups by color with a filterJump per non-multicolor bucket', () => {
    const cards = [
      owned({ name: 'Plains', colorIdentity: ['W'], purchasePrice: 1 }),
      owned({ name: 'Void', colorIdentity: [], purchasePrice: 2 }),
    ];
    const rows = computeGroupedBreakdown(cards, 'color');
    const white = rows.find((r) => r.key === 'W');
    expect(white?.filterJump).toEqual({ kind: 'color', key: 'W' });
    expect(white?.count).toBe(1);
  });

  it('multicolor bucket carries no filterJump', () => {
    const cards = [owned({ name: 'Atraxa', colorIdentity: ['W', 'U', 'B', 'G'] })];
    const rows = computeGroupedBreakdown(cards, 'color');
    expect(rows.find((r) => r.key === 'M')?.filterJump).toBeUndefined();
  });

  it('groups by type with per-color splits and no jump for "other"', () => {
    const cards = [
      owned({ name: 'Bear', typeLine: 'Creature — Bear', colorIdentity: ['G'] }),
      owned({ name: 'Mystery', typeLine: '' }),
    ];
    const rows = computeGroupedBreakdown(cards, 'type');
    const creature = rows.find((r) => r.key === 'creature');
    expect(creature?.colorSplits).toEqual({ G: 1 });
    expect(creature?.filterJump).toEqual({ kind: 'type', key: 'creature' });
    expect(rows.find((r) => r.key === 'other')?.filterJump).toBeUndefined();
  });

  it('groups by rarity', () => {
    const cards = [owned({ rarity: 'mythic' }), owned({ rarity: 'MYTHIC' })];
    const rows = computeGroupedBreakdown(cards, 'rarity');
    expect(rows).toEqual([
      {
        key: 'mythic',
        label: 'Mythic',
        color: 'var(--rarity-mythic-to)',
        count: 2,
        value: 0,
        filterJump: { kind: 'rarity', key: 'mythic' },
      },
    ]);
  });

  it('groups by set', () => {
    const cards = [
      owned({ setCode: 'lea', setName: 'Alpha' }),
      owned({ setCode: 'lea', setName: 'Alpha' }),
    ];
    const rows = computeGroupedBreakdown(cards, 'set');
    expect(rows).toEqual([
      { key: 'lea', label: 'Alpha', count: 2, value: 0, filterJump: { kind: 'set', code: 'lea' } },
    ]);
  });

  it('groups by binder, routing unmatched copies to "Not in a binder"', () => {
    const b = binder({ id: 'b1', name: 'Commanders', filterGroups: [] });
    const cards = [owned({ name: 'Sol Ring' })];
    const rows = computeGroupedBreakdown(cards, 'binder', { binderDefs: [b] });
    expect(rows).toEqual([
      {
        key: 'Not in a binder',
        label: 'Not in a binder',
        count: 1,
        value: 0,
        filterJump: { kind: 'binder', name: '__uncategorized' },
      },
    ]);
  });

  // The binders index and each binder's page state "N pages" from the same
  // materialized totalPages; the Breakdown row must agree with them.
  it("carries a binder's physical page count, and none for the unfiled row", () => {
    const b = binder({
      id: 'b1',
      name: 'Staples',
      filterGroups: [{ filter: {} }],
      sorts: [{ field: 'none', dir: 'asc' }],
      pocketSize: 12,
    });
    const cards = Array.from({ length: 25 }, (_, i) =>
      owned({ name: `Card ${i}`, copyId: `c${i}` })
    );
    const rows = computeGroupedBreakdown(cards, 'binder', { binderDefs: [b] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Staples', count: 25, pages: 3 }); // ceil(25 / 12)
  });

  it('groups by deck use, reusing computeAllocationSplit with no filterJump', () => {
    const cards = [owned({ name: 'Sol Ring', purchasePrice: 2 })];
    const rows = computeGroupedBreakdown(cards, 'deckUse', { allocations: new Map() });
    expect(rows).toEqual([
      { key: 'in-deck', label: 'In decks', count: 0, value: 0 },
      { key: 'idle', label: 'Idle', count: 1, value: 2 },
    ]);
  });
});
