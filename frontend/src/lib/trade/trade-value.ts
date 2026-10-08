import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api/api-base';
import { getPrice } from '@/lib/collection/card-prices';
import { getCurrency } from '@/lib/collection/currency';
import { formatMoney } from '@/lib/collection/format-money';
import type { TradeCard } from './trades-client';

/**
 * Valuing the ASK side of a trade.
 *
 * The give side needs nothing from here: those are the viewer's own copies, so
 * they carry an exact printing and `purchasePrice` is already resolved on them
 * (override- and proxy-aware) by `applyPrices`.
 *
 * The ask side can't work that way. A friend's collection is exposed
 * oracle-level by design — contents yes, value no — so an asked card has a name
 * and an oracleId and nothing else. There is no printing to price. What we can
 * honestly say is the FLOOR: the cheapest printing that exists of that card.
 * That is what `GET /api/cards/named?exact=` answers, from the nightly bulk
 * dump, and it is deliberately cache-only server-side — a miss returns null
 * rather than putting our shared Fly IP back in front of Scryfall's rate
 * limiter ([[project_scryfall_429_hardening]]).
 *
 * So an ask total is always presented as "from X", never as a price. It becomes
 * exact the moment the friend accepts, because their device stamps the real
 * printings onto their side of the offer.
 */

/** Scryfall's price block — every field is a decimal STRING, or null/absent. */
interface ScryfallPrices {
  usd?: string | null;
  usd_foil?: string | null;
  eur?: string | null;
  eur_foil?: string | null;
}

/**
 * `Number(null) === 0`, which reads as free and beats every real price — the
 * exact trap the backend's own cheapest-by-name reducer documents. Absent and
 * unparseable both mean "no price", never zero.
 */
