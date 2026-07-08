import { describe, it, expect } from 'vitest';
import { findSlotForCut, deckHasSuggestedAdd, suggestionBlockedReason } from './feedback-apply';
import type { DeckCard } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { FeedbackSuggestion } from './feedback-client';

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'print-1',
    oracle_id: 'oracle-1',
    name: 'Sol Ring',
    ...overrides,
  } as ScryfallCard;
}

function slot(c: ScryfallCard, slotId = `slot-${c.id}`): DeckCard {
  return { slotId, card: c, allocatedCopyId: null } as DeckCard;
}

function cut(overrides: Partial<FeedbackSuggestion> = {}): FeedbackSuggestion {
  return { id: 'sg-1', type: 'cut', cardName: 'Sol Ring', status: 'pending', ...overrides };
}

describe('findSlotForCut', () => {
  const cards = [
    slot(card({ id: 'p1', oracle_id: 'o1', name: 'Sol Ring' })),
    slot(card({ id: 'p2', oracle_id: 'o2', name: 'Arcane Signet' })),
  ];

  it('matches by oracle id first', () => {
    const found = findSlotForCut(cards, cut({ cardName: 'Wrong Name', oracleId: 'o2' }));
    expect(found?.card.name).toBe('Arcane Signet');
  });

  it('falls back to printing id, then case-insensitive name', () => {
    expect(findSlotForCut(cards, cut({ cardName: 'X', scryfallId: 'p1' }))?.card.name).toBe(
      'Sol Ring'
    );
    expect(findSlotForCut(cards, cut({ cardName: 'arcane signet' }))?.card.name).toBe(
      'Arcane Signet'
    );
  });

  it('returns null when nothing matches', () => {
    expect(findSlotForCut(cards, cut({ cardName: 'Mana Crypt', oracleId: 'o9' }))).toBeNull();
  });

  it('a stale oracle id still resolves via name fallback', () => {
    expect(findSlotForCut(cards, cut({ cardName: 'Sol Ring', oracleId: 'gone' }))?.slotId).toBe(
      'slot-p1'
    );
  });
});

describe('deckHasSuggestedAdd', () => {
  const cards = [slot(card({ id: 'p1', oracle_id: 'o1', name: 'Sol Ring' }))];

  it('detects presence by oracle id or name', () => {
    expect(deckHasSuggestedAdd(cards, cut({ type: 'add', cardName: 'X', oracleId: 'o1' }))).toBe(
      true
    );
    expect(deckHasSuggestedAdd(cards, cut({ type: 'add', cardName: 'SOL RING' }))).toBe(true);
    expect(deckHasSuggestedAdd(cards, cut({ type: 'add', cardName: 'Mana Vault' }))).toBe(false);
  });
});

describe('suggestionBlockedReason', () => {
  const cards = [slot(card({ id: 'p1', oracle_id: 'o1', name: 'Sol Ring' }))];

  it('blocks an add already in the deck and an add without card data', () => {
    expect(suggestionBlockedReason(cards, cut({ type: 'add', cardName: 'Sol Ring' }))).toBe(
      'Already in deck'
    );
    expect(suggestionBlockedReason(cards, cut({ type: 'add', cardName: 'Mana Vault' }))).toBe(
      'Card data unavailable'
    );
    expect(
      suggestionBlockedReason(
        cards,
        cut({ type: 'add', cardName: 'Mana Vault', card: card({ name: 'Mana Vault' }) })
      )
    ).toBeNull();
  });

  it('blocks a cut whose card left the deck', () => {
    expect(suggestionBlockedReason(cards, cut({ cardName: 'Mana Crypt' }))).toBe(
      'No longer in deck'
    );
    expect(suggestionBlockedReason(cards, cut({ cardName: 'Sol Ring' }))).toBeNull();
  });
});
