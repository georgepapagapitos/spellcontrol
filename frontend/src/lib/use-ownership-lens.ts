import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { getCurrency } from './currency';
import { loadCard } from './card-thumbs';
import { computeOwnershipLens, type OwnershipLens } from './ownership-lens';
import type { PublicDeckCard } from './shared-types';

export interface UseOwnershipLensResult {
  lens: OwnershipLens | null;
  /** Best-effort sum of every missing card's nonfoil price, in the viewer's
   *  display currency. null until resolved (see `loading`). */
  missingCost: number | null;
  /** Per-name nonfoil price backing `missingCost` — null per-name when
   *  Scryfall has no price for that card. Empty while `loading`. */
  missingCardPrices: Map<string, number | null>;
  loading: boolean;
}

const EMPTY_PRICES: Map<string, number | null> = new Map();

interface ResolvedPricing {
  forLens: OwnershipLens | null;
  cost: number;
  prices: Map<string, number | null>;
}

/**
 * Client-side ownership cross-reference for a public deck page
 * (w1-ownership-lens) — signed-in only, computed entirely from the viewer's
 * own already-hydrated collection/binder stores. The viewer's collection
 * never leaves the device; only the deck's already-public card names are
 * looked up (existing loadCard()/getCardsByNames() path) for pricing.
 *
 * Guest: immediate no-op result — no computation, no price fetch.
 */
export function useOwnershipLens(deckCards: PublicDeckCard[]): UseOwnershipLensResult {
  const authed = useAuth((s) => s.status === 'authed');
  const hydrating = useCollectionStore((s) => s.hydrating);
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);

  // Still hydrating the collection/binders from IndexedDB counts as loading
  // too — computing against an empty just-booted store would flash a false
  // "0% owned" before the real cards arrive.
  const ready = authed && !hydrating;

  const lens = useMemo(
    () => (ready ? computeOwnershipLens(deckCards, cards, binders) : null),
    [ready, deckCards, cards, binders]
  );

  // Price resolution tagged with the lens it was resolved for (mirrors
  // use-enriched-list-entries.ts's resolved/key pattern) — a stale sum from a
  // previous lens is never shown while a new one is in flight.
  const [resolved, setResolved] = useState<ResolvedPricing>({
    forLens: null,
    cost: 0,
    prices: EMPTY_PRICES,
  });

  useEffect(() => {
    if (!lens || lens.missingCardNames.length === 0) return;
    let cancelled = false;
    const priceField = getCurrency() === 'EUR' ? 'eur' : 'usd';
    Promise.allSettled(lens.missingCardNames.map((name) => loadCard(name))).then((results) => {
      if (cancelled) return;
      let sum = 0;
      const prices = new Map<string, number | null>();
      results.forEach((r, i) => {
        const name = lens.missingCardNames[i];
        const raw = r.status === 'fulfilled' ? r.value?.prices?.[priceField] : undefined;
        const n = raw != null ? Number(raw) : NaN;
        if (Number.isNaN(n)) {
          prices.set(name, null);
        } else {
          prices.set(name, n);
          sum += n;
        }
      });
      setResolved({ forLens: lens, cost: sum, prices });
    });
    return () => {
      cancelled = true;
    };
  }, [lens]);

  if (!authed) {
    return { lens: null, missingCost: null, missingCardPrices: EMPTY_PRICES, loading: false };
  }
  if (!lens) {
    return { lens: null, missingCost: null, missingCardPrices: EMPTY_PRICES, loading: true };
  }
  if (lens.missingCardNames.length === 0) {
    return { lens, missingCost: 0, missingCardPrices: EMPTY_PRICES, loading: false };
  }
  const settled = resolved.forLens === lens;
  return {
    lens,
    missingCost: settled ? resolved.cost : null,
    missingCardPrices: settled ? resolved.prices : EMPTY_PRICES,
    loading: !settled,
  };
}
