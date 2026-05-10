import { describe, it, expect } from 'vitest';
import {
  buildAllocationMap,
  pickCollectionCopy,
  classifyAllocation,
  type AllocationInfo,
} from './allocations';
import type { EnrichedCard } from '../types';
import type { Deck } from '../store/decks';

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
    generationContext: null,
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
    const foil = card({ copyId: 'a', foil: true, purchasePrice: 1 });
    const nonFoil = card({ copyId: 'b', foil: false, purchasePrice: 5 });
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
