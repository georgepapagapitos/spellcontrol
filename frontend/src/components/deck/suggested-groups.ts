// "Suggest groups": files a deck's untouched mainboard slots into the
// generator's 8-bucket categories, shown under the Tags lens. A generated deck
// carries the category it was built under (`DeckCard.category`); a hand-built
// one derives the same bucket from the card with `classifyCardCategory`
// (display-only, which is what this is). Filing writes `DeckCard.stack`, never
// `tags`, so no slot becomes user-edited.
import type { DeckCard } from '@/store/decks';
import { classifyCardCategory } from '@/deck-builder/services/deckBuilder/categorize';
import { CATEGORY_TITLES } from './deck-display-rows';

export interface SuggestedGroupsPlan {
  assignments: Array<{ slotId: string; stack: string }>;
  /** Some untouched slot can't be bucketed until the tagger's roles load, so
   *  the count is not final yet. */
  pending: boolean;
}

/** A slot is untouched when the user never tagged it and it isn't filed. */
const isUntouched = (dc: DeckCard) => dc.tags === undefined && dc.stack === undefined;

export function planSuggestedGroups(cards: DeckCard[], taggerReady: boolean): SuggestedGroupsPlan {
  const assignments: SuggestedGroupsPlan['assignments'] = [];
  let pending = false;
  for (const dc of cards) {
    if (!isUntouched(dc)) continue;
    if (dc.category === undefined && !taggerReady) {
      pending = true;
      continue;
    }
    assignments.push({
      slotId: dc.slotId,
      stack: CATEGORY_TITLES[dc.category ?? classifyCardCategory(dc.card)],
    });
  }
  return { assignments, pending };
}
