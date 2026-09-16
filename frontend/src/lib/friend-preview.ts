import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from './scryfall-to-enriched';
import { logger } from './logger';
import type { EnrichedCard } from '../types';
import type { FriendCard } from './cube/pool';

/**
 * Turning a friend's collection cards into something the card-preview carousel
 * can show.
 *
 * The carousel is the app's single card-inspect surface everywhere else —
 * including the public share views, which open it from the same kind of grid
 * (`SharedCollectionView`). A friend's binder was the one collection you could
 * look at but not open a card in. The obstacle was only shape: the friend
 * endpoint sends card FACTS (`FriendCard` — name, colours, type line, oracle
 * text), while `CardPreview` consumes `EnrichedCard`, a physical copy.
 *
 * There is no printing to prefer here, and that is the point: a friend sees
 * WHAT you own, never which copy or what it's worth (`friends.ts`'s projection
 * carries no printing, finish, condition, quantity or price). So every slide
 * resolves by NAME — the same batched, CDN-backed lookup the tile's own
 * thumbnail already made, which means it is normally a cache hit by the time
 * anyone taps — and lands on whatever printing Scryfall considers default.
 * Callers pass `hidePrice` to `CardPreview` so the resolved printing's market
 * price doesn't reintroduce a value the endpoint deliberately withheld.
 */
export async function resolveFriendPreview(cards: FriendCard[]): Promise<{
  cards: EnrichedCard[];
  indexOf: (card: FriendCard) => number;
}> {
  const byName = await getCardsByNames(cards.map((c) => c.name)).catch((err) => {
    logger.warn('[friends] Could not resolve card names for preview:', err);
    return new Map<string, never>();
  });

  const resolved: EnrichedCard[] = [];
  // Keyed by name — the friend payload's own identity for a card, and what the
  // lookup above is keyed by — so `indexOf` never has to care what got dropped.
  const slideByName = new Map<string, number>();

  for (const card of cards) {
    const scryfall = byName.get(card.name);
    // Dropped rather than faked, as in `resolveTradePreview`: a slide with no
    // art and no oracle text is worse than one fewer slide. The caller maps a
    // tapped tile to its slide through `indexOf`, which accounts for the drop —
    // a positional index would silently open the neighbouring card the moment a
    // single lookup missed.
    if (!scryfall) continue;
    slideByName.set(card.name, resolved.length);
    resolved.push(scryfallToEnrichedCard(scryfall));
  }

  return {
    cards: resolved,
    indexOf: (card) => slideByName.get(card.name) ?? -1,
  };
}
