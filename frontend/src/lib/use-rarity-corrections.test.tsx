// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { useRarityCorrections } from './use-rarity-corrections';

vi.mock('./offline', () => ({
  offlineDataAvailable: vi.fn(),
  offlineGetCardsByOracleIds: vi.fn(),
}));

import { offlineDataAvailable, offlineGetCardsByOracleIds } from './offline';

/** Minimal ScryfallCard — the hook only reads `oracle_id` and `rarity`. */
function card(oracleId: string | undefined, rarity: string): ScryfallCard {
  return { oracle_id: oracleId, rarity } as ScryfallCard;
}

beforeEach(() => {
  vi.mocked(offlineDataAvailable).mockReset();
  vi.mocked(offlineGetCardsByOracleIds).mockReset();
});

describe('useRarityCorrections', () => {
  it('corrects a stale common card to its real offline rarity', async () => {
    vi.mocked(offlineDataAvailable).mockResolvedValue(true);
    vi.mocked(offlineGetCardsByOracleIds).mockResolvedValue(
      new Map([['o-beast', card('o-beast', 'rare')]])
    );

    const { result } = renderHook(() => useRarityCorrections([card('o-beast', 'common')]));

    await waitFor(() => expect(result.current.get('o-beast')).toBe('rare'));
  });

  it('only re-checks common-rarity cards, trusting other rarities as-is', async () => {
    vi.mocked(offlineDataAvailable).mockResolvedValue(true);
    vi.mocked(offlineGetCardsByOracleIds).mockResolvedValue(new Map());

    renderHook(() => useRarityCorrections([card('o-rare', 'rare'), card('o-cmn', 'common')]));

    await waitFor(() => expect(offlineGetCardsByOracleIds).toHaveBeenCalled());
    expect(offlineGetCardsByOracleIds).toHaveBeenCalledWith(['o-cmn']);
  });

  it('keeps an entry out when the resolved rarity is genuinely common', async () => {
    vi.mocked(offlineDataAvailable).mockResolvedValue(true);
    vi.mocked(offlineGetCardsByOracleIds).mockResolvedValue(
      new Map([['o-cmn', card('o-cmn', 'common')]])
    );

    const { result } = renderHook(() => useRarityCorrections([card('o-cmn', 'common')]));

    await waitFor(() => expect(offlineGetCardsByOracleIds).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it('returns an empty map when no offline data is present', async () => {
    vi.mocked(offlineDataAvailable).mockResolvedValue(false);

    const { result } = renderHook(() => useRarityCorrections([card('o-beast', 'common')]));

    await waitFor(() => expect(offlineDataAvailable).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
    expect(offlineGetCardsByOracleIds).not.toHaveBeenCalled();
  });

  it('does nothing when there are no suspect cards', async () => {
    vi.mocked(offlineDataAvailable).mockResolvedValue(true);

    renderHook(() => useRarityCorrections([card('o-rare', 'rare'), card(undefined, 'common')]));

    await Promise.resolve();
    expect(offlineDataAvailable).not.toHaveBeenCalled();
  });

  it('drops corrections when the deck changes to a different suspect set', async () => {
    vi.mocked(offlineDataAvailable).mockResolvedValue(true);
    vi.mocked(offlineGetCardsByOracleIds).mockImplementation(async (ids: string[]) =>
      ids.includes('o-beast')
        ? new Map([['o-beast', card('o-beast', 'rare')]])
        : new Map([['o-sol', card('o-sol', 'uncommon')]])
    );

    const { result, rerender } = renderHook(({ cards }) => useRarityCorrections(cards), {
      initialProps: { cards: [card('o-beast', 'common')] },
    });
    await waitFor(() => expect(result.current.get('o-beast')).toBe('rare'));

    rerender({ cards: [card('o-sol', 'common')] });
    // Stale Beast Whisperer entry is gone immediately; Sol Ring resolves next.
    expect(result.current.has('o-beast')).toBe(false);
    await waitFor(() => expect(result.current.get('o-sol')).toBe('uncommon'));
  });
});
