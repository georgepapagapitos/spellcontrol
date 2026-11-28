import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { useDecksStore, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useCollectionStore } from '@/store/collection';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { pending } from '@/test/pending';
import {
  applyUpgradePlan,
  APPLY_LOOKUP_TIMEOUT_MESSAGE,
  APPLY_LOOKUP_TIMEOUT_MS,
} from './apply-upgrade-plan';

// Same contract as append-deck-import.test.ts: the decks store's heal
// subscriber persists through ./sync, mocked so writes can be counted.
const persistDecksState = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/sync', () => ({
  persistDecksState: (...args: unknown[]) => persistDecksState(...args),
}));

const sc = (name: string): ScryfallCard => ({ id: `sf-${name}`, name }) as unknown as ScryfallCard;
const known = new Map(['Harrow', 'Farseek', 'Escape Tunnel'].map((n) => [n, sc(n)]));
const resolveKnown = async (names: string[]) =>
  new Map(names.filter((n) => known.has(n)).map((n) => [n, known.get(n)!]));
const getCardsByNames = vi.fn(resolveKnown);
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (names: string[]) => getCardsByNames(names),
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
    getCardsByNames.mockImplementation(resolveKnown);
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

  it('writes a caller patch with the cards, under its own label, in the same undo entry', async () => {
    const patch = vi.fn((_deck: Deck, _applied: unknown[]) => ({ name: 'Zimone, patched' }));
    await applyUpgradePlan(
      'd1',
      [
        { addName: 'Harrow', cutName: 'Simic Signet' },
        { addName: 'Not A Card', cutName: 'Ash Barrens' },
      ],
      { label: (n) => `re-check lands (${n})`, patch }
    );
    await flush();
    expect(patch.mock.calls[0][1]).toEqual([{ addName: 'Harrow', cutName: 'Simic Signet' }]);
    expect(useDecksStore.getState().decks[0].name).toBe('Zimone, patched');
    expect(persistDecksState).toHaveBeenCalledTimes(1);
    expect(useDeckHistoryStore.getState().undoLabel('d1')).toBe('re-check lands (1)');
    useDeckHistoryStore.getState().undo('d1');
    expect(useDecksStore.getState().decks[0].name).toBe('Zimone');
  });

  // E1122: the sheets that run this lock every exit until it settles, so a
  // lookup that never answers used to leave them unclosable until a reload.
  it('gives up on a stalled card lookup with copy that says so, and changes nothing', async () => {
    vi.useFakeTimers();
    try {
      getCardsByNames.mockImplementation(() => pending(new Map()));
      let outcome: unknown = 'pending';
      void applyUpgradePlan('d1', [{ addName: 'Harrow', cutName: 'Simic Signet' }]).then(
        (n) => (outcome = n),
        (err: unknown) => (outcome = err)
      );
      await vi.advanceTimersByTimeAsync(APPLY_LOOKUP_TIMEOUT_MS - 1);
      expect(outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toBe(APPLY_LOOKUP_TIMEOUT_MESSAGE);
      expect(names()).toEqual(['Simic Signet', 'Ash Barrens', 'Island']);
    } finally {
      vi.useRealTimers();
    }
  });

  // E1122: a sheet lets the user leave during the lookup. The apply then
  // rejects at once and the deck stays as it was when the lookup answers.
  it('stops at once when its signal aborts, and lands nothing when the lookup answers', async () => {
    let answer: (cards: Map<string, ScryfallCard>) => void = () => {};
    getCardsByNames.mockImplementation(
      () => new Promise<Map<string, ScryfallCard>>((resolve) => (answer = resolve))
    );
    const controller = new AbortController();
    const run = applyUpgradePlan('d1', [{ addName: 'Harrow', cutName: 'Simic Signet' }], {
      signal: controller.signal,
    });
    controller.abort();
    const err = await run.catch((e: Error) => e);
    expect((err as Error).name).toBe('AbortError');
    answer(new Map([['Harrow', sc('Harrow')]]));
    await flush();
    expect(names()).toEqual(['Simic Signet', 'Ash Barrens', 'Island']);
    expect(persistDecksState).not.toHaveBeenCalled();
  });

  it('lands nothing when the signal aborts in the same turn the lookup answers', async () => {
    const controller = new AbortController();
    getCardsByNames.mockImplementation(async (names: string[]) => {
      const found = await resolveKnown(names);
      controller.abort();
      return found;
    });
    const err = await applyUpgradePlan('d1', [{ addName: 'Harrow', cutName: 'Simic Signet' }], {
      signal: controller.signal,
    }).catch((e: Error) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(names()).toEqual(['Simic Signet', 'Ash Barrens', 'Island']);
  });

  it('does nothing for a deck that is not there', async () => {
    expect(await applyUpgradePlan('nope', [{ addName: 'Harrow', cutName: null }])).toBe(0);
  });
});
