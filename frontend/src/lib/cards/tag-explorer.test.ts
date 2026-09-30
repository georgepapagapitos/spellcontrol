import { describe, expect, it } from 'vitest';
import { parseTagParam, searchTags, tagsToQuery } from './tag-explorer';
import type { TagCount } from './card-tags';

// Pinned fixture — the real corpus (public/otag-index.json) is a regenerated
// asset no test may read. Count-sorted, as listCardTagsRanked() returns it.
const CORPUS: TagCount[] = [
  { slug: 'removal', count: 6258 },
  { slug: 'ramp', count: 2100 },
  { slug: 'mana-rock', count: 369 },
  { slug: 'sweeper', count: 300 },
  { slug: 'sweeper-one-sided', count: 90 },
  { slug: 'rock-tribal', count: 12 },
];

describe('searchTags', () => {
  it('returns the corpus in its given (count) order when the query is empty', () => {
    expect(searchTags(CORPUS, '  ', 3).map((t) => t.slug)).toEqual([
      'removal',
      'ramp',
      'mana-rock',
    ]);
  });

  it('ranks exact, then prefix, then word-start, then substring', () => {
    // 'rock-tribal' is the prefix match; 'mana-rock' matches at a word break;
    // count order (mana-rock is bigger) must not outrank the tier.
    expect(searchTags(CORPUS, 'rock', 10).map((t) => t.slug)).toEqual(['rock-tribal', 'mana-rock']);
  });

  it('keeps count order within a tier', () => {
    expect(searchTags(CORPUS, 'sweeper', 10).map((t) => t.slug)).toEqual([
      'sweeper',
      'sweeper-one-sided',
    ]);
  });

  it('accepts spaces for the corpus’ hyphens', () => {
    expect(searchTags(CORPUS, 'Mana Rock', 10).map((t) => t.slug)).toEqual(['mana-rock']);
  });

  it('caps the result at the limit', () => {
    expect(searchTags(CORPUS, '', 2)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchTags(CORPUS, 'zzz', 10)).toEqual([]);
  });
});

describe('tagsToQuery', () => {
  it('intersects the selection so each added tag narrows', () => {
    expect(tagsToQuery(['sweeper', 'mana-rock'])).toBe('otag:sweeper otag:mana-rock');
  });

  it('is empty for an empty selection', () => {
    expect(tagsToQuery([])).toBe('');
  });
});

describe('parseTagParam', () => {
  it('reads a comma-separated list', () => {
    expect(parseTagParam('sweeper,mana-rock')).toEqual(['sweeper', 'mana-rock']);
  });

  it('dedupes and normalizes spacing/case', () => {
    expect(parseTagParam('Sweeper, mana rock ,sweeper')).toEqual(['sweeper', 'mana-rock']);
  });

  it('drops junk rather than passing it into a Scryfall query', () => {
    expect(parseTagParam('sweeper,otag:evil OR t:land,')).toEqual(['sweeper']);
  });

  it('is empty for a missing param', () => {
    expect(parseTagParam(null)).toEqual([]);
  });
});
