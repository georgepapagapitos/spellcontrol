import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { useDecksStore, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useCollectionStore } from '@/store/collection';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { applyUpgradePlan } from './apply-upgrade-plan';

// Same contract as append-deck-import.test.ts: the decks store's heal
// subscriber persists through ./sync, mocked so writes can be counted.
const persistDecksState = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/sync', () => ({
  persistDecksState: (...args: unknown[]) => persistDecksState(...args),
}));

const sc = (name: string): ScryfallCard => ({ id: `sf-${name}`, name }) as unknown as ScryfallCard;
const known = new Map(['Harrow', 'Farseek', 'Escape Tunnel'].map((n) => [n, sc(n)]));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: async (names: string[]) =>
    new Map(names.filter((n) => known.has(n)).map((n) => [n, known.get(n)!])),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function deck(cards: string[]): Deck {
  return {
    id: 'd1',
    name: 'Zimone',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: cards.map((n, i) => ({ slotId: `s${i}`, card: sc(n), allocatedCopyId: null })),
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
  };
}

const names = () => useDecksStore.getState().decks[0].cards.map((c) => c.card.name);

describe('applyUpgradePlan', () => {
  beforeEach(async () => {
    setApplyingServer(false);
    useDecksStore.setState({
      decks: [deck(['Simic Signet', 'Ash Barrens', 'Island'])],
      hydrated: true,
    });
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', name: 'Harrow', scryfallId: 'sf-Harrow' } as unknown as EnrichedCard],
    });
    useDeckHistoryStore.getState().clear();
    await flush();
    persistDecksState.mockClear();
  });

  it('swaps, fills, and claims a free owned copy in one write and one undo', async () => {
    const done = await applyUpgradePlan('d1', [
      { addName: 'Harrow', cutName: 'Simic Signet' },
      { addName: 'Escape Tunnel', cutName: 'Ash Barrens' },
      { addName: 'Farseek', cutName: null },
    ]);
    await flush();
    expect(done).toBe(3);
    expect(names()).toEqual(['Island', 'Harrow', 'Escape Tunnel', 'Farseek']);
    const harrow = useDecksStore.getState().decks[0].cards.find((c) => c.card.name === 'Harrow');
    expect(harrow?.allocatedCopyId).toBe('c1');
    expect(persistDecksState).toHaveBeenCalledTimes(1);

    expect(useDeckHistoryStore.getState().undo('d1')).toBe(true);
    expect(names()).toEqual(['Simic Signet', 'Ash Barrens', 'Island']);
  });

  it('keeps the cut when its replacement will not resolve', async () => {
    const done = await applyUpgradePlan('d1', [
      { addName: 'Not A Card', cutName: 'Simic Signet' },
      { addName: 'Harrow', cutName: 'Gone Already' },
    ]);
    expect(done).toBe(0);
    expect(names()).toEqual(['Simic Signet', 'Ash Barrens', 'Island']);
  });

  it('does nothing for a deck that is not there', async () => {
    expect(await applyUpgradePlan('nope', [{ addName: 'Harrow', cutName: null }])).toBe(0);
  });
});
