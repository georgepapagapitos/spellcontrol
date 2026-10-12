// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDeckMissing } from './use-deck-missing';

type Args = Parameters<typeof useDeckMissing>[0];
const base: Args = {
  title: 'Deck',
  cards: [],
  collectionByCopyId: undefined,
  currency: 'USD',
  pricesVersion: 0,
  arrivalsByType: undefined,
  autoOpenArrivals: false,
};
const arrivals = {
  creature: [{ score: 1 }, { score: 5 }],
  land: [{ score: 3 }],
} as unknown as Args['arrivalsByType'];

describe('useDeckMissing', () => {
  it('lists new arrivals across categories, best fit first', () => {
    const { result } = renderHook(() => useDeckMissing({ ...base, arrivalsByType: arrivals }));
    expect(result.current.arrivalRows.map((r) => r.score)).toEqual([5, 3, 1]);
    expect(result.current.arrivalsOpen).toBe(false);
  });

  it('opens the arrivals sheet once on a deep link, and not again after it is closed', () => {
    const { result, rerender } = renderHook((a: Args) => useDeckMissing(a), {
      initialProps: { ...base, arrivalsByType: arrivals, autoOpenArrivals: true },
    });
    expect(result.current.arrivalsOpen).toBe(true);
    act(() => result.current.setArrivalsOpen(false));
    rerender({ ...base, arrivalsByType: arrivals, autoOpenArrivals: true });
    expect(result.current.arrivalsOpen).toBe(false);
  });

  it('does not open for a deep link when there is nothing to review', () => {
    const { result } = renderHook(() => useDeckMissing({ ...base, autoOpenArrivals: true }));
    expect(result.current.arrivalsOpen).toBe(false);
  });
});
