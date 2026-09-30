/**
 * Guard for E276: `remapAllocations` runs on every boot for every deck slot.
 * Its fresh-pick pass (unowned cards land here every time) must draw from the
 * per-name free index it already built — offering `pickCollectionCopy` the
 * whole collection made hydrate scan ~11.5k cards per unowned slot (~1 s of
 * the boot long task at a phone's CPU).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickCollectionCopy } from '@/lib/collection/allocations-core';
import { setApplyingServer } from '@/lib/sync/applying-server';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore, type Deck, type DeckCard } from './decks';

vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/collection/allocations-core', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/collection/allocations-core')>();
  return { ...m, pickCollectionCopy: vi.fn(m.pickCollectionCopy) };
});

const enriched = (copyId: string, name: string, scryfallId = `sf-${name}`): EnrichedCard =>
  ({
    copyId,
    name,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  }) as EnrichedCard;

const slot = (name: string, scryfallId = `sf-${name}`): DeckCard => ({
  slotId: `slot-${name}`,
  card: { name, id: scryfallId } as ScryfallCard,
  allocatedCopyId: null,
});

const deck: Deck = {
  id: 'd1',
  name: 'Test Deck',
  source: 'manual',
  format: 'commander',
  commander: null,
  partnerCommander: null,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  cards: [slot('Sol Ring', 'sf-other-printing'), slot('Unowned Card')],
  sideboard: [],
  considering: [],
  generationContext: null,
  color: '#7a8a70',
  createdAt: 0,
  updatedAt: 0,
};

describe('remapAllocations fresh pick (E276)', () => {
  beforeEach(() => {
    setApplyingServer(false);
    vi.mocked(pickCollectionCopy).mockClear();
    useDecksStore.setState({ decks: [deck], hydrated: true });
  });

  it('offers the picker only free copies of that name, never the whole collection', () => {
    const collection = [
      enriched('c1', 'Sol Ring'),
      enriched('c2', 'Sol Ring'),
      enriched('c3', 'Llanowar Elves'),
      enriched('c4', 'Forest'),
    ];
    useDecksStore.getState().remapAllocations(collection, []);

    const calls = vi.mocked(pickCollectionCopy).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [name, offered] of calls) {
      expect(offered.every((c) => c.name === name)).toBe(true);
      expect(offered.length).toBeLessThan(collection.length);
    }
    // Same answer the full scan gave: a free copy by name, nothing for an
    // unowned card.
    const [solRing, unowned] = useDecksStore.getState().decks[0].cards;
    expect(['c1', 'c2']).toContain(solRing.allocatedCopyId);
    expect(unowned.allocatedCopyId).toBeNull();
  });
});
