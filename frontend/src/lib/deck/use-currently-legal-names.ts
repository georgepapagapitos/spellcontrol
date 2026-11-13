import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';

type StoredCard = { card: Pick<ScryfallCard, 'name' | 'legalities'> };
type Legalities = Record<string, string>;

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
  cards: ReadonlyArray<StoredCard>,
  legalityKey: string
): string[] {
  const names = new Set<string>();
  for (const { card } of cards) {
    if (card.legalities?.[legalityKey] === 'not_legal') names.add(card.name);
  }
  return [...names].sort();
}

/** Of `names`, the ones the current legalities call legal in the format. */
export function legalNow(
  current: ReadonlyMap<string, Legalities>,
  names: Iterable<string>,
  legalityKey: string
): Set<string> {
  const legal = new Set<string>();
  for (const name of names) {
    const status = current.get(name)?.[legalityKey];
    if (status === 'legal' || status === 'restricted') legal.add(name);
  }
  return legal;
}

/**
 * Each name's current legalities, or null until the answer is in. Read from
 * the server's card lookup (the nightly Scryfall dump), never this device's
 * card cache: that keeps a card for 7 days, so a device that built the deck in
 * preview week would hand back the same stale copy. No names, no request.
 *
 * Imported lazily, like `useBanList`: several suites mock the Scryfall client
 * partially.
 */
export function useCurrentLegalities(
  names: readonly string[]
): ReadonlyMap<string, Legalities> | null {
  // A string key, so a re-render with an equal list doesn't refetch.
  const key = [...new Set(names)].sort().join('\n');
  const [loaded, setLoaded] = useState<{
    key: string;
    legalities: ReadonlyMap<string, Legalities>;
  } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    import('@/deck-builder/services/scryfall/client')
      .then((m) => m.getCurrentCardsByName(key.split('\n')))
      .then((byName) => {
        const legalities = new Map<string, Legalities>();
        for (const [name, card] of byName) {
          if (card.legalities) legalities.set(name, card.legalities);
        }
        if (live) setLoaded({ key, legalities });
      })
      .catch(() => {
        /* no answer: the stored legalities still apply */
      });
    return () => {
      live = false;
    };
  }, [key]);
  return loaded?.key === key ? loaded.legalities : null;
}

/**
 * Of the cards stored as not legal in the format, the ones the current card
 * data calls legal, or null until that answer is in.
 */
export function useCurrentlyLegalNames(
  cards: ReadonlyArray<StoredCard>,
  legalityKey: string
): ReadonlySet<string> | null {
  // Keyed by the joined names: callers pass a fresh array each render, and a
  // new Set each render would re-run their legality memo for nothing.
  const joined = storedNotLegalNames(cards, legalityKey).join('\n');
  const names = useMemo(() => (joined ? joined.split('\n') : []), [joined]);
  const current = useCurrentLegalities(names);
  return useMemo(
    () => (current ? legalNow(current, names, legalityKey) : null),
    [current, names, legalityKey]
  );
}
