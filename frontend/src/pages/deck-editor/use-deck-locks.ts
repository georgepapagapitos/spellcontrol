import { useCallback, useMemo } from 'react';
import { lockedNames, withLock } from '@/lib/deck/deck-locks';
import { canRegenerate } from '@/lib/deck/regenerate-prefill';
import { useDecksStore, type Deck } from '@/store/decks';
import { useToastsStore } from '@/store/toasts';

/**
 * The card menu's Lock and Unlock (lib/deck/deck-locks). Undefined for a deck
 * Regenerate can't rebuild or one with no saved build to hold the lock, so the
 * menu never offers a lock that does nothing.
 */
export function useDeckLocks(deck: Deck | undefined) {
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const pushToast = useToastsStore((s) => s.push);
  const deckId = deck?.id;
  const set = useCallback(
    (name: string, locked: boolean) => {
      // The store's deck, not this render's: two locks in a row must both land.
      const now = useDecksStore.getState().decks.find((d) => d.id === deckId);
      if (!now?.generationContext) return;
      updateDeck(now.id, { generationContext: withLock(now, name, locked) });
      pushToast({
        message: locked ? `Regenerate keeps ${name}.` : `Regenerate can replace ${name}.`,
        tone: 'success',
      });
    },
    [deckId, updateDeck, pushToast]
  );
  return useMemo(
    () =>
      deck?.generationContext && canRegenerate(deck)
        ? { names: lockedNames(deck), set }
        : undefined,
    [deck, set]
  );
}
