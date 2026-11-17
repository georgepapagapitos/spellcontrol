import type { Deck } from '@/store/decks';

/**
 * Locked cards: the ones a Regenerate has to keep. They live in the saved
 * build settings as `customization.lockedCards`, apart from the must-includes
 * the player typed at build time, so cutting a locked card always releases it
 * and only a card the player locked reads as locked. The generator seats them
 * like a must-include from the deck (deckGenerator's 'deck' source), and a
 * regenerated deck keeps its locks because the settings are saved with it.
 */
type LockSource = Pick<Deck, 'generationContext'>;
type LockedDeck = LockSource & { cards: ReadonlyArray<{ card: { name: string } }> };

const BASIC = /\bBasic\b/;

/** A basic land is never locked: the land phase sets how many a deck runs. */
export function canLock(card: { type_line?: string }): boolean {
  return !BASIC.test(card.type_line ?? '');
}

/** Locked cards still in the main deck. A lock on a card that was cut or
 *  moved to the sideboard is dead: it shows nowhere and carries nowhere. */
export function lockedNames(deck: LockedDeck): ReadonlySet<string> {
  const inDeck = new Set(deck.cards.map((c) => c.card.name));
  return new Set(
    (deck.generationContext?.customization?.lockedCards ?? []).filter((n) => inDeck.has(n))
  );
}

/** The deck's generation context with `name` locked or unlocked, dropping any
 *  dead lock on the way. Null for a deck with no saved build to regenerate. */
export function withLock(
  deck: LockedDeck,
  name: string,
  locked: boolean
): Deck['generationContext'] {
  const gc = deck.generationContext;
  if (!gc) return null;
  const rest = [...lockedNames(deck)].filter((n) => n !== name);
  return {
    ...gc,
    customization: { ...gc.customization, lockedCards: locked ? [...rest, name] : rest },
  };
}
