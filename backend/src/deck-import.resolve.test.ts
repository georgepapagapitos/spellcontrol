import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImportRow } from './parsers/types';
import type { ScryfallCard } from './types';

// Mock the Scryfall resolver so resolveDeckRows can be tested without network.
// The collector-number retry now lives inside resolveCards itself (scryfall.ts,
// covered by scryfall.test.ts) — resolveDeckRows just calls it once and slices.
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

  // E72 regression: outage vs genuine miss must survive the slicing.
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
});
