import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImportRow } from './parsers/types';
import type { ScryfallCard } from './types';

// Mock the Scryfall resolver so resolveDeckRows can be tested without network.
const resolveCards = vi.fn();
vi.mock('./scryfall', () => ({ resolveCards: (...a: unknown[]) => resolveCards(...a) }));

import { resolveDeckRows } from './deck-import';

const fakeCache = {} as never;
const card = (name: string): ScryfallCard => ({ name }) as unknown as ScryfallCard;
const row = (name: string, extra: Partial<ImportRow> = {}): ImportRow => ({
  name,
  quantity: 1,
  sourceFormat: 'mtgjson',
  ...extra,
});

beforeEach(() => resolveCards.mockReset());

describe('resolveDeckRows', () => {
  it('slices resolved cards into commander + deck sections', async () => {
    resolveCards.mockResolvedValueOnce({
      resolved: [card('Zada'), card('Sol Ring'), card('Mountain')],
      unresolvedNames: [],
    });
    const sections = await resolveDeckRows(
      [row('Zada')],
      [],
      [row('Sol Ring'), row('Mountain')],
      fakeCache
    );
    expect(sections.commander?.name).toBe('Zada');
    expect(sections.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Mountain']);
    expect(resolveCards).toHaveBeenCalledTimes(1);
  });

  it('retries collector-number rows that miss, dropping the collector number', async () => {
    // First pass: the collector-number row fails to resolve.
    resolveCards.mockResolvedValueOnce({ resolved: [undefined], unresolvedNames: ['Plains'] });
    // Second pass (without collectorNumber): it resolves.
    resolveCards.mockResolvedValueOnce({ resolved: [card('Plains')], unresolvedNames: [] });

    const sections = await resolveDeckRows(
      [],
      [],
      [row('Plains', { collectorNumber: '999' })],
      fakeCache
    );
    expect(sections.cards.map((c) => c.name)).toEqual(['Plains']);
    expect(resolveCards).toHaveBeenCalledTimes(2);
    // The retry row had its collectorNumber stripped.
    const retryRows = resolveCards.mock.calls[1][0] as ImportRow[];
    expect(retryRows[0].collectorNumber).toBeUndefined();
  });
});
