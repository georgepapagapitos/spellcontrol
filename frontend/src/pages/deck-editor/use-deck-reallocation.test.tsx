// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { useDecksStore, type Deck, type DeckCard } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useToastsStore } from '@/store/toasts';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { useDeckReallocation } from './use-deck-reallocation';

// The stores' sync subscribers dynamically import this; nothing here asserts a push.
vi.mock('@/lib/sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
  persistCubesState: vi.fn().mockResolvedValue(undefined),
}));

// "Release copy" and "Use my copy" are offered on sideboard rows too, but both
// handlers used to search the mainboard only, so on a sideboard card they did
// nothing at all.

const card = { name: 'Sol Ring', id: 'sf-ring' } as ScryfallCard;
const ring = { copyId: 'c1', name: card.name, scryfallId: 'sf-ring' } as EnrichedCard;
const slot = (slotId: string, allocatedCopyId: string | null): DeckCard => ({
  slotId,
  card,
  allocatedCopyId,
});

const makeDeck = (over: Partial<Deck>): Deck => ({
  id: 'd1',
  name: 'Test',
  source: 'manual',
  format: 'commander',
  commander: null,
  partnerCommander: null,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  cards: [],
  sideboard: [],
  considering: [],
  generationContext: null,
  color: '#7a8a70',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const current = () => useDecksStore.getState().decks[0];
const hook = () =>
  renderHook(() => useDeckReallocation({ deck: current(), collectionCards: [ring] })).result;

beforeEach(() => {
  setApplyingServer(false);
  useCubeStore.setState({ saved: [] });
  useToastsStore.setState({ toasts: [] });
});

describe('release and take back a sideboard copy', () => {
  it('Release copy frees the sideboard slot and marks it released', () => {
    useDecksStore.setState({ decks: [makeDeck({ sideboard: [slot('sb', 'c1')] })] });
    const result = hook();
    act(() => result.current.setReleaseCard(card));
    act(() => result.current.handleReleaseConfirm());
    expect(current().sideboard[0]).toMatchObject({ allocatedCopyId: null, released: true });
  });

  it('Use my copy binds the free copy back and clears the marker', () => {
    useDecksStore.setState({
      decks: [makeDeck({ sideboard: [{ ...slot('sb', null), released: true }] })],
    });
    const result = hook();
    act(() => result.current.handleUseOwnCopy(card));
    expect(current().sideboard[0].allocatedCopyId).toBe('c1');
    expect(current().sideboard[0].released).toBeUndefined();
  });

  it('Use my copy on a released commander seat binds the seat', () => {
    useDecksStore.setState({ decks: [makeDeck({ commander: card, commanderReleased: true })] });
    const result = hook();
    act(() => result.current.handleUseOwnCopy(card));
    expect(current().commanderAllocatedCopyId).toBe('c1');
    expect(current().commanderReleased).toBeUndefined();
  });

  it('says so when there is no free copy to use', () => {
    useDecksStore.setState({
      decks: [
        makeDeck({
          cards: [slot('m', 'c1')],
          sideboard: [{ ...slot('sb', null), released: true }],
        }),
      ],
    });
    const result = hook();
    act(() => result.current.handleUseOwnCopy(card));
    expect(current().sideboard[0].allocatedCopyId).toBeNull();
    expect(useToastsStore.getState().toasts.at(-1)?.message).toBe(
      'No free copy of Sol Ring to use.'
    );
  });
});
