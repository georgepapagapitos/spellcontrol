// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCardDetail } from './use-card-detail';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardByNameResilient: vi.fn(),
}));
import { getCardByNameResilient } from '@/deck-builder/services/scryfall/client';
const mockGet = vi.mocked(getCardByNameResilient);

function card(name: string): ScryfallCard {
  return { id: 'x', oracle_id: 'o', name, cmc: 0 } as unknown as ScryfallCard;
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
    expect(mockGet).toHaveBeenCalledWith('Llanowar Elves');
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

  it('stays null when the resolve rejects', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useCardDetail('Mox'));
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
