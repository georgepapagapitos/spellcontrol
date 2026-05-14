import { describe, it, expect } from 'vitest';
import {
  buildAllocationMap,
  pickCollectionCopy,
  classifyAllocation,
  findSuboptimalPrintings,
  type AllocationInfo,
} from './allocations';
import type { EnrichedCard } from '../types';
import type { Deck, DeckCard } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    format: 'commander',
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildAllocationMap', () => {
  it('maps commander, partner, and slot allocations', () => {
    const d = deck({
      id: 'd1',
      name: 'Atraxa',
      commander: { name: "Atraxa, Praetors' Voice" } as never,
      commanderAllocatedCopyId: 'copy-cmd',
      partnerCommander: { name: 'Partner' } as never,
      partnerCommanderAllocatedCopyId: 'copy-partner',
      cards: [
        { slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'copy-sr' },
        { slotId: 's2', card: { name: 'Mana Crypt' } as never, allocatedCopyId: null },
      ],
    });
    const map = buildAllocationMap([d]);
    expect(map.size).toBe(3);
    expect(map.get('copy-cmd')?.cardName).toBe("Atraxa, Praetors' Voice");
    expect(map.get('copy-partner')?.deckName).toBe('Atraxa');
    expect(map.get('copy-sr')?.cardName).toBe('Sol Ring');
  });

  it('skips commander entries with no allocation', () => {
    const d = deck({
      commander: { name: 'X' } as never,
      commanderAllocatedCopyId: null,
    });
    expect(buildAllocationMap([d]).size).toBe(0);
  });
});

describe('pickCollectionCopy', () => {
  const allocated = new Map<string, AllocationInfo>();

  it('returns null when no candidates match', () => {
    expect(pickCollectionCopy('Sol Ring', [], allocated)).toBeNull();
    expect(pickCollectionCopy('Sol Ring', [card({ name: 'Other' })], allocated)).toBeNull();
  });

  it('prefers non-foil over foil', () => {
    const foil = card({ copyId: 'a', foil: true, finish: 'foil', purchasePrice: 1 });
    const nonFoil = card({ copyId: 'b', foil: false, finish: 'nonfoil', purchasePrice: 5 });
    expect(pickCollectionCopy('Sol Ring', [foil, nonFoil], allocated)?.copyId).toBe('b');
  });

  it('prefers cheaper copy when foil status matches', () => {
    const cheap = card({ copyId: 'a', purchasePrice: 1 });
    const pricey = card({ copyId: 'b', purchasePrice: 50 });
    expect(pickCollectionCopy('Sol Ring', [pricey, cheap], allocated)?.copyId).toBe('a');
  });

  it('skips copies that are already allocated', () => {
    const claimed = new Map<string, AllocationInfo>();
    claimed.set('a', { deckId: 'd1', deckName: 'X', cardName: 'Sol Ring' });
    const a = card({ copyId: 'a', purchasePrice: 1 });
    const b = card({ copyId: 'b', purchasePrice: 5 });
    expect(pickCollectionCopy('Sol Ring', [a, b], claimed)?.copyId).toBe('b');
  });
});

describe('pickCollectionCopy with preferredScryfallId', () => {
  const allocated = new Map<string, AllocationInfo>();

  it('prefers exact printing even when a cheaper alternative exists', () => {
    const cheap = card({ copyId: 'a', scryfallId: 'sf-CMR', purchasePrice: 1 });
    const pricey = card({ copyId: 'b', scryfallId: 'sf-ONE', purchasePrice: 50 });
    expect(pickCollectionCopy('Sol Ring', [cheap, pricey], allocated, 'sf-ONE')?.copyId).toBe('b');
  });

  it('falls back to foil/price tiebreak when preferred printing is not owned', () => {
    const nonFoil = card({ copyId: 'a', scryfallId: 'sf-CMR', foil: false, purchasePrice: 1 });
    const foilCopy = card({
      copyId: 'b',
      scryfallId: 'sf-NEO',
      foil: true,
      finish: 'foil',
      purchasePrice: 0.5,
    });
    // preferred printing 'sf-XYZ' is not owned; fallback: non-foil wins
    expect(pickCollectionCopy('Sol Ring', [nonFoil, foilCopy], allocated, 'sf-XYZ')?.copyId).toBe(
      'a'
    );
  });

  it('returns null when all candidates are allocated even with a preference', () => {
    const claimed = new Map<string, AllocationInfo>();
    claimed.set('a', { deckId: 'd1', deckName: 'X', cardName: 'Sol Ring' });
    const a = card({ copyId: 'a', scryfallId: 'sf-ONE' });
    expect(pickCollectionCopy('Sol Ring', [a], claimed, 'sf-ONE')).toBeNull();
  });

  it('prefers exact-printing foil over non-preferred non-foil', () => {
    const nonFoilCheap = card({ copyId: 'a', scryfallId: 'sf-CMR', foil: false, purchasePrice: 1 });
    const foilPref = card({
      copyId: 'b',
      scryfallId: 'sf-ONE',
      foil: true,
      finish: 'foil',
      purchasePrice: 2,
    });
    expect(
      pickCollectionCopy('Sol Ring', [nonFoilCheap, foilPref], allocated, 'sf-ONE')?.copyId
    ).toBe('b');
  });

  it('passes through to original behavior when preferredScryfallId is undefined', () => {
    const foil = card({
      copyId: 'a',
      scryfallId: 'sf-ONE',
      foil: true,
      finish: 'foil',
      purchasePrice: 1,
    });
    const nonFoil = card({ copyId: 'b', scryfallId: 'sf-NEO', foil: false, purchasePrice: 5 });
    expect(pickCollectionCopy('Sol Ring', [foil, nonFoil], allocated)?.copyId).toBe('b');
  });
});

