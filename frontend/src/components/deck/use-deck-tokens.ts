import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { aggregateDeckTokens, type DeckToken } from '@/lib/deck-tokens';

/**
 * Resolve a deck's token-prep checklist for the Stats tab.
 *
 * Deck cards are persisted in a slimmed shape that drops Scryfall's `all_parts`,
 * so the in-hand card objects usually carry no token data. We re-resolve the
 * deck's card names through the card client — cheap and cached, and the resolved
 * cards carry the token source for whichever platform we're on: live web cards
 * carry `all_parts`, offline (native) cards carry the pre-distilled `tokens`.
 *
 * If the in-hand cards already carry token data (e.g. a freshly generated deck
 * still holding full payloads), we use it immediately and skip the round-trip.
 */
export function useDeckTokens(cards: ScryfallCard[]): DeckToken[] {
  const names = useMemo(
    () => [...new Set(cards.map((c) => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [cards]
  );
  const key = names.join('|');

  // Token data already on the in-hand cards, if any (no network needed).
  const immediate = useMemo(() => aggregateDeckTokens(cards), [cards]);

  // Async-resolved tokens, tagged with the name-set key they were resolved for
  // so a stale resolution from a previous deck is never shown.
  const [resolved, setResolved] = useState<{ key: string; tokens: DeckToken[] }>({
    key: '',
    tokens: [],
  });

  useEffect(() => {
    // Fast path: the in-hand cards already carry token data, or nothing to do.
    if (immediate.length > 0 || names.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const resolvedCards = await getCardsByNames(names);
        if (cancelled) return;
        const list: ScryfallCard[] = [];
        for (const name of names) {
          const card = resolvedCards.get(name);
          if (card) list.push(card);
        }
        setResolved({ key, tokens: aggregateDeckTokens(list) });
      } catch {
        // Network/offline miss — leave the panel empty rather than erroring.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, immediate, names]);

  if (immediate.length > 0) return immediate;
  return resolved.key === key ? resolved.tokens : [];
}
