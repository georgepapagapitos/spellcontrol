import type { ScryfallCard } from '@/deck-builder/types';
import {
  getCardsByNames,
  getFrontFaceTypeLine,
  upgradeCardPrintings,
} from '@/deck-builder/services/scryfall/client';

/** Most windows one call walks: bounds the Scryfall round trips on a deep list. */
const MAX_WINDOWS = 10;

/**
 * Fetch ranked candidate names a window at a time until `need` of the fetched
 * cards clear `passes`, or the names run out. A caller that cut the ranked list
 * to its first N names BEFORE the price / rarity / Arena / bracket gates sees a
 * tight cap eat the whole window and reports an empty pool while hundreds of
 * eligible cards sit past the cut. Gate first, then cut: the window grows until
 * enough survive. Callers that must stay byte-identical when no player cap is set pass
 * `need` 0, which keeps the first window only (the old fetch). Returns every card fetched (passing or not); the caller's own
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

/**
 * Hold the spells in `cards` to the player's Scryfall filter, in place: a spell
 * with no printing that passes it is removed, one that has is seated on that
 * printing. Lands are left alone, since the filter shapes spell picks, not the
 * nonbasic land search (E1004).
 */
export async function holdSpellsToFilter(
  cards: Map<string, ScryfallCard>,
  preferredSet: string | undefined,
  scryfallQuery: string
): Promise<void> {
  const spells = new Map<string, ScryfallCard>();
  for (const [name, card] of cards) {
    if (!getFrontFaceTypeLine(card).includes('Land')) spells.set(name, card);
  }
  if (preferredSet) {
    for (const [name, card] of spells) if (card.set !== preferredSet) spells.delete(name);
  }
  await upgradeCardPrintings(spells, scryfallQuery, true);
  for (const name of [...cards.keys()]) {
    const held = spells.get(name);
    if (held) cards.set(name, held);
    else if (!getFrontFaceTypeLine(cards.get(name)!).includes('Land')) cards.delete(name);
  }
}
