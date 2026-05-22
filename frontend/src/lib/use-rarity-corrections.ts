import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { offlineDataAvailable, offlineGetCardsByOracleIds } from './offline';

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * Re-resolve stale card rarity for the deck view.
 *
 * Decks generated while the offline oracle dataset was active — before it
 * carried a `rarity` field (PR #329) — have every card's `rarity` baked in as
 * the literal default `'common'`. That stored snapshot never self-heals, so a
 * rare like Beast Whisperer shows "Common" in the card preview carousel.
 *
 * The affected population is exactly the set of users who had offline data
 * downloaded, and the offline oracle now carries rarity — so we re-resolve
 * suspect cards straight from it, no network needed. Only `'common'`-rarity
 * cards are checked: the bug never produced any other value, so a non-common
 * stored rarity is trusted as-is.
 *
 * Returns a map of oracle_id → corrected rarity holding only entries that
 * actually differ from the stored `'common'`. Empty until the async lookup
 * resolves, and empty forever when no offline data is present.
 */
export function useRarityCorrections(cards: ScryfallCard[]): ReadonlyMap<string, string> {
  // Stable signature of the oracle ids worth re-checking. Keying the effect on
  // this string (not the array identity) keeps it from re-running every
  // render — same trick as useDeckCombos.
  const suspectKey = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cards) {
      if (c.oracle_id && c.rarity === 'common') ids.add(c.oracle_id);
    }
    return [...ids].sort().join(',');
  }, [cards]);

  const [corrections, setCorrections] = useState<ReadonlyMap<string, string>>(EMPTY);

  // Render-phase reset when the suspect set changes — keeps a stale correction
  // from leaking across decks without a synchronous setState inside the effect.
  const [trackedKey, setTrackedKey] = useState(suspectKey);
  if (trackedKey !== suspectKey) {
    setTrackedKey(suspectKey);
    setCorrections(EMPTY);
  }

  // Guards against a slow lookup overwriting a fresher one.
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!suspectKey) return;
    const myReqId = ++reqIdRef.current;
    void (async () => {
      if (!(await offlineDataAvailable())) return;
      const resolved = await offlineGetCardsByOracleIds(suspectKey.split(','));
      if (reqIdRef.current !== myReqId) return;
      const next = new Map<string, string>();
      for (const [id, card] of resolved) {
        if (card.rarity && card.rarity !== 'common') next.set(id, card.rarity);
      }
      if (next.size > 0) setCorrections(next);
    })();
  }, [suspectKey]);

  return corrections;
}
