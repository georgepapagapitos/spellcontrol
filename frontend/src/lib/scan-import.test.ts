import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UploadResponse } from '../types';

const importTextMock = vi.fn<(text: string) => Promise<UploadResponse>>();
vi.mock('./api', () => ({
  importText: (text: string) => importTextMock(text),
}));

import { importScannedCards, SCANNED_CARDS_LABEL } from './scan-import';

function response(overrides: Partial<UploadResponse> = {}): UploadResponse {
  return {
    cards: [],
    totalRows: 0,
    scryfallHits: 0,
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'mtga',
    ...overrides,
  };
}

beforeEach(() => {
  importTextMock.mockReset();
});

describe('importScannedCards', () => {
  it('parses the text and merges the result under the scanned-cards label', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    importTextMock.mockResolvedValue(response({ cards: [{ name: 'Forest' } as any] }));
    const importCards = vi.fn(async () => 'import-id');

    const result = await importScannedCards('1 Forest', 1, importCards);

    expect(importTextMock).toHaveBeenCalledWith('1 Forest');
    expect(importCards).toHaveBeenCalledWith(
      expect.objectContaining({ cards: expect.any(Array) }),
      SCANNED_CARDS_LABEL,
      'merge'
    );
    expect(result).toEqual({ added: 1, requested: 1, unresolved: 0, fetchErrors: 0 });
  });

  it('reports the parsed count and unresolved names independently of the requested count', async () => {
    importTextMock.mockResolvedValue(
      response({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cards: [{ name: 'Forest' } as any],
        unresolvedNames: ['Blacker Lotus'],
        fetchErrors: [{ name: 'Sol Ring', quantity: 1 }],
      })
    );

    const result = await importScannedCards(
      'text',
      3,
      vi.fn(async () => 'id')
    );

    expect(result).toEqual({ added: 1, requested: 3, unresolved: 1, fetchErrors: 1 });
  });

  it('propagates parser failures to the caller', async () => {
    importTextMock.mockRejectedValue(new Error('parse boom'));
    const importCards = vi.fn(async () => 'id');

    await expect(importScannedCards('text', 1, importCards)).rejects.toThrow('parse boom');
    expect(importCards).not.toHaveBeenCalled();
  });
});
