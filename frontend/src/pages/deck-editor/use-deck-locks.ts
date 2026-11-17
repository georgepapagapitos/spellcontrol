import { useCallback, useMemo } from 'react';
import { lockedNames, withLock } from '@/lib/deck/deck-locks';
import { canRegenerate } from '@/lib/deck/regenerate-prefill';
import { useDecksStore, type Deck } from '@/store/decks';
import { useToastsStore } from '@/store/toasts';

/**
 * The card menu's Lock and Unlock (lib/deck/deck-locks). Undefined for a deck
 * Regenerate can't rebuild, so the menu never offers a lock that does nothing.
 */
export function useDeckLocks(deck: Deck | undefined) {
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const pushToast = useToastsStore((s) => s.push);
  const set = useCallback(
    (name: string, locked: boolean) => {
      if (!deck) return;
      updateDeck(deck.id, { generationContext: withLock(deck, name, locked) });
      pushToast({
        message: locked ? `Regenerate keeps ${name}.` : `Regenerate can replace ${name}.`,
        tone: 'success',
      });
    },
    [deck, updateDeck, pushToast]
  );
  return useMemo(
    () => (deck && canRegenerate(deck) ? { names: lockedNames(deck), set } : undefined),
    [deck, set]
  );
}
