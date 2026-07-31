// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getCardsByNames = vi.fn();
const getCardPrice = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (names: string[]) => getCardsByNames(names),
  getCardPrice: (card: unknown, currency: string) => getCardPrice(card, currency),
}));
vi.mock('../../lib/currency', () => ({ getCurrency: () => 'USD' }));

import { useMissingCardPrices } from './use-missing-prices';

function cardsFor(names: string[]) {
  return new Map(names.map((n) => [n, { name: n }]));
}

describe('useMissingCardPrices', () => {
  beforeEach(() => {
    getCardsByNames.mockReset();
    getCardPrice.mockReset().mockReturnValue('4.20');
  });

  it('fetches nothing for an empty list', async () => {
    const { result } = renderHook(() => useMissingCardPrices([]));
    expect(getCardsByNames).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('maps prices by lower-cased name', async () => {
    getCardsByNames.mockResolvedValue(cardsFor(['Demonic Consultation']));
    const { result } = renderHook(() => useMissingCardPrices(['Demonic Consultation']));

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get('demonic consultation')).toBe(4.2);
  });

  it('dedupes case-insensitively so one card is asked for once', async () => {
    getCardsByNames.mockResolvedValue(cardsFor(['Sol Ring']));
    renderHook(() => useMissingCardPrices(['Sol Ring', 'sol ring', 'SOL RING']));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(getCardsByNames.mock.calls[0][0]).toEqual(['Sol Ring']);
  });

  it('caps the request rather than asking for an unbounded list', async () => {
    const many = Array.from({ length: 200 }, (_, i) => `Card ${i}`);
    getCardsByNames.mockResolvedValue(new Map());
    renderHook(() => useMissingCardPrices(many));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(getCardsByNames.mock.calls[0][0]).toHaveLength(60);
  });

  it('drops unpriceable cards instead of recording NaN', async () => {
    getCardsByNames.mockResolvedValue(cardsFor(['Priceless Card']));
    getCardPrice.mockReturnValue(null);
    const { result } = renderHook(() => useMissingCardPrices(['Priceless Card']));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(result.current.has('priceless card')).toBe(false);
  });

  it('does not show the previous list’s prices while a new list is loading', async () => {
    getCardsByNames.mockResolvedValue(cardsFor(['Sol Ring']));
    const { result, rerender } = renderHook(({ n }) => useMissingCardPrices(n), {
      initialProps: { n: ['Sol Ring'] },
    });
    await waitFor(() => expect(result.current.size).toBe(1));

    // Switch lists — the in-flight result is keyed to the old request, so the
    // hook reports nothing rather than a stale price against a new card.
    let resolve!: (v: Map<string, unknown>) => void;
    getCardsByNames.mockReturnValue(new Promise((r) => (resolve = r)));
    rerender({ n: ['Mana Crypt'] });
    expect(result.current.size).toBe(0);

    resolve(cardsFor(['Mana Crypt']));
    await waitFor(() => expect(result.current.get('mana crypt')).toBe(4.2));
  });

  it('shows no prices rather than surfacing a lookup failure', async () => {
    getCardsByNames.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMissingCardPrices(['Sol Ring']));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
