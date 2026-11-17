import type { Deck } from '@/store/decks';

/**
 * Locked cards: the ones a Regenerate has to keep. A lock is stored as one of
 * the saved build's must-includes (`generationContext.customization`), which
 * Regenerate already replays, so the generator page shows a locked card in its
 * Must include list and nothing new has to carry it.
 */
type LockSource = Pick<Deck, 'generationContext'>;
type LockedDeck = LockSource & { cards: ReadonlyArray<{ card: { name: string } }> };

const BASIC = /\bBasic\b/;

/** A basic land is never locked: the land phase sets how many a deck runs. */
export function canLock(card: { type_line?: string }): boolean {
  return !BASIC.test(card.type_line ?? '');
}

/** Locked cards still in the main deck. One moved to the sideboard or cut is
 *  out of the list, and Regenerate's "Keep my edits" already treats it as cut. */
export function lockedNames(deck: LockedDeck): ReadonlySet<string> {
  const inDeck = new Set(deck.cards.map((c) => c.card.name));
  return new Set(
    (deck.generationContext?.customization?.mustIncludeCards ?? []).filter((n) => inDeck.has(n))
  );
}

/** The deck's generation context with `name` locked or unlocked, or null for a
 *  deck no generator built (there is nothing to regenerate). */
export function withLock(
  deck: LockSource,
  name: string,
  locked: boolean
): Deck['generationContext'] {
  const gc = deck.generationContext;
  if (!gc) return null;
  const rest = (gc.customization?.mustIncludeCards ?? []).filter((n) => n !== name);
  return {
    ...gc,
    customization: { ...gc.customization, mustIncludeCards: locked ? [...rest, name] : rest },
  };
}
