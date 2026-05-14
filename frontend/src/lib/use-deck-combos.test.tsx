// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeckCombos, __testing } from './use-deck-combos';

vi.mock('./api/combos', () => ({
  matchCombos: vi.fn(),
}));

import { matchCombos } from './api/combos';

const empty = { inDeck: [], oneAway: [], almostInCollection: [] };

beforeEach(() => {
  __testing.cache.clear();
  vi.useFakeTimers();
  vi.mocked(matchCombos).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDeckCombos', () => {
  it('debounces input changes — only one request after rapid typing', async () => {
    vi.mocked(matchCombos).mockResolvedValue(empty);
    const { rerender } = renderHook(
      ({ deck }: { deck: string[] }) =>
        useDeckCombos({ deckOracleIds: deck, ownedOracleIds: ['a', 'b'] }),
      { initialProps: { deck: ['a'] } }
    );

    rerender({ deck: ['a', 'b'] });
    rerender({ deck: ['a', 'b', 'c'] });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matchCombos).toHaveBeenCalledTimes(1);
  });

  it('serves repeated queries from the cache without a new request', async () => {
    const data = {
      ...empty,
      inDeck: [
        {
          combo: {
            id: 'x',
            identity: '',
            produces: [],
            prerequisites: null,
            description: null,
            manaNeeded: null,
            popularity: 0,
            cardCount: 0,
            cards: [],
            bracket: null,
          },
          presentOracleIds: [],
          missingOracleIds: [],
        },
      ],
    };
    vi.mocked(matchCombos).mockResolvedValue(data);

    const { rerender } = renderHook(
      ({ deck }: { deck: string[] }) =>
        useDeckCombos({ deckOracleIds: deck, ownedOracleIds: ['a'] }),
      { initialProps: { deck: ['a'] } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Switch to a different key, then back.
    rerender({ deck: ['a', 'b'] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ deck: ['a'] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Two unique queries → exactly two API calls; the third is a cache hit.
    expect(matchCombos).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled', async () => {
    vi.mocked(matchCombos).mockResolvedValue(empty);
    renderHook(() =>
      useDeckCombos({ deckOracleIds: ['a'], ownedOracleIds: ['a'], enabled: false })
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(matchCombos).not.toHaveBeenCalled();
  });
});
