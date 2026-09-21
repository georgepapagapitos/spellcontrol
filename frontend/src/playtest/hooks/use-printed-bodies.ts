import { useEffect, useMemo, useState } from 'react';
import type { Deck } from '@/store/decks';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { usePlaytestStore } from '@/playtest/store';
import {
  namesMissingBody,
  printedBodiesFrom,
  type PrintedBodies,
} from '@/playtest/lib/printed-bodies';

const NOTHING: PrintedBodies = new Map();

/**
 * Give the board the printed power/toughness its deck data is missing.
 *
 * The P/T box reads `PlaytestCard.power`, which `deckToPlaytestInit` copies
 * off the deck's own stored card. A deck holds each card as the cache had it
 * the day it was added, so every deck assembled before the card cache started
 * keeping `power`/`toughness` holds creatures with no body on them — and the
 * badge, having nothing to render, renders nothing. Re-ingesting the cache
 * fixed the cache; it does not rewrite anyone's stored deck, and this board
 * never reads the cache.
 *
 * So we re-resolve the missing names through the card client — the same cheap,
 * cached round trip `useDeckTokens` makes for the token checklist — and patch
 * the session once the answer lands. The board opens at its normal speed
 * either way: this only ever adds badges a moment later, never delays a card,
 * and a lookup that fails or finds nothing (offline, an unknown name) leaves
 * exactly the behaviour there was before it.
 */
export function usePrintedBodies(deck: Deck): void {
  const applyPrintedBodies = usePlaytestStore((s) => s.applyPrintedBodies);
  // The session this hook is patching. A re-init (fresh game, resume,
  // route-swapped deck) builds new card objects out of the same stale deck, so
  // the patch has to be re-applied to them — it is idempotent, so re-running
  // costs nothing when there is nothing left to fix.
  const storeDeckId = usePlaytestStore((s) => s.deckId);

  const names = useMemo(() => namesMissingBody(deck), [deck]);
  const key = names.join('|');

  // Tagged with the name-set it was resolved for, so a resolution that lands
  // after the page moved to another deck is never applied to that one.
  const [resolved, setResolved] = useState<{ key: string; bodies: PrintedBodies }>({
    key: '',
    bodies: NOTHING,
  });

  useEffect(() => {
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const cards = await getCardsByNames(names);
        if (!cancelled) setResolved({ key, bodies: printedBodiesFrom(cards) });
      } catch {
        // Offline, or the lookup failed: leave the board as it was rather
        // than surfacing an error for a cosmetic detail.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, names]);

  useEffect(() => {
    if (resolved.key !== key || resolved.bodies.size === 0) return;
    applyPrintedBodies(resolved.bodies);
  }, [resolved, key, storeDeckId, applyPrintedBodies]);
}
