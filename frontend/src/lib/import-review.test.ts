import { describe, it, expect } from 'vitest';
import { mergeImportResults, removeUnresolvedName, importReviewHeadline } from './import-review';
import type { UploadResponse } from '../types';

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
    detectedFormat: 'manabox',
    ...overrides,
  };
}

describe('mergeImportResults', () => {
  it('returns all-zero totals for an empty batch', () => {
    expect(mergeImportResults([])).toEqual({
      cardsImported: 0,
      scryfallHits: 0,
      unresolvedCount: 0,
      fetchErrorCount: 0,
      malformedCount: 0,
      skippedUnownedCount: 0,
      clampedCount: 0,
    });
  });

  it('sums a single file straight through', () => {
    const r = response({
      cards: [{}, {}] as never,
      scryfallHits: 2,
      unresolvedNames: ['Foo'],
      fetchErrors: [{ name: 'Bar' }],
      malformedRows: ['garbage,line'],
      skippedUnownedRows: 1,
      clampedRows: 3,
    });
    expect(mergeImportResults([r])).toEqual({
      cardsImported: 2,
      scryfallHits: 2,
      unresolvedCount: 1,
      fetchErrorCount: 1,
      malformedCount: 1,
      skippedUnownedCount: 1,
      clampedCount: 3,
    });
  });

  it('sums buckets across multiple files in a batch', () => {
    const a = response({
      cards: [{}] as never,
      scryfallHits: 1,
      unresolvedNames: ['Foo'],
      clampedRows: 1,
    });
    const b = response({
      cards: [{}, {}] as never,
      scryfallHits: 2,
      fetchErrors: [{ name: 'Bar' }, { name: 'Baz' }],
      malformedRows: ['x'],
      skippedUnownedRows: 2,
    });
    expect(mergeImportResults([a, b])).toEqual({
      cardsImported: 3,
      scryfallHits: 3,
      unresolvedCount: 1,
      fetchErrorCount: 2,
      malformedCount: 1,
      skippedUnownedCount: 2,
      clampedCount: 1,
    });
  });
});

describe('removeUnresolvedName', () => {
  it('removes the exact-match name', () => {
    expect(removeUnresolvedName(['Sol Rign', 'Islnad'], 'Sol Rign')).toEqual(['Islnad']);
  });

  it('is a no-op when the name is not present', () => {
    const names = ['Sol Rign', 'Islnad'];
    expect(removeUnresolvedName(names, 'Missing')).toEqual(names);
  });

  it('handles an empty list', () => {
    expect(removeUnresolvedName([], 'Anything')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const names = ['Sol Rign'];
    removeUnresolvedName(names, 'Sol Rign');
    expect(names).toEqual(['Sol Rign']);
  });
});

describe('importReviewHeadline', () => {
  it('reads as needing attention when fetch errors remain', () => {
    expect(importReviewHeadline({ fetchErrorCount: 1, unresolvedCount: 0 })).toBe(
      'Import needs a look'
    );
  });

  it('reads as needing attention when unresolved names remain', () => {
    expect(importReviewHeadline({ fetchErrorCount: 0, unresolvedCount: 2 })).toBe(
      'Import needs a look'
    );
  });

  it('reads as a plain summary when nothing needs action', () => {
    expect(importReviewHeadline({ fetchErrorCount: 0, unresolvedCount: 0 })).toBe('Import summary');
  });
});
