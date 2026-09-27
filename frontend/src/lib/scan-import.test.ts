import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UploadResponse } from '../types';
import type { ScannedEntry } from './use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';

const importTextMock = vi.fn<(text: string) => Promise<UploadResponse>>();
vi.mock('./api', () => ({
  importText: (text: string) => importTextMock(text),
}));

import {
  ADD_LIST_LABEL,
  SCANNED_CARDS_LABEL,
  entriesToImportCsv,
  importEntries,
} from './scan-import';

function response(overrides: Partial<UploadResponse> = {}): UploadResponse {
  return {
    cards: [],
    totalRows: 0,
    scryfallHits: 0,
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
    detectedFormat: 'generic-csv',
    ...overrides,
  };
}

function makeCard(over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'print-1',
    oracle_id: 'oracle-1',
    name: 'Sol Ring',
    set: 'cmr',
    collector_number: '472',
    prices: { usd: '2.00' },
    ...over,
  } as ScryfallCard;
}

function makeEntry(over: Partial<ScannedEntry> = {}): ScannedEntry {
  return {
    id: 'print-1::nonfoil',
    card: makeCard(),
    qty: 1,
    finish: 'nonfoil',
    rawText: 'Sol Ring',
    ...over,
  };
}

beforeEach(() => {
  importTextMock.mockReset();
});

describe('entriesToImportCsv', () => {
  it('emits a header the generic-CSV parser detects, and one row per entry', () => {
    const csv = entriesToImportCsv([
      makeEntry({ qty: 2, finish: 'foil', condition: 'lp', language: 'ja' }),
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toBe(
      'Name,Scryfall ID,Set Code,Collector Number,Foil,Quantity,Condition,Language'
    );
    expect(row).toBe('Sol Ring,print-1,cmr,472,foil,2,lp,ja');
  });

  it('leaves condition and language cells blank for the unmarked defaults', () => {
    const csv = entriesToImportCsv([makeEntry()]);
    const [, row] = csv.split('\n');
    expect(row).toBe('Sol Ring,print-1,cmr,472,nonfoil,1,,');
  });

  it('quotes a name containing a comma', () => {
    const csv = entriesToImportCsv([
      makeEntry({ card: makeCard({ name: 'Kongming, "Sleeping Dragon"' }) }),
    ]);
    const [, row] = csv.split('\n');
    expect(row).toContain('"Kongming, ""Sleeping Dragon"""');
  });
});

describe('importEntries', () => {
  it('parses the CSV and merges under the scanned-cards label when every entry was scanned', async () => {
    importTextMock.mockResolvedValue(response({ cards: [{ name: 'Sol Ring' } as never] }));
    const importCards = vi.fn(async () => 'import-id');

    const result = await importEntries([makeEntry({ source: 'scanned' })], importCards);

    expect(importTextMock).toHaveBeenCalledWith(
      entriesToImportCsv([makeEntry({ source: 'scanned' })])
    );
    expect(importCards).toHaveBeenCalledWith(
      expect.objectContaining({ cards: expect.any(Array) }),
      SCANNED_CARDS_LABEL,
      'merge'
    );
    expect(result).toEqual({
      added: 1,
      requested: 1,
      unresolved: 0,
      fetchErrors: 0,
      importId: 'import-id',
    });
  });

  it('treats an entry with no source as scanned (legacy queue rows)', async () => {
    importTextMock.mockResolvedValue(response());
    const importCards = vi.fn(async () => 'id');
    await importEntries([makeEntry({ source: undefined })], importCards);
    expect(importCards).toHaveBeenCalledWith(expect.anything(), SCANNED_CARDS_LABEL, 'merge');
  });

  it('labels a batch with any searched row as add-list, even mixed with scanned rows', async () => {
    importTextMock.mockResolvedValue(response());
    const importCards = vi.fn(async () => 'id');
    await importEntries(
      [
        makeEntry({ source: 'scanned' }),
        makeEntry({
          id: 'print-2::nonfoil',
          card: makeCard({ id: 'print-2' }),
          source: 'searched',
        }),
      ],
      importCards
    );
    expect(importCards).toHaveBeenCalledWith(expect.anything(), ADD_LIST_LABEL, 'merge');
  });

  it('sums qty across entries for the requested count', async () => {
    importTextMock.mockResolvedValue(
      response({
        cards: [{ name: 'Sol Ring' } as never],
        unresolvedNames: ['Blacker Lotus'],
        fetchErrors: [{ name: 'Arcane Signet', quantity: 1 }],
      })
    );
    const result = await importEntries(
      [
        makeEntry({ qty: 3 }),
        makeEntry({ id: 'print-2::nonfoil', card: makeCard({ id: 'print-2' }) }),
      ],
      vi.fn(async () => 'id')
    );
    expect(result).toMatchObject({ added: 1, requested: 4, unresolved: 1, fetchErrors: 1 });
  });

  it('propagates parser failures to the caller without touching importCards', async () => {
    importTextMock.mockRejectedValue(new Error('parse boom'));
    const importCards = vi.fn(async () => 'id');

    await expect(importEntries([makeEntry()], importCards)).rejects.toThrow('parse boom');
    expect(importCards).not.toHaveBeenCalled();
  });
});
