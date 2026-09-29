// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCardDetail } from './use-card-detail';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getPrintingResilient: vi.fn(),
}));
import { getPrintingResilient } from '@/deck-builder/services/scryfall/client';
const mockGet = vi.mocked(getPrintingResilient);

function card(name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  return { id: 'x', oracle_id: 'o', name, cmc: 0, ...extra } as unknown as ScryfallCard;
}

afterEach(() => vi.clearAllMocks());

describe('useCardDetail', () => {
  it('returns null and does not fetch when no name', () => {
    const { result } = renderHook(() => useCardDetail(undefined));
    expect(result.current).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('resolves the full card for a name', async () => {
    const c = card('Llanowar Elves');
    mockGet.mockResolvedValueOnce(c);
    const { result } = renderHook(() => useCardDetail('Llanowar Elves'));
    await waitFor(() => expect(result.current).toBe(c));
    expect(mockGet).toHaveBeenCalledWith(undefined, 'Llanowar Elves');
  });

  it('refetches when the name changes', async () => {
    mockGet.mockResolvedValueOnce(card('A')).mockResolvedValueOnce(card('B'));
    const { result, rerender } = renderHook(({ n }) => useCardDetail(n), {
      initialProps: { n: 'A' },
    });
    await waitFor(() => expect(result.current?.name).toBe('A'));
    rerender({ n: 'B' });
    await waitFor(() => expect(result.current?.name).toBe('B'));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  // Flavor text is per printing: two copies of one name in a collection must
  // each show their own, not a representative printing's.
  it('resolves each printing of the same name separately', async () => {
    mockGet.mockImplementation(async (id) =>
      card('Academy Manufactor', {
        id: id ?? 'x',
        flavor_text: id === 'blc-264' ? 'Automated systems' : 'Another printing',
      })
    );
    const { result, rerender } = renderHook(({ id }) => useCardDetail('Academy Manufactor', id), {
      initialProps: { id: 'blc-264' },
    });
    await waitFor(() => expect(result.current?.flavor_text).toBe('Automated systems'));
    rerender({ id: 'mh2-219' });
    await waitFor(() => expect(result.current?.flavor_text).toBe('Another printing'));
    expect(mockGet).toHaveBeenNthCalledWith(1, 'blc-264', 'Academy Manufactor');
    expect(mockGet).toHaveBeenNthCalledWith(2, 'mh2-219', 'Academy Manufactor');
  });

  it('stays null when the resolve rejects', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useCardDetail('Mox'));
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
