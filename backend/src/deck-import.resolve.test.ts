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
const pass = (
  resolved: Array<ScryfallCard | undefined>,
  unresolvedNames: string[] = [],
  fetchErrorNames: string[] = []
) => ({ resolved, unresolvedNames, fetchErrorNames });

beforeEach(() => resolveCards.mockReset());

describe('resolveDeckRows', () => {
  it('slices resolved cards into commander + deck sections', async () => {
    resolveCards.mockResolvedValueOnce(pass([card('Zada'), card('Sol Ring'), card('Mountain')]));
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
    resolveCards.mockResolvedValueOnce(pass([undefined], ['Plains']));
    // Second pass (without collectorNumber): it resolves.
    resolveCards.mockResolvedValueOnce(pass([card('Plains')]));

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

  // E72 regression: outage vs genuine miss must survive the two-pass slicing.
  it('routes outage rows to fetchErrorNames and misses to unresolvedNames', async () => {
    resolveCards.mockResolvedValueOnce(
      pass([card('Zada'), undefined, undefined], ['Notacard'], ['Sol Ring'])
    );
    const sections = await resolveDeckRows(
      [row('Zada')],
      [],
      [row('Sol Ring'), row('Notacard')],
      fakeCache
    );
    expect(sections.fetchErrorNames).toEqual(['Sol Ring']);
    expect(sections.unresolvedNames).toEqual(['Notacard']);
  });

  it('takes a retried row’s verdict from the retry pass (fetch error → genuine miss)', async () => {
    // First pass: the collector-number row’s batch never reached Scryfall.
    resolveCards.mockResolvedValueOnce(pass([undefined], [], ['Plains']));
    // Retry (without collectorNumber) DID reach Scryfall — genuinely not found.
    resolveCards.mockResolvedValueOnce(pass([undefined], ['Plains']));

    const sections = await resolveDeckRows(
      [],
      [],
      [row('Plains', { collectorNumber: '999' })],
      fakeCache
    );
    expect(sections.unresolvedNames).toEqual(['Plains']);
    expect(sections.fetchErrorNames).toEqual([]);
  });

  it('keeps a retried row in fetchErrorNames when the retry also fails to fetch', async () => {
    resolveCards.mockResolvedValueOnce(pass([undefined], ['Plains']));
    resolveCards.mockResolvedValueOnce(pass([undefined], [], ['Plains']));

    const sections = await resolveDeckRows(
      [],
      [],
      [row('Plains', { collectorNumber: '999' })],
      fakeCache
    );
    expect(sections.fetchErrorNames).toEqual(['Plains']);
    expect(sections.unresolvedNames).toEqual([]);
  });
});
