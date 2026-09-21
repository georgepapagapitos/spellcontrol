// @vitest-environment happy-dom
//
// The seam between "which names need a body" and "patch the session with what
// came back". The pure halves are guarded in `lib/printed-bodies.test.ts` and
// the patch itself in `store.test.ts`; what is only testable here is WHEN the
// lookup happens — and the one that matters is that a deck already carrying
// bodies makes no request at all, so this costs nothing on a modern deck.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { usePlaytestStore } from '@/playtest/store';
import { usePrintedBodies } from './use-printed-bodies';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(),
}));

vi.mock('@/lib/sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
}));

function card(name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  return { id: name, name, type_line: 'Creature — Goblin', ...extra } as ScryfallCard;
}

function deck(cards: ScryfallCard[]): Deck {
  return {
    id: 'deck-1',
    name: 'Deck',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    cards: cards.map((c): DeckCard => ({ slotId: `s-${c.name}`, card: c, allocatedCopyId: null })),
    sideboard: [],
  } as unknown as Deck;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlaytestStore.getState().teardown();
});

describe('usePrintedBodies', () => {
  it('puts the resolved body on the session’s cards', async () => {
    vi.mocked(getCardsByNames).mockResolvedValue(
      new Map([['Goblin Trashmaster', card('Goblin Trashmaster', { power: '3', toughness: '3' })]])
    );
    usePlaytestStore
      .getState()
      .init('deck-1', { library: [{ id: 'c-1', name: 'Goblin Trashmaster' }], seed: 1 });

    renderHook(() => usePrintedBodies(deck([card('Goblin Trashmaster')])));

    await waitFor(() => {
      const s = usePlaytestStore.getState().state;
      const all = [...(s?.zones.library ?? []), ...(s?.zones.hand ?? [])];
      expect(all.find((c) => c.id === 'c-1')).toMatchObject({ power: '3', toughness: '3' });
    });
  });

  it('asks for nothing when every card already prints its body', () => {
    renderHook(() => usePrintedBodies(deck([card('Moggcatcher', { power: '2', toughness: '2' })])));
    expect(getCardsByNames).not.toHaveBeenCalled();
  });

  it('leaves the board alone when the lookup fails', async () => {
    vi.mocked(getCardsByNames).mockRejectedValue(new Error('offline'));
    usePlaytestStore
      .getState()
      .init('deck-1', { library: [{ id: 'c-1', name: 'Goblin Trashmaster' }], seed: 1 });
    const before = usePlaytestStore.getState().state;

    renderHook(() => usePrintedBodies(deck([card('Goblin Trashmaster')])));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(usePlaytestStore.getState().state).toBe(before);
  });
});
