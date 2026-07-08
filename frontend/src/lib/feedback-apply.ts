import type { DeckCard } from '../store/decks';
import type { FeedbackSuggestion } from './feedback-client';

/**
 * Pure matching helpers for applying feedback suggestions to a deck.
 * A responder's cut references the card they saw in the shared projection;
 * by the time the owner reviews it the deck may have changed printings or
 * copies, so matching prefers oracle identity, then printing id, then name.
 */

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Find the mainboard slot a cut suggestion refers to, or null if it's gone. */
export function findSlotForCut(cards: DeckCard[], suggestion: FeedbackSuggestion): DeckCard | null {
  if (suggestion.oracleId) {
    const byOracle = cards.find((s) => s.card.oracle_id === suggestion.oracleId);
    if (byOracle) return byOracle;
  }
  if (suggestion.scryfallId) {
    const byPrinting = cards.find((s) => s.card.id === suggestion.scryfallId);
    if (byPrinting) return byPrinting;
  }
  const key = nameKey(suggestion.cardName);
  return cards.find((s) => nameKey(s.card.name) === key) ?? null;
}

/** True when the deck already contains the card an add suggestion proposes. */
export function deckHasSuggestedAdd(cards: DeckCard[], suggestion: FeedbackSuggestion): boolean {
  if (suggestion.oracleId && cards.some((s) => s.card.oracle_id === suggestion.oracleId)) {
    return true;
  }
  const key = nameKey(suggestion.cardName);
  return cards.some((s) => nameKey(s.card.name) === key);
}

/**
 * Whether a pending suggestion can still be applied: an add needs its card
 * payload and must not already be in the deck; a cut needs a matching slot.
 * Returns a disabled-reason string, or null when applicable.
 */
export function suggestionBlockedReason(
  cards: DeckCard[],
  suggestion: FeedbackSuggestion
): string | null {
  if (suggestion.type === 'add') {
    if (deckHasSuggestedAdd(cards, suggestion)) return 'Already in deck';
    if (!suggestion.card) return 'Card data unavailable';
    return null;
  }
  return findSlotForCut(cards, suggestion) ? null : 'No longer in deck';
}
