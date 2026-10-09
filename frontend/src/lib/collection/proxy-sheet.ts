import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import type { EnrichedCard } from '@/types';
import { classifyAllocation } from './allocations';
import { isBasicLandName } from './allocations-core';

/**
 * The proxy sheet's selection (`/decks/:id/proxies`): which of a deck's cards
 * go on paper, one tile per physical copy, and how the tiles fall into pages
 * of nine. Pure, so the page only renders what this returns.
 */

/** A card's printed size, in millimetres: a tile is laid out at exactly this. */
export const CARD_MM = { width: 63, height: 88 } as const;
/** Three by three: 189 × 264 mm fits inside both Letter and A4. */
export const TILES_PER_PAGE = 9;

export type ProxyScope = 'missing' | 'deck';

/** One physical copy the deck wants: a commander or a single deck slot. */
export interface ProxySlot {
  card: ScryfallCard;
  allocatedCopyId: string | null;
}

export interface ProxyOptions {
  scope: ProxyScope;
  skipBasics: boolean;
  includeSideboard: boolean;
}

/** One printed card face. A double-faced card makes two, back after front. */
export interface ProxyTile {
  key: string;
  /** The face's own name, for alt text and the name-only fallback. */
  name: string;
  back: boolean;
  /** Undefined when the frozen card carries no image for this face. */
  imageUrl: string | undefined;
}

const byName = (a: DeckCard, b: DeckCard) => a.card.name.localeCompare(b.card.name);

/**
 * Every copy the deck wants, commanders first, then the mainboard grouped by
 * name so a 4-of prints as four neighbors, then the sideboard when asked.
 * Considering is never part of the deck.
 */
export function proxySlots(
  deck: Pick<
    Deck,
    | 'commander'
    | 'partnerCommander'
    | 'commanderAllocatedCopyId'
    | 'partnerCommanderAllocatedCopyId'
    | 'cards'
    | 'sideboard'
  >,
  includeSideboard: boolean
): ProxySlot[] {
  const slots: ProxySlot[] = [];
  if (deck.commander) {
    slots.push({ card: deck.commander, allocatedCopyId: deck.commanderAllocatedCopyId });
  }
  if (deck.partnerCommander) {
    slots.push({
      card: deck.partnerCommander,
      allocatedCopyId: deck.partnerCommanderAllocatedCopyId,
    });
  }
  const zones = includeSideboard ? [deck.cards, deck.sideboard ?? []] : [deck.cards];
  for (const zone of zones) {
    for (const dc of [...zone].sort(byName)) {
      slots.push({ card: dc.card, allocatedCopyId: dc.allocatedCopyId ?? null });
    }
  }
  return slots;
}

/**
 * The deck view's own "missing" test (DeckDisplay's missing stat and its buy
 * list): a copy is missing unless the slot is bound to a copy the collection
 * still holds.
 */
export function isMissingSlot(
  slot: ProxySlot,
  collectionById: Map<string, EnrichedCard> | undefined
): boolean {
  return classifyAllocation(slot.allocatedCopyId, collectionById) !== 'allocated';
}

/** The cards to print for these options, one entry per copy. */
export function selectProxyCards(
  slots: ProxySlot[],
  options: Pick<ProxyOptions, 'scope' | 'skipBasics'>,
  collectionById: Map<string, EnrichedCard> | undefined
): ScryfallCard[] {
  return slots
    .filter((s) => !options.skipBasics || !isBasicLandName(s.card.name))
    .filter((s) => options.scope === 'deck' || isMissingSlot(s, collectionById))
    .map((s) => s.card);
}

/**
 * The faces a card prints. A card whose art lives per face (transform, modal
 * double-faced) prints both; a split, flip or adventure card is one image on
 * one face, so it prints once. `large` is the biggest size every face carries.
 */
export function cardFaces(card: ScryfallCard): Omit<ProxyTile, 'key'>[] {
  if (!card.image_uris && card.card_faces && card.card_faces.length > 1) {
    return card.card_faces.map((face, i) => ({
      name: face.name,
      back: i > 0,
      imageUrl: face.image_uris?.large,
    }));
  }
  return [
    {
      name: card.name,
      back: false,
      imageUrl: card.image_uris?.large ?? card.card_faces?.[0]?.image_uris?.large,
    },
  ];
}

/** Every face of every card, in print order, each with a stable key. */
export function buildProxyTiles(cards: ScryfallCard[]): ProxyTile[] {
  return cards.flatMap((card, i) =>
    cardFaces(card).map((face, f) => ({ ...face, key: `${i}:${f}` }))
  );
}

/** Split tiles into printed pages of nine. */
export function chunkPages<T>(items: T[], size: number = TILES_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** A retry needs a URL the browser hasn't already failed on. */
export function retryUrl(url: string, attempt: number): string {
  if (attempt === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
}
