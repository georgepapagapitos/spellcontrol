import { useEffect, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * A deck stores each card as the cache had it when the card was added. A card
 * added while it was a preview stores `not_legal` in every format, and keeps it
 * after release: a Star Trek Commander (TRC) deck built the week before
 * 2026-11-13 flagged 13 cards as not legal in Commander on release day.
 *
 * Names whose stored copy reads `not_legal` in the format. Only these get a
 * fresh look, so a deck with nothing flagged makes no request. A stored
 * `banned` is left alone: the live ban list owns bans.
 */
export function storedNotLegalNames(
  cards: ReadonlyArray<{ card: Pick<ScryfallCard, 'name' | 'legalities'> }>,
  legalityKey: string
): string[] {
  const names = new Set<string>();
  for (const { card } of cards) {
    if (card.legalities?.[legalityKey] === 'not_legal') names.add(card.name);
  }
  return [...names].sort();
}

/**
 * Of the cards stored as not legal, the ones the current card data calls legal
 * in the format, or null until that answer is in. Read from the server's card
 * lookup (the nightly Scryfall dump), never this device's card cache: that
 * keeps a card for 7 days, so a device that built the deck in preview week
 * would hand back the same stale copy.
 *
 * Imported lazily, like `useBanList`: several suites mock the Scryfall client
 * partially.
 */
export function useCurrentlyLegalNames(
  cards: ReadonlyArray<{ card: Pick<ScryfallCard, 'name' | 'legalities'> }>,
  legalityKey: string
): ReadonlySet<string> | null {
  // A string key, so a re-render with an equal list doesn't refetch.
  const key = storedNotLegalNames(cards, legalityKey).join('\n');
  const [loaded, setLoaded] = useState<{ key: string; names: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const names = key.split('\n');
    import('@/deck-builder/services/scryfall/client')
      .then((m) => m.getCurrentCardsByName(names))
      .then((byName) => {
        const legal = new Set<string>();
        for (const name of names) {
          const status = byName.get(name)?.legalities?.[legalityKey];
          if (status === 'legal' || status === 'restricted') legal.add(name);
        }
        if (live) setLoaded({ key: `${legalityKey}|${key}`, names: legal });
      })
      .catch(() => {
        /* no answer: the stored legalities still apply */
      });
    return () => {
      live = false;
    };
  }, [key, legalityKey]);
  return loaded?.key === `${legalityKey}|${key}` ? loaded.names : null;
}
