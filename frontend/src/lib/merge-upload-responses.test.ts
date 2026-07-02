import { describe, expect, it } from 'vitest';
import { mergeUploadResponses } from './merge-upload-responses';
import type { EnrichedCard, UploadResponse } from '@/types';

const card = (id: string): EnrichedCard => ({ copyId: id, name: id }) as unknown as EnrichedCard;

const response = (overrides: Partial<UploadResponse>): UploadResponse => ({
  cards: [],
  totalRows: 0,
  scryfallHits: 0,
  scryfallMisses: 0,
  unresolvedNames: [],
  fetchErrors: [],
  detectedFormat: 'manabox',
  ...overrides,
});

describe('mergeUploadResponses', () => {
  it('throws on empty input', () => {
    expect(() => mergeUploadResponses([])).toThrow(/no responses/);
  });

  it('returns the single response unchanged', () => {
    const r = response({ cards: [card('a')], totalRows: 1, scryfallHits: 1 });
    expect(mergeUploadResponses([r])).toBe(r);
  });

  it('concatenates cards in chunk order and sums counters', () => {
    const merged = mergeUploadResponses([
      response({ cards: [card('a'), card('b')], totalRows: 2, scryfallHits: 2 }),
      response({ cards: [card('c')], totalRows: 1, scryfallHits: 0, scryfallMisses: 1 }),
    ]);
    expect(merged.cards.map((c) => c.copyId)).toEqual(['a', 'b', 'c']);
    expect(merged.totalRows).toBe(3);
    expect(merged.scryfallHits).toBe(2);
    expect(merged.scryfallMisses).toBe(1);
  });

  it('dedupes unresolvedNames while preserving first-seen order', () => {
    const merged = mergeUploadResponses([
      response({ unresolvedNames: ['Phyrexian Tower', 'Mox Diamond'] }),
      response({ unresolvedNames: ['Mox Diamond', 'Bayou'] }),
    ]);
    expect(merged.unresolvedNames).toEqual(['Phyrexian Tower', 'Mox Diamond', 'Bayou']);
  });

  it('concatenates fetchErrors rows across chunks in order', () => {
    const merged = mergeUploadResponses([
      response({ fetchErrors: [{ name: 'Sol Ring', quantity: 2 }] }),
      response({ fetchErrors: [{ name: 'Arcane Signet' }] }),
    ]);
    expect(merged.fetchErrors).toEqual([
      { name: 'Sol Ring', quantity: 2 },
      { name: 'Arcane Signet' },
    ]);
  });

  it('takes detectedFormat from the first chunk', () => {
    const merged = mergeUploadResponses([
      response({ detectedFormat: 'manabox' }),
      // Chunks come from the same file so detection should agree, but if it
      // somehow doesn't we still want a deterministic value.
      response({ detectedFormat: 'archidekt' }),
    ]);
    expect(merged.detectedFormat).toBe('manabox');
  });
});