function parsePrice(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function priceInActiveCurrency(prices: ScryfallPrices | undefined): number | null {
  if (!prices) return null;
  return getCurrency() === 'EUR'
    ? (parsePrice(prices.eur) ?? parsePrice(prices.eur_foil))
    : (parsePrice(prices.usd) ?? parsePrice(prices.usd_foil));
}

/**
 * Memo across composer re-renders and across the offer list, keyed by
 * name+currency. Prices move daily at most and a trade is a handful of cards,
 * so a session-lifetime map is the whole cache this needs.
 *
 * `null` is a real, cached answer ("no price known") — distinct from absent,
 * which means not asked yet. Without that distinction an unpriceable card
 * re-fetches on every keystroke in the composer.
 */
const floorCache = new Map<string, number | null>();

/**
 * Cheapest-printing price for a card by exact name, in the active display
 * currency. `null` = genuinely unknown (cache miss, no price, or a failure) and
 * must render as a dash, never as 0.
 */
export async function fetchFloorPrice(name: string): Promise<number | null> {
  const key = `${getCurrency()}:${name.toLowerCase()}`;
  const cached = floorCache.get(key);
  if (cached !== undefined) return cached;

  let price: number | null = null;
  try {
    const res = await fetch(apiUrl(`/api/cards/named?exact=${encodeURIComponent(name)}`));
    if (res.ok) {
      const { card } = (await res.json()) as { card?: { prices?: ScryfallPrices } | null };
      price = priceInActiveCurrency(card?.prices);
    }
  } catch {
    // Network/parse failure is indistinguishable from "no price" to the UI:
    // both render a dash. Never surfaced as an error — an unpriced ask side
    // must not block composing or answering a trade.
  }
  floorCache.set(key, price);
  return price;
}

/** Test seam — the module-level memo would otherwise leak between cases. */
export function __resetFloorCache(): void {
  floorCache.clear();
}

/**
 * Splits a side into what we can price exactly and what we can't.
 *
 * The device-local cache is keyed by printing, so a pinned-down copy is exact —
 * and stays exact after the card has LEFT the collection, which is what lets a
 * settled trade still show what it was worth.
 *
 * ⚠️ But that cache only ever holds printings the viewer has OWNED. The side
 * you are RECEIVING is by definition cards you don't own, so its printings are
 * usually absent — and summing absent entries as 0 rendered "You get $0.00" on
 * a real offer, which reads as "these are worthless" when the truth is "we
 * haven't priced them". Anything unpriced comes back as a name for the caller
 * to resolve to a floor instead.
 *
 * EUR mirrors applyPrices' tri-state: an entry with no `eur` field predates EUR
 * support and counts as unpriced rather than as €0.
 */
export function splitSideValue(cards: TradeCard[]): { exact: number; needFloor: TradeCard[] } {
  const eur = getCurrency() === 'EUR';
  let exact = 0;
  const needFloor: TradeCard[] = [];

  for (const card of cards) {
    if (card.copies.length === 0) {
      needFloor.push(card);
      continue;
    }
    let sum = 0;
    let allPriced = true;
    for (const copy of card.copies) {
      const entry = getPrice(copy.scryfallId, copy.finish);
      const price = entry ? (eur ? entry.eur : entry.usd) : undefined;
      if (price == null) {
        allPriced = false;
        break;
      }
      sum += price;
    }
    if (allPriced) exact += sum;
    else needFloor.push(card);
  }
  return { exact, needFloor };
}

/**
 * Floor prices for a set of card names, resolved together.
 *
 * `pending` is true only until the first pass settles, and a name that resolves
 * to `null` is DONE, not still loading — otherwise a card with no known price
 * leaves the total showing a spinner forever. Keyed on the joined names so
 * adding a card to the basket refetches only what the memo above hasn't seen.
 */
const NO_PRICES: Map<string, number | null> = new Map();

export function useFloorPrices(names: string[]): {
  prices: Map<string, number | null>;
  pending: boolean;
} {
  const key = names.join('|');
  // Resolved state carries the key it was resolved FOR, so `pending` is derived
  // rather than set. Writing setState synchronously in the effect body (the
  // obvious shape) triggers cascading renders and is a lint error here.
  const [resolved, setResolved] = useState<{ key: string; prices: Map<string, number | null> }>({
    key: '',
    prices: NO_PRICES,
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void Promise.all(
      key.split('|').map(async (name) => [name, await fetchFloorPrice(name)] as const)
    ).then((entries) => {
      if (!cancelled) setResolved({ key, prices: new Map(entries) });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const fresh = resolved.key === key;
  return { prices: fresh ? resolved.prices : NO_PRICES, pending: key !== '' && !fresh };
}

export interface SideValue {
  /** Rendered form: exact, "from $x", "from $x +?", or "…" while pending. */
  text: string;
  /** Total in the viewer's currency, or null while pending / partly unknown. */
  amount: number | null;
  /** True when any card was priced from a floor rather than a pinned printing. */
  estimate: boolean;
}

/**
 * The net of the deal, which is the subtraction everyone did in their head
 * from the two side totals. Null while either side is unpriced: a net built
 * on a guess is worse than no net.
 */
export function describeNet(give: SideValue, receive: SideValue): string | null {
  if (give.amount === null || receive.amount === null) return null;
  const diff = receive.amount - give.amount;
  const estimate = give.estimate || receive.estimate;
  if (Math.abs(diff) < 1) return estimate ? 'About even' : 'Even';
  const about = estimate ? 'about ' : '';
  return diff > 0
    ? `You come out ${about}${formatMoney(diff)} ahead`
    : `They come out ${about}${formatMoney(-diff)} ahead`;
}

/**
 * The net, short enough for the tray's one line: `about $31 ahead`, `$4 behind`
 * or `even`. Same omission rule as {@link describeNet}: null while a side is
 * unpriced, because a subtraction with a missing term is a lie.
 */
export function describeNetShort(give: SideValue, receive: SideValue): string | null {
  if (give.amount === null || receive.amount === null) return null;
  const diff = receive.amount - give.amount;
  const about = give.estimate || receive.estimate ? 'about ' : '';
  if (Math.abs(diff) < 1) return about ? 'about even' : 'even';
  return diff > 0 ? `${about}${formatMoney(diff)} ahead` : `${about}${formatMoney(-diff)} behind`;
}
