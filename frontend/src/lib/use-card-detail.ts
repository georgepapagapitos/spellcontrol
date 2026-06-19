import { useEffect, useState } from 'react';
import { getCardByNameResilient } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Resolves the full Scryfall card for a name so the preview panel can show
 * fields the lightweight `EnrichedCard` doesn't carry — flavor text,
 * power/toughness/loyalty, per-face breakdown, and authoritative legalities.
 *
 * Offline-first via `getCardByNameResilient` (the same resolver the carousel
 * uses to stream art), so this is a cache hit for any card already on screen
 * and degrades to whatever the offline bundle holds. Returns `null` until the
 * card resolves (or if it can't be resolved); callers fall back to the
 * `EnrichedCard` fields they already have.
 *
 * ponytail: resolves by NAME, so flavor text comes from a representative
 * printing rather than this exact one. Oracle text / P/T / legalities are
 * oracle-level (identical across printings), so only flavor is affected —
 * acceptable, and it keeps the offline path working (getCardById is live-only).
 */
export function useCardDetail(name: string | undefined): ScryfallCard | null {
  const [detail, setDetail] = useState<ScryfallCard | null>(null);
  // Clear stale detail the instant the name changes — adjusted during render
  // (not in the effect) so the panel never flashes the previous card's
  // flavor/P-T. Standard "reset state on prop change" pattern.
  const [trackedName, setTrackedName] = useState(name);
  if (trackedName !== name) {
    setTrackedName(name);
    setDetail(null);
  }

  useEffect(() => {
    if (!name) return;
    let alive = true;
    // Debounced so a fast swipe through the carousel doesn't fire a resolve per
    // slide it flicks past — only the card the user settles on fetches. Oracle
    // text already shows instantly from the EnrichedCard, so this delay is
    // invisible; it only gates the flavor/P-T/legalities enrichment.
    const timer = window.setTimeout(() => {
      getCardByNameResilient(name)
        .then((card) => {
          if (alive) setDetail(card);
        })
        .catch(() => {
          if (alive) setDetail(null);
        });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [name]);

  return detail;
}
