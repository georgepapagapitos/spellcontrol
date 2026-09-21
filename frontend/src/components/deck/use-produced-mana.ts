import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { applyProducedMana, namesMissingProducedMana, producedManaFrom } from '@/lib/produced-mana';

const NOTHING: ReadonlyMap<string, string[]> = new Map();

/**
 * Give the mana analysis the `produced_mana` its deck data is missing.
 *
 * A deck stores each card as the Scryfall cache had it the day the card was
 * added, and the cache only began keeping `produced_mana` in #2011. Every deck
 * built before that has none, so `producedManaColors` falls back to reading
 * oracle text — a fallback that never reads `{C}`. Measured on five live public
 * decks: every mana rock reads as producing nothing, painlands and filters lose
 * their colorless half, and a colorless deck reports **zero** mana sources
 * where it has 49.
 *
 * Re-ingesting the card cache does not fix this, because the analysis reads the
 * deck, never the cache. So we re-resolve the plausible producers through the
 * card client — the same cheap, cached round trip `useDeckTokens` makes — and
 * hand back the cards with production stamped on.
 *
 * Returns the input array unchanged until the answer lands, and unchanged
 * forever if it never does (offline, a failed lookup, a deck whose cards
 * already carry production), so the panel renders at its normal speed and
 * degrades to exactly today's behavior.
 */
export function useProducedMana(cards: ScryfallCard[]): readonly ScryfallCard[] {
  const names = useMemo(() => namesMissingProducedMana(cards), [cards]);
  const key = names.join('|');

  // Tagged with the name-set it was resolved for, so an answer that lands after
  // the page moved to another deck is never applied to that one.
  const [resolved, setResolved] = useState<{
    key: string;
    production: ReadonlyMap<string, string[]>;
  }>({ key: '', production: NOTHING });

  useEffect(() => {
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const cards = await getCardsByNames(names);
        if (!cancelled) setResolved({ key, production: producedManaFrom(cards) });
      } catch {
        // Offline, or the lookup failed. The analysis keeps the oracle-text
        // fallback rather than surfacing an error for a panel that still reads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, names]);

  return useMemo(
    () => (resolved.key === key ? applyProducedMana(cards, resolved.production) : cards),
    [cards, key, resolved]
  );
}
