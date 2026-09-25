// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStarterDeckCardNames } from './starter-deck-cards';
import type { DeckImportResponse, ProductResolveResponse } from '../../types';

const fetchProduct = vi.fn();
vi.mock('../api', () => ({
  fetchProduct: (...args: unknown[]) => fetchProduct(...args),
}));

function resolved(deck: Partial<DeckImportResponse>): ProductResolveResponse {
  return {
    product: {
      fileName: 'zombies.json',
      code: 'xyz',
      name: 'Zombie Outbreak',
      type: 'Commander Deck',
      releaseDate: '2026-01-01',
    },
    deck: {
      commander: null,
      partner: null,
      companion: null,
      cards: [],
      unresolvedNames: [],
      fetchErrors: [],
      detectedFormat: 'commander',
      cardCount: 0,
      ...deck,
    } as DeckImportResponse,
    physicalCards: [],
    unresolvedNames: [],
    fetchErrors: [],
    physicalCardCount: 0,
  };
}

describe('useStarterDeckCardNames', () => {
  beforeEach(() => {
    fetchProduct.mockReset();
  });

  it('resolves a file name into its commander + card names', async () => {
    fetchProduct.mockResolvedValue(
      resolved({
        commander: { name: 'Wilhelt, the Rotcleaver' } as DeckImportResponse['commander'],
        cards: [{ name: 'Sol Ring' }, { name: 'Diregraf Colossus' }] as DeckImportResponse['cards'],
      })
    );
    const { result } = renderHook(({ files }) => useStarterDeckCardNames(files), {
      initialProps: { files: ['zombies.json'] },
    });
    // Nothing yet — the lookup is in flight, and there is no loading entry.
    expect(result.current.get('zombies.json')).toBeUndefined();
    await waitFor(() =>
      expect(result.current.get('zombies.json')).toEqual([
        'Wilhelt, the Rotcleaver',
        'Sol Ring',
        'Diregraf Colossus',
      ])
    );
  });

  it('caches by file name — a second seat on the same starter fetches once', async () => {
    fetchProduct.mockResolvedValue(
      resolved({ cards: [{ name: 'Sol Ring' }] as DeckImportResponse['cards'] })
    );
    const { result, rerender } = renderHook(({ files }) => useStarterDeckCardNames(files), {
      initialProps: { files: ['zombies.json'] },
    });
    await waitFor(() => expect(result.current.get('zombies.json')).toBeDefined());
    fetchProduct.mockClear();
    rerender({ files: ['zombies.json', 'zombies.json'] });
    expect(fetchProduct).not.toHaveBeenCalled();
  });

  it('is best-effort: a failed lookup checks nothing, and never throws', async () => {
    fetchProduct.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(({ files }) => useStarterDeckCardNames(files), {
      initialProps: { files: ['broken.json'] },
    });
    await waitFor(() => expect(fetchProduct).toHaveBeenCalled());
    await waitFor(() => expect(result.current.get('broken.json')).toEqual([]));
  });
});
