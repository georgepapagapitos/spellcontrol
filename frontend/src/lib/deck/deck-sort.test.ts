import { describe, it, expect } from 'vitest';
import { deckCardTotal, deckSortValue, sortDecks } from './deck-sort';
import type { Deck } from '@/store/decks';

const deck = (id: string, over: Partial<Deck> = {}): Deck =>
  ({
    id,
    name: id,
    commander: null,
    partnerCommander: null,
    cards: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as Deck;

const named = (name: string) => ({ name }) as Deck['commander'];

describe('deck-sort', () => {
  it('counts commanders with the main deck', () => {
    const d = deck('a', {
      commander: named('Tymna'),
      partnerCommander: named('Thrasios'),
      cards: [{}, {}] as Deck['cards'],
    });
    expect(deckCardTotal(d)).toBe(4);
  });

  it('reads each field', () => {
    const d = deck('Zed', { commander: named('Krenko'), createdAt: 5, updatedAt: 9 });
    expect(deckSortValue(d, 'edited')).toBe(9);
    expect(deckSortValue(d, 'created')).toBe(5);
    expect(deckSortValue(d, 'name')).toBe('zed');
    expect(deckSortValue(d, 'commander')).toBe('krenko');
    expect(deckSortValue(d, 'cards')).toBe(1);
    expect(deckSortValue(d, 'value', new Map([['Zed', 12]]))).toBe(12);
    expect(deckSortValue(d, 'value')).toBe(0);
  });

  it('sorts both ways without touching the input', () => {
    const input = [deck('b'), deck('c'), deck('a')];
    expect(sortDecks(input, 'name', 'asc').map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(sortDecks(input, 'name', 'desc').map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(input.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });
});
