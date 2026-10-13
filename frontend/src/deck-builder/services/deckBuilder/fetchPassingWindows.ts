import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames, upgradeCardPrintings } from '@/deck-builder/services/scryfall/client';

/** Most windows one call walks: bounds the Scryfall round trips on a deep list. */
const MAX_WINDOWS = 10;

/**
 * Fetch ranked candidate names a window at a time until `need` of the fetched
 * cards clear `passes`, or the names run out. A caller that cut the ranked list
 * to its first N names BEFORE the price / rarity / Arena / bracket gates sees a
 * tight cap eat the whole window and reports an empty pool while hundreds of
 * eligible cards sit past the cut. Gate first, then cut: the window grows until
 * enough survive. Returns every card fetched (passing or not); the caller's own
 * gates still decide the seats.
 */
export async function fetchPassingWindows(
  names: readonly string[],
  need: number,
  windowSize: number,
  fetchWindow: (names: string[]) => Promise<Map<string, ScryfallCard>>,
  passes: (card: ScryfallCard) => boolean
): Promise<Map<string, ScryfallCard>> {
  const size = Math.max(1, windowSize);
  const all = new Map<string, ScryfallCard>();
  let passing = 0;
  for (let i = 0, w = 0; i < names.length && w < MAX_WINDOWS; i += size, w++) {
    const fetched = await fetchWindow(names.slice(i, i + size));
    for (const [name, card] of fetched) {
      all.set(name, card);
      if (passes(card)) passing++;
    }
    if (passing >= need) break;
  }
  return all;
}

/** The window fetch both callers share: names to cards, held to the preferred set and the user's query. */
export const windowFetcher =
  (preferredSet: string | undefined, arenaOnly: boolean, scryfallQuery: string) =>
  async (names: string[]): Promise<Map<string, ScryfallCard>> => {
    const fetched = await getCardsByNames(names, undefined, preferredSet, { arenaOnly });
    if (preferredSet) {
      for (const [name, card] of fetched) {
        if (card.set !== preferredSet) fetched.delete(name);
      }
    }
    await upgradeCardPrintings(fetched, scryfallQuery, true);
    return fetched;
  };