describe('findSuboptimalPrintings', () => {
  function slot(name: string, scryfallId: string, allocatedCopyId: string | null): DeckCard {
    return {
      slotId: `s-${Math.random()}`,
      card: { name, id: scryfallId } as ScryfallCard,
      allocatedCopyId,
    };
  }

  it('reports a slot bound to a wrong-printing copy when preferred printing is owned', () => {
    const d = deck({
      id: 'd1',
      name: 'A',
      cards: [slot('Plains', 'sf-pref', 'wrong-copy')],
    });
    const collection: EnrichedCard[] = [
      card({ copyId: 'wrong-copy', name: 'Plains', scryfallId: 'sf-other', setCode: 'M20' }),
      card({ copyId: 'right-copy', name: 'Plains', scryfallId: 'sf-pref', setCode: 'ECL' }),
    ];
    const out = findSuboptimalPrintings([d], collection);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      deckName: 'A',
      cardName: 'Plains',
      preferredScryfallId: 'sf-pref',
      allocatedCopyId: 'wrong-copy',
      allocatedSet: 'M20',
    });
  });

  it('does not report when the slot is already on the preferred printing', () => {
    const d = deck({
      id: 'd1',
      cards: [slot('Plains', 'sf-pref', 'right-copy')],
    });
    const collection = [card({ copyId: 'right-copy', name: 'Plains', scryfallId: 'sf-pref' })];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('does not report when the preferred printing is not owned at all', () => {
    // No upgrade possible; the slot is doing the best it can.
    const d = deck({
      id: 'd1',
      cards: [slot('Plains', 'sf-pref', 'only-copy')],
    });
    const collection = [card({ copyId: 'only-copy', name: 'Plains', scryfallId: 'sf-other' })];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('does not report unallocated slots', () => {
    const d = deck({
      id: 'd1',
      cards: [slot('Plains', 'sf-pref', null)],
    });
    const collection = [card({ copyId: 'c', name: 'Plains', scryfallId: 'sf-pref' })];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('checks commander, partner, and sideboard alongside the main deck', () => {
    const d = deck({
      id: 'd1',
      name: 'X',
      commander: { name: 'Atraxa', id: 'sf-atraxa-pref' } as ScryfallCard,
      commanderAllocatedCopyId: 'cmdr-wrong',
      partnerCommander: { name: 'Thrasios', id: 'sf-thra-pref' } as ScryfallCard,
      partnerCommanderAllocatedCopyId: 'part-wrong',
      sideboard: [slot('Bolt', 'sf-bolt-pref', 'side-wrong')],
    });
    const collection = [
      card({ copyId: 'cmdr-wrong', name: 'Atraxa', scryfallId: 'sf-atraxa-other' }),
      card({ copyId: 'cmdr-right', name: 'Atraxa', scryfallId: 'sf-atraxa-pref' }),
      card({ copyId: 'part-wrong', name: 'Thrasios', scryfallId: 'sf-thra-other' }),
      card({ copyId: 'part-right', name: 'Thrasios', scryfallId: 'sf-thra-pref' }),
      card({ copyId: 'side-wrong', name: 'Bolt', scryfallId: 'sf-bolt-other' }),
      card({ copyId: 'side-right', name: 'Bolt', scryfallId: 'sf-bolt-pref' }),
    ];
    const out = findSuboptimalPrintings([d], collection);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.cardName).sort()).toEqual(['Atraxa', 'Bolt', 'Thrasios']);
  });
});

describe('classifyAllocation', () => {
  it('returns unowned when no copy is allocated', () => {
    expect(classifyAllocation(null, new Map())).toBe('unowned');
  });

  it('returns allocated while collection is hydrating', () => {
    expect(classifyAllocation('copy-1', undefined)).toBe('allocated');
  });

  it('returns allocated when the copy still exists', () => {
    const m = new Map<string, EnrichedCard>([['copy-1', card()]]);
    expect(classifyAllocation('copy-1', m)).toBe('allocated');
  });

  it('returns orphan when the copy is gone', () => {
    expect(classifyAllocation('missing', new Map())).toBe('orphan');
  });
});
