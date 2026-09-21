import { describe, it, expect } from 'vitest';

import {
  cardTagsOf,
  isTagsEdited,
  normalizeTagText,
  withTagAdded,
  withTagRemoved,
  collectDeckTags,
} from './deck-tags';
import type { DeckCard, Deck } from '../store/decks';

describe('cardTagsOf / isTagsEdited', () => {
  it('treats undefined as untouched, distinct from an explicit empty array', () => {
    const untouched: Pick<DeckCard, 'tags'> = {};
    const cleared: Pick<DeckCard, 'tags'> = { tags: [] };
    expect(cardTagsOf(untouched)).toEqual([]);
    expect(cardTagsOf(cleared)).toEqual([]);
    expect(isTagsEdited(untouched)).toBe(false);
    expect(isTagsEdited(cleared)).toBe(true);
  });

  it('reads real tags through', () => {
    expect(cardTagsOf({ tags: ['Ramp', 'Wincon'] })).toEqual(['Ramp', 'Wincon']);
  });
});

describe('normalizeTagText', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTagText('  Combo   Piece  ')).toBe('Combo Piece');
  });

  it('returns null for blank input', () => {
    expect(normalizeTagText('   ')).toBeNull();
  });

  it('caps length at 40 chars', () => {
    const long = 'x'.repeat(60);
    expect(normalizeTagText(long)).toHaveLength(40);
  });
});

describe('withTagAdded / withTagRemoved', () => {
  it('adds a normalized tag to an untouched (undefined) slot', () => {
    expect(withTagAdded(undefined, ' Ramp ')).toEqual(['Ramp']);
  });

  it('dedupes case-insensitively, keeping the first casing', () => {
    expect(withTagAdded(['Ramp'], 'ramp')).toEqual(['Ramp']);
  });

  it('ignores a blank add', () => {
    expect(withTagAdded(['Ramp'], '   ')).toEqual(['Ramp']);
  });

  it('removes case-insensitively', () => {
    expect(withTagRemoved(['Ramp', 'Wincon'], 'ramp')).toEqual(['Wincon']);
  });

  it('removing the last tag yields [], not undefined', () => {
    const result = withTagRemoved(['Ramp'], 'Ramp');
    expect(result).toEqual([]);
    expect(result).not.toBeUndefined();
  });
});

describe('collectDeckTags', () => {
  function slot(name: string, tags?: string[]): DeckCard {
    return { slotId: name, card: { name } as never, allocatedCopyId: null, tags };
  }

  it('counts distinct tags across all three zones, sorted', () => {
    const deck: Pick<Deck, 'cards' | 'sideboard' | 'considering'> = {
      cards: [slot('a', ['Ramp', 'Wincon']), slot('b', ['Ramp'])],
      sideboard: [slot('c', ['Wincon'])],
      considering: [slot('d', ['Combo Piece'])],
    };
    expect(collectDeckTags(deck)).toEqual([
      { tag: 'Combo Piece', count: 1 },
      { tag: 'Ramp', count: 2 },
      { tag: 'Wincon', count: 2 },
    ]);
  });

  it('is empty for a deck with no tags anywhere, including legacy decks with no considering field', () => {
    const deck = { cards: [slot('a')], sideboard: [], considering: undefined } as unknown as Pick<
      Deck,
      'cards' | 'sideboard' | 'considering'
    >;
    expect(collectDeckTags(deck)).toEqual([]);
  });
});
