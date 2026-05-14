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

  it('surfaces the error from a failed request', async () => {
    vi.mocked(matchCombos).mockRejectedValue(new Error('Server is down'));

    const { result } = renderHook(() =>
      useDeckCombos({ deckOracleIds: ['a'], ownedOracleIds: ['a'] })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.error).toBe('Server is down');
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('falls back to a generic message when the rejected error has no message field', async () => {
    // Use a bare object with no message — exercises the `?? 'Failed to load…'` branch.
    vi.mocked(matchCombos).mockRejectedValue({} as Error);

    const { result } = renderHook(() =>
      useDeckCombos({ deckOracleIds: ['b'], ownedOracleIds: ['b'] })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.error).toBe('Failed to load combos.');
  });

  it('evicts the oldest cache entry once the cache fills past CACHE_LIMIT', async () => {
    vi.mocked(matchCombos).mockResolvedValue(empty);

    // CACHE_LIMIT is 32. Run 33 distinct queries — the first one must be
    // evicted to make room for the 33rd.
    for (let i = 0; i < 33; i++) {
      const { unmount } = renderHook(() =>
        useDeckCombos({ deckOracleIds: [`d-${i}`], ownedOracleIds: ['o'] })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      unmount();
    }

    // The very first key (d-0) should have been evicted.
    const firstKey = __testing.buildKey(['d-0'], ['o'], undefined);
    expect(__testing.cache.has(firstKey)).toBe(false);
    // The most-recent key should still be present.
    const lastKey = __testing.buildKey(['d-32'], ['o'], undefined);
    expect(__testing.cache.has(lastKey)).toBe(true);
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
