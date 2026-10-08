import { useEffect, useMemo, useState } from 'react';
import { getCardsByNames, getCardPrice } from '@/deck-builder/services/scryfall/client';
import { getCurrency } from '@/lib/collection/currency';

/**
 * Market prices for the *missing* piece of each near-miss combo.
 *
 * These can't come from the collection: a combo is "one away" precisely
 * because that card ISN'T owned, so there's no local row carrying a price.
 * They have to be fetched.
 *
 * `getCardsByNames` batches internally, but the one-away list can still run to
 * a couple hundred rows, so this caps what it asks for.
 *
 * Hard cap at MAX_PRICED names, no virtualization-aware windowing.
 * Rows past the cap simply render without a price, which is the same as an
 * unpriced card and reads fine. Upgrade path if the list gets long enough to
 * matter: virtualize the list and price only the visible window.
 */
const MAX_PRICED = 60;

const EMPTY: Map<string, number> = new Map();

export function useMissingCardPrices(names: readonly string[]): Map<string, number> {
  return useCardPriceLookup(names).prices;
}

/**
 * Prices keyed by lowercased name, plus whether this list's lookup has
 * finished, so a caller that treats "no price" as meaningful (the upgrade
 * plan leaves unpriced cards out) can wait instead of reading a miss.
 */
export function useCardPriceLookup(
  names: readonly string[],
  max = MAX_PRICED
): { prices: Map<string, number>; loaded: boolean } {
  // Keyed by the request it belongs to, so switching lists yields nothing
  // rather than briefly showing the previous list's prices — and so the empty
  // and stale cases are DERIVED on the way out instead of needing a
  // synchronous setState inside the effect (which cascades renders).
  const [state, setState] = useState<{ key: string; prices: Map<string, number> }>({
    key: '',
    prices: EMPTY,
  });

  // Stable key so an unstable array identity doesn't refire the fetch.
  const wanted = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
      if (out.length >= max) break;
    }
    return out;
  }, [names, max]);
  const key = wanted.join('|').toLowerCase();

  useEffect(() => {
    if (wanted.length === 0) return;
    let cancelled = false;
    const currency = getCurrency() === 'EUR' ? 'EUR' : 'USD';

    getCardsByNames(wanted)
      .then((cards) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const [name, card] of cards) {
          const raw = getCardPrice(card, currency);
          const value = raw == null ? NaN : Number(raw);
          if (Number.isFinite(value)) next.set(name.toLowerCase(), value);
        }
        setState({ key, prices: next });
      })
      .catch(() => {
        // A price is a nice-to-have on a discovery list — a failed lookup
        // shows no price rather than an error the user can't act on.
        if (!cancelled) setState({ key, prices: EMPTY });
      });

    return () => {
      cancelled = true;
    };
    // `key` is derived from `wanted`'s contents, so it covers both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loaded = wanted.length === 0 || state.key === key;
  return { prices: state.key === key ? state.prices : EMPTY, loaded };
}
