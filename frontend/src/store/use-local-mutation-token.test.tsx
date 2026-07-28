// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDecksStore, useLocalMutationToken } from './decks';

describe('useLocalMutationToken (E177)', () => {
  it('re-renders with the bumped token when the deck is mutated locally', () => {
    useDecksStore.setState({ decks: [] });
    const { result } = renderHook(() => useLocalMutationToken('d-hook'));
    const before = result.current;

    act(() => {
      useDecksStore.getState().createDeck({ source: 'manual', commander: null });
      const [deck] = useDecksStore.getState().decks;
      // Reassign to the id under test so the hook's subscription fires.
      useDecksStore.setState({ decks: [{ ...deck, id: 'd-hook' }] });
      useDecksStore.getState().renameDeck('d-hook', 'Renamed');
    });

    expect(result.current).toBe(before + 1);
  });
});
