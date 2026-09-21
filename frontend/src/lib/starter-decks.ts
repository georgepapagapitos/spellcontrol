import { searchProducts } from './api';
import type { ProductSummary } from '../types';

/**
 * Starter decks: a deck you can play without owning one.
 *
 * A new account's first look at a board had nothing to put on it — every door
 * onto one took a deck that already existed (yours in the store, a published
 * one behind a share link, or a list you pasted). The catalog of real
 * preconstructed Commander decks the product search already carries (T17) is
 * that missing deck: recognisable, legal, and nobody has to build it.
 *
 * Nothing about a starter is written down. Its id is namespaced
 * `starter:<fileName>` so it can never collide with a saved deck's deck-id-keyed
 * local state, it claims no `allocatedCopyId` (a deck you don't own owns
 * nothing), and it is resolved on the way to the board through the same
 * `/api/products/:fileName` endpoint the Add-a-product flow uses — so the
 * cards are never committed to a snapshot that could rot.
 */

/** The MTGJSON product type whose products are playable Commander decks. */
export const STARTER_PRODUCT_TYPE = 'Commander Deck';

const STARTER_PREFIX = 'starter:';

/**
 * Namespaced like `pastedDeckLocalId` / `publicDeckLocalId`, so a starter's
 * board state stays separate from every saved deck's. Two players at the same
 * table on the same starter share nothing but the name.
 */
export function starterDeckLocalId(fileName: string): string {
  return `${STARTER_PREFIX}${fileName}`;
}

export function isStarterDeckId(deckId: string): boolean {
  return deckId.startsWith(STARTER_PREFIX);
}

/** The product file name inside a starter deck id, or null for any other id. */
export function starterFileName(deckId: string): string | null {
  return isStarterDeckId(deckId) ? deckId.slice(STARTER_PREFIX.length) : null;
}

/**
 * Where a seat's deck id opens its board. A starter is not in the decks store,
 * so `/decks/:id/playtest` would resolve nothing — it has its own route, which
 * resolves the product first. Every seat-to-board door goes through here so a
 * starter can't reach a URL that renders an empty deck.
 */
export function deckBoardPath(deckId: string): string {
  const fileName = starterFileName(deckId);
  return fileName
    ? `/decks/starters/${encodeURIComponent(fileName)}/playtest`
    : `/decks/${deckId}/playtest`;
}

/**
 * The starter catalog, newest first. An empty query lists the most recent
 * precons so the tab is browsable, not just searchable — the same contract
 * the product search's own empty query has.
 */
export function searchStarterDecks(query: string): Promise<ProductSummary[]> {
  return searchProducts(query, STARTER_PRODUCT_TYPE);
}
