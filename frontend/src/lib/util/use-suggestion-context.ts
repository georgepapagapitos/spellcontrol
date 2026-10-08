import { useEffect } from 'react';
import { setSuggestionContext } from '@/lib/util/suggestion-labels';
import type { Deck } from '@/store/decks';

/** Tells the suggestion-label emitters which commander the open deck is built around. */
export function useSuggestionContext(deck: Deck | null): void {
  const id = deck?.id;
  const commander = deck?.commander;
  const partner = deck?.partnerCommander;
  useEffect(() => {
    setSuggestionContext(
      id ? { id, commander: commander ?? null, partnerCommander: partner ?? null } : null
    );
    return () => setSuggestionContext(null);
  }, [id, commander, partner]);
}
