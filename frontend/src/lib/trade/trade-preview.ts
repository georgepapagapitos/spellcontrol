import { getCardById } from '@/lib/api';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';
import { logger } from '@/lib/util/logger';
import type { EnrichedCard, Finish } from '@/types/index';
import type { TradeCard } from './trades-client';

/**
 * Turning an offer's cards into something the card-preview carousel can show.
 *
 * The carousel is the app's single card-inspect surface in every other context
 * (see the card-preview ruling); trades were the one place a card rendered as
 * an un-openable chip. The obstacle was only shape: an offer carries
 * `TradeCard` (oracle-level name + the printings that changed hands), while
 * `CardPreview` consumes `EnrichedCard`.
 *
 * Resolution prefers the EXACT printing when the side has one. A proposer's
 * own side is pinned from the moment it is sent, and settling stamps the
 * other, so most of the time the carousel can show the very card crossing the
 * table rather than whatever printing Scryfall considers default. An
 * unresolved ask side has no printing yet by design, so it falls back to a
 * by-name lookup — the same batched, CDN-backed path the chip's own thumbnail
 * already used, which means the lookup is normally a cache hit by the time
 * anyone taps.
 */

const VALID_FINISHES: readonly string[] = ['nonfoil', 'foil', 'etched'];

function asFinish(raw: string | undefined): Finish {
  return (raw && VALID_FINISHES.includes(raw) ? raw : 'nonfoil') as Finish;
}

/**
 * Resolves every card in an offer, in order, to an `EnrichedCard`.
 *
 * Cards that cannot be resolved are DROPPED rather than faked: a carousel slot
 * with no art and no oracle text is worse than one fewer slot. The caller maps
 * a clicked chip to its slide via the returned `indexOf`, which accounts for
 * anything dropped — a naive positional index would silently open the wrong
 * card once a single lookup failed.
 */
export async function resolveTradePreview(cards: TradeCard[]): Promise<{
  cards: EnrichedCard[];
  indexOf: (card: TradeCard) => number;
  /** A note for each slide whose art is NOT the printing in the deal: an
   *  oracle-level "any printing" line, or a pinned one whose printing failed to
   *  load and fell back to the card by name. Those two say different things:
   *  the second ask still names one printing, so it must not read "Any printing". */
  slideNotes: Map<number, string>;
}> {
  // One batched by-name call for EVERY card, pinned or not. The unpinned side
  // needs it outright; the pinned side needs it as a fallback, because a
  // printing id can stop resolving (an old offer whose printing Scryfall later
  // merged away, a cold cache) and losing that card from the carousel is worse
  // than showing a different printing of it — the slide the viewer tapped would
  // otherwise be someone else's card. Normally a cache hit anyway: the chips
  // already resolved these same names for their thumbnails.
  const byName = await getCardsByNames(cards.map((c) => c.name)).catch((err) => {
    logger.warn('[trades] Could not resolve card names for preview:', err);
    return new Map<string, never>();
  });

  const resolved: EnrichedCard[] = [];
  // Keyed by the same identity the chips render with, so `indexOf` never has
  // to care what got dropped.
  const slideByKey = new Map<string, number>();
  const slideNotes = new Map<number, string>();

  for (const card of cards) {
    const pinned = card.copies[0];
    let scryfall = null;
    let pinnedFound = false;
    if (pinned?.scryfallId) {
      try {
        scryfall = await getCardById(pinned.scryfallId);
        pinnedFound = scryfall !== null;
      } catch (err) {
        logger.warn('[trades] Could not resolve a traded printing for preview:', err);
      }
    }
    // Fall back to the card by name — a different printing of the right card
    // beats no card at all.
    scryfall ??= byName.get(card.name) ?? null;
    if (!scryfall) continue;
    slideByKey.set(keyOf(card), resolved.length);
    if (!pinned) slideNotes.set(resolved.length, ANY_PRINTING_NOTE);
    else if (!pinnedFound) slideNotes.set(resolved.length, FALLBACK_PRINTING_NOTE);
    resolved.push(scryfallToEnrichedCard(scryfall, asFinish(pinned?.finish)));
  }

  return {
    cards: resolved,
    indexOf: (card) => slideByKey.get(keyOf(card)) ?? -1,
    slideNotes,
  };
}

export const ANY_PRINTING_NOTE = 'Any printing. This one is an example.';
export const FALLBACK_PRINTING_NOTE =
  "Couldn't load the printing in this trade. This is another printing of the card.";

/** Matches TradeOfferSide's own `key` — oracle id, or the name for legacy rows —
 *  plus the printing when the line names one, so two printings of a card in one
 *  deal are two slides. */
function keyOf(card: TradeCard): string {
  const pin = card.copies[0];
  return `${card.oracleId || card.name}${pin ? `|${pin.scryfallId}|${pin.finish}` : ''}`;
}
