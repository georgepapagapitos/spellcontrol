import { describe, it, expect, vi } from 'vitest';
import type { DeckCategory } from '@/deck-builder/types';

// suggestedTagForCard's own job is just "map classifyCardCategory's output
// to a label (or nothing)" — classifyCardCategory itself is covered by
// categorize.test.ts, so mock it here to test the mapping in isolation.
let mockedCategory: DeckCategory = 'synergy';
vi.mock('@/deck-builder/services/deckBuilder/categorize', () => ({
  classifyCardCategory: () => mockedCategory,
}));

import {
  cardTagsOf,
  isTagsEdited,
  suggestedTagForCard,
  normalizeTagText,
  withTagAdded,
  withTagRemoved,
  collectDeckTags,
} from './deck-tags';
import type { DeckCard, Deck } from '../store/decks';

function sc() {
  return {} as import('@/deck-builder/types').ScryfallCard;
}

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

describe('suggestedTagForCard', () => {
  it('suggests a label for each functional-role category', () => {
    mockedCategory = 'ramp';
    expect(suggestedTagForCard(sc())).toBe('Ramp');
    mockedCategory = 'cardDraw';
    expect(suggestedTagForCard(sc())).toBe('Card advantage');
    mockedCategory = 'singleRemoval';
    expect(suggestedTagForCard(sc())).toBe('Removal');
    mockedCategory = 'boardWipes';
    expect(suggestedTagForCard(sc())).toBe('Board wipe');
  });

  it('suggests nothing for type-obvious or catch-all buckets', () => {
    for (const cat of ['lands', 'creatures', 'synergy', 'utility'] as const) {
      mockedCategory = cat;
      expect(suggestedTagForCard(sc())).toBeNull();
    }
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
