// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ListEntry } from '../types';
import { useEnrichedListEntries } from './use-enriched-list-entries';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: vi.fn(),
}));

function entry(over: Partial<ListEntry> = {}): ListEntry {
  return {
    id: over.id ?? 'e1',
    name: over.name ?? 'Sol Ring',
    scryfallId: over.scryfallId ?? 'sf-entry',
    setCode: over.setCode ?? 'LEA',
    collectorNumber: over.collectorNumber ?? '270',
    finish: over.finish ?? 'nonfoil',
    oracleId: over.oracleId ?? 'oracle-sol',
    quantity: over.quantity ?? 1,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useEnrichedListEntries', () => {
  it('resolves entries to full cards, overlaying the entry printing identity', async () => {
    vi.mocked(getCardsByNames).mockResolvedValue(
      new Map<string, ScryfallCard>([
        [
          'Sol Ring',
          {
            id: 'sf-default-printing',
            name: 'Sol Ring',
            set: 'cmr',
            collector_number: '1',
            type_line: 'Artifact',
            cmc: 1,
          } as unknown as ScryfallCard,
        ],
      ])
    );

    const { result } = renderHook(() => useEnrichedListEntries([entry()]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(1);
    const { card } = result.current.rows[0];
    // Oracle-level data comes from the resolved card (drives filtering)...
    expect(card.typeLine).toBe('Artifact');
    expect(card.cmc).toBe(1);
    // ...but identity is the entry's exact printing, not the default printing.
    expect(card.scryfallId).toBe('sf-entry');
    expect(card.setCode).toBe('LEA');
    expect(card.collectorNumber).toBe('270');
    expect(card.copyId).toBe('e1'); // stable per entry → preview keys
  });

  it('falls back to a skeleton card on an offline/resolution miss (no throw)', async () => {
    vi.mocked(getCardsByNames).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useEnrichedListEntries([entry({ name: 'Black Lotus' })]));

    await waitFor(() => expect(getCardsByNames).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].card.name).toBe('Black Lotus');
    expect(result.current.rows[0].card.typeLine).toBeUndefined();
  });

  it('is empty and not loading for an empty list', () => {
    const { result } = renderHook(() => useEnrichedListEntries([]));
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(getCardsByNames).not.toHaveBeenCalled();
  });
});
