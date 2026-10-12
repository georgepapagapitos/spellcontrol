// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { _resetForTests, setPrices } from '@/lib/collection/card-prices';
import { _resetDeckPriceResolveForTests } from '@/lib/deck/deck-price-resolve';
import { useDeckPrices } from './use-deck-prices';

const card = (id: string) => ({ id, name: id }) as unknown as ScryfallCard;

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
  _resetDeckPriceResolveForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ prices: {} }) }))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('useDeckPrices', () => {
  it('returns a new version when prices land in the cache', () => {
    const { result } = renderHook(() => useDeckPrices([card('a')]));
    const before = result.current;
    act(() => setPrices({ a: { usd: 4, pricedAt: Date.now() } }));
    expect(result.current).toBeGreaterThan(before);
  });

  it('asks for uncached deck printings once', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    const { rerender } = renderHook(() => useDeckPrices([card('a'), card('b'), undefined]));
    await act(async () => {});
    rerender();
    await act(async () => {});
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0][1] as { body: string }).body).scryfallIds).toEqual([
      'a',
      'b',
    ]);
  });
});
