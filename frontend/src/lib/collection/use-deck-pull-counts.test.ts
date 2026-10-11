// @vitest-environment happy-dom
/**
 * The deck tiles' "58 of 100 pullable" badge is computed after paint, not
 * inside render (E336). On a 12k-card account the compute is 350-500 ms and its
 * inputs change identity several times as a warm reload settles; in render it
 * held the whole deck list back and re-blocked it on every change.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '@/store/decks';
import type { BinderDef, EnrichedCard } from '@/types/index';

const buildPullList = vi.fn(() => [{ kind: 'binder', rows: [{ qty: 3 }, { qty: 1 }] }]);
vi.mock('./pull-list', () => ({
  buildBinderPlacement: () => ({}),
  buildPullList: (...a: unknown[]) => (buildPullList as (...x: unknown[]) => unknown)(...a),
  isPullableKind: (k: string) => k === 'binder',
}));

import { PULL_COUNTS_SETTLE_MS, useDeckPullCounts } from './use-deck-pull-counts';

const deck = (id: string) => ({ id }) as unknown as Deck;
const binders = [{ id: 'b1' }] as unknown as BinderDef[];
const cards = [] as EnrichedCard[];
const allocations = new Map();

describe('useDeckPullCounts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildPullList.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('computes nothing during render, then fills in once the inputs settle', () => {
    const { result } = renderHook(() =>
      useDeckPullCounts([deck('a')], cards, binders, allocations, undefined)
    );
    expect(buildPullList).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    act(() => {
      vi.advanceTimersByTime(PULL_COUNTS_SETTLE_MS);
    });
    expect(result.current?.get('a')).toEqual({ pullable: 4, total: 4 });
  });

  it('turns a burst of input changes into one compute and keeps the old badges up meanwhile', () => {
    const { result, rerender } = renderHook(
      ({ decks }) => useDeckPullCounts(decks, cards, binders, allocations, undefined),
      { initialProps: { decks: [deck('a')] } }
    );
    act(() => {
      vi.advanceTimersByTime(PULL_COUNTS_SETTLE_MS);
    });
    buildPullList.mockClear();
    rerender({ decks: [deck('a'), deck('b')] });
    rerender({ decks: [deck('a'), deck('b'), deck('c')] });
    expect(result.current?.has('a')).toBe(true);
    expect(buildPullList).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(PULL_COUNTS_SETTLE_MS);
    });
    expect(buildPullList).toHaveBeenCalledTimes(3);
    expect([...(result.current?.keys() ?? [])]).toEqual(['a', 'b', 'c']);
  });

  it('shows no badges at all until the user has binders', () => {
    const { result } = renderHook(() =>
      useDeckPullCounts([deck('a')], cards, [], allocations, undefined)
    );
    act(() => {
      vi.advanceTimersByTime(PULL_COUNTS_SETTLE_MS * 2);
    });
    expect(result.current).toBeNull();
    expect(buildPullList).not.toHaveBeenCalled();
  });
});
