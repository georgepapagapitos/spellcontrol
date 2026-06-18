import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { EnrichedCard } from '../types';
import {
  buildAvailableCollection,
  buildBasicPrintingAvailability,
  planBasicPrintings,
  type BasicPrintingAvail,
} from './collection-availability';

function owned(name: string, copyId: string): EnrichedCard {
  return {
    copyId,
    name,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf-${copyId}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
  };
}

/** A basic-land copy of a specific printing. */
function basic(name: string, copyId: string, printing: Partial<EnrichedCard>): EnrichedCard {
  return { ...owned(name, copyId), ...printing };
}

function deckWithClaim(cardName: string, copyId: string): Deck {
  const card = { id: `sf-${copyId}`, name: cardName } as ScryfallCard;
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [{ slotId: 'slot-1', card, allocatedCopyId: copyId }],
    sideboard: [],
    generationContext: null,
    color: '#111111',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('buildAvailableCollection', () => {
  it('keeps only names with free copies and counts those free copies', () => {
    const available = buildAvailableCollection(
      [
        owned('Free Card', 'free-copy'),
        owned('Fully Claimed Card', 'claimed-copy'),
        owned('Partly Claimed Card', 'partly-claimed-copy'),
        owned('Partly Claimed Card', 'partly-free-copy'),
      ],
      [
        deckWithClaim('Fully Claimed Card', 'claimed-copy'),
        deckWithClaim('Partly Claimed Card', 'partly-claimed-copy'),
      ]
    );

    expect([...available.names].sort()).toEqual(['Free Card', 'Partly Claimed Card']);
    expect(available.counts.get('Free Card')).toBe(1);
    expect(available.counts.get('Partly Claimed Card')).toBe(1);
    expect(available.counts.has('Fully Claimed Card')).toBe(false);
  });
});

describe('buildBasicPrintingAvailability', () => {
  it('groups free basic copies by printing, sorted by owned count desc, skipping non-basics and claimed copies', () => {
    const map = buildBasicPrintingAvailability(
      [
        ...['a', 'b', 'c'].map((i) =>
          basic('Forest', `fa-${i}`, { scryfallId: 'sf-A', setCode: 'A', collectorNumber: '1' })
        ),
        ...['a', 'b', 'c', 'd', 'e'].map((i) =>
          basic('Forest', `fb-${i}`, { scryfallId: 'sf-B', setCode: 'B', collectorNumber: '2' })
        ),
        basic('Forest', 'fb-claimed', { scryfallId: 'sf-B', setCode: 'B', collectorNumber: '2' }),
        owned('Llanowar Elves', 'le-1'), // non-basic, ignored
      ],
      [deckWithClaim('Forest', 'fb-claimed')]
    );

    const forest = map.get('Forest')!;
    // Printing B (5 free) before printing A (3 free); claimed B copy excluded.
    expect(forest.map((p) => [p.scryfallId, p.count])).toEqual([
      ['sf-B', 5],
      ['sf-A', 3],
    ]);
    expect(map.has('Llanowar Elves')).toBe(false);
  });
});

describe('planBasicPrintings', () => {
  const A: BasicPrintingAvail = {
    scryfallId: 'A',
    set: 'A',
    collectorNumber: '1',
    setName: 'A',
    count: 12,
  };
  const B: BasicPrintingAvail = {
    scryfallId: 'B',
    set: 'B',
    collectorNumber: '2',
    setName: 'B',
    count: 8,
  };

  it('splits the count across owned printings largest-group-first', () => {
    const plan = planBasicPrintings(20, [A, B]);
    expect(plan.filter((p) => p?.scryfallId === 'A')).toHaveLength(12);
    expect(plan.filter((p) => p?.scryfallId === 'B')).toHaveLength(8);
    expect(plan).toHaveLength(20);
  });

  it('caps each printing at its owned count and fills the remainder with null (must-acquire)', () => {
    const plan = planBasicPrintings(20, [{ ...A, count: 5 }]);
    expect(plan.filter((p) => p?.scryfallId === 'A')).toHaveLength(5);
    expect(plan.filter((p) => p === null)).toHaveLength(15);
  });

  it('returns all-null when no printings are owned', () => {
    expect(planBasicPrintings(3, [])).toEqual([null, null, null]);
  });

  it('does not over-allocate when owned exceeds the count', () => {
    const plan = planBasicPrintings(4, [A, B]);
    expect(plan).toHaveLength(4);
    expect(plan.every((p) => p?.scryfallId === 'A')).toBe(true);
  });
});
