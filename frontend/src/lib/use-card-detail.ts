import { useEffect, useState } from 'react';
import { getPrintingResilient } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Resolves the full Scryfall card for the printing on screen so the preview
 * panel can show fields the lightweight `EnrichedCard` doesn't carry: flavor
 * text, power/toughness/loyalty, per-face breakdown, and authoritative
 * legalities.
 *
 * Flavor text is per printing, so this asks for the exact `scryfallId` first
 * and only falls back to the name (offline, no id, or an id Scryfall no longer
 * knows), which yields a representative printing via the same offline-first
 * resolver the carousel uses to stream art. Returns `null` until the card
 * resolves (or if it can't be resolved); callers fall back to the
 * `EnrichedCard` fields they already have.
 */
export function useCardDetail(name: string | undefined, scryfallId?: string): ScryfallCard | null {
  const [detail, setDetail] = useState<ScryfallCard | null>(null);
  // Clear stale detail the instant the card changes, adjusted during render
  // (not in the effect) so the panel never flashes the previous card's
  // flavor/P-T. Keyed on the printing too: two printings of one name sit side
  // by side in a collection and carry different flavor.
  const key = `${scryfallId ?? ''}|${name ?? ''}`;
  const [trackedKey, setTrackedKey] = useState(key);
  if (trackedKey !== key) {
    setTrackedKey(key);
    setDetail(null);
  }

  useEffect(() => {
    if (!name) return;
    let alive = true;
    // Debounced so a fast swipe through the carousel doesn't fire a resolve per
    // slide it flicks past; only the card the user settles on fetches. Oracle
    // text already shows instantly from the EnrichedCard, so this delay is
    // invisible; it only gates the flavor/P-T/legalities enrichment.
    const timer = window.setTimeout(() => {
      getPrintingResilient(scryfallId, name)
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
  }, [name, scryfallId]);

  return detail;
}
