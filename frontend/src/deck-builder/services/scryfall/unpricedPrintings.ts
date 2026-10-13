import type { ScryfallCard, ScryfallSearchResponse } from '@/deck-builder/types';
import { isPlayableCard } from '@/deck-builder/lib/printingLayouts';
import { frontFaceName } from '@/lib/cards/card-text';
import { scryfallRequest } from '@/lib/cards/scryfall-fetch';

const BATCH = 15; // names per search, as the printing upgrade batches them

/** Cheapest paper USD price per name across every printing, for a card whose own printing
 *  has none. null = no printing of the name carries a USD price. */
const otherPrintingPrice = new Map<string, { usd: string; set: string } | null>();

/**
 * A card the player's set or filter left on a printing with no price at all (Secret Lair,
 * promo and list printings often carry none) reads as free: the budget counted it as $0 and
 * a price cap saw "no price" and priced a card the player could buy out of the deck. The
 * player can buy any printing, so price it at the cheapest priced printing of the same name,
 * keep the seated printing for the art, and mark where the price came from (`pricedFromSet`)
 * so the deck can say so. A name with no priced printing anywhere stays unpriced.
 * Mutates `cards` in place; only live Scryfall, one search per 15 unpriced names.
 */
export async function priceUnpricedFromOtherPrintings(
  cards: Map<string, ScryfallCard>,
  getCardPrice: (card: ScryfallCard) => string | null
): Promise<void> {
  const need = new Map<string, string[]>();
  for (const [key, card] of cards) {
    if (getCardPrice(card)) continue;
    const name = frontFaceName(card.name);
    need.set(name, [...(need.get(name) ?? []), key]);
  }
  const todo = [...need.keys()].filter((n) => !otherPrintingPrice.has(n));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const q = `(${batch.map((n) => `!"${n}"`).join(' OR ')}) usd>0`;
    const found = new Map<string, { usd: string; set: string }>();
    try {
      // usd>0 drops the unpriced printings; ascending, so the first per name is the cheapest.
      const res = await scryfallRequest(
        `/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=usd&dir=asc`
      );
      if (res.ok) {
        for (const c of ((await res.json()) as ScryfallSearchResponse).data) {
          if (!isPlayableCard(c) || !c.prices?.usd) continue;
          const name = frontFaceName(c.name);
          if (!found.has(name)) found.set(name, { usd: c.prices.usd, set: c.set });
        }
      } else if (res.status !== 404) {
        continue; // a failed lookup stays unpriced and is retried next call
      }
    } catch {
      continue;
    }
    for (const n of batch) otherPrintingPrice.set(n, found.get(n) ?? null);
  }
  for (const [name, keys] of need) {
    const hit = otherPrintingPrice.get(name);
    if (!hit) continue;
    for (const key of keys) {
      const card = cards.get(key)!;
      cards.set(key, {
        ...card,
        prices: { ...card.prices, usd: hit.usd },
        pricedFromSet: hit.set,
      });
    }
  }
}
