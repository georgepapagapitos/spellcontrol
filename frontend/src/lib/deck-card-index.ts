/**
 * Shared helpers for building card-lookup indexes used by deck panels
 * (DeckCombosPanel, DeckAnalysisPanel) that need fast resolution of cards
 * by oracle id or lowercased name.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { EnrichedCard } from '../types';
import { scryfallToEnrichedCard } from './scryfall-to-enriched';

export interface CardImageIndex {
  byOracle: Map<string, string>;
  byName: Map<string, string>;
}

export interface CardIndex {
  byOracle: Map<string, EnrichedCard>;
  byName: Map<string, EnrichedCard>;
}

/**
 * Build a local image URL index from the user's collection and deck's Scryfall
 * payloads. Indexed by oracle id AND lowercased name so cards imported before
 * `EnrichedCard.oracleId` existed still resolve via name match.
 *
 * Priority: first-seen wins (collection cards are iterated first).
 * Prefers the `normal` (488×680) variant over `small` for retina quality.
 */
export function buildCardImageIndex(collection: EnrichedCard[], deck: Deck | null): CardImageIndex {
  const byOracle = new Map<string, string>();
  const byName = new Map<string, string>();

  const remember = (
    oracleId: string | undefined,
    name: string | undefined,
    img: string | undefined
  ) => {
    if (!img) return;
    if (oracleId && !byOracle.has(oracleId)) byOracle.set(oracleId, img);
    if (name) {
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, img);
    }
  };

  for (const c of collection) remember(c.oracleId, c.name, c.imageNormal ?? c.imageSmall);

  if (deck) {
    const fromScryfall = (card: ScryfallCard | null) => {
      if (!card) return;
      const face = card.image_uris ?? card.card_faces?.[0]?.image_uris;
      const url = face?.normal ?? face?.small;
      remember(card.oracle_id, card.name, url);
    };
    fromScryfall(deck.commander);
    fromScryfall(deck.partnerCommander);
    for (const c of deck.cards) fromScryfall(c.card);
    for (const c of deck.sideboard) fromScryfall(c.card);
  }

  return { byOracle, byName };
}

/**
 * Build a card data index returning full `EnrichedCard` objects, for use in
 * carousel previews. Indexed by oracle id AND lowercased name.
 *
 * Priority: collection copies are richest (ownership, price, foil status) and
 * are indexed first; deck Scryfall payloads fill in anything not already seen.
 *
 * The `byOracle` map is a superset of what some consumers need — panels that
 * only use `byName` may ignore it.
 */
export function buildCardIndex(collection: EnrichedCard[], deck: Deck | null): CardIndex {
  const byOracle = new Map<string, EnrichedCard>();
  const byName = new Map<string, EnrichedCard>();

  for (const c of collection) {
    if (c.oracleId && !byOracle.has(c.oracleId)) byOracle.set(c.oracleId, c);
    if (c.name) {
      const key = c.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, c);
    }
  }

  if (deck) {
    const indexScryfall = (card: ScryfallCard | null) => {
      if (!card) return;
      const oid = card.oracle_id;
      const name = card.name;
      if (oid && byOracle.has(oid)) return;
      if (name && byName.has(name.toLowerCase())) return;
      const enriched = scryfallToEnrichedCard(card);
      if (oid) byOracle.set(oid, enriched);
      if (name) byName.set(name.toLowerCase(), enriched);
    };
    indexScryfall(deck.commander);
    indexScryfall(deck.partnerCommander);
    for (const c of deck.cards) indexScryfall(c.card);
    for (const c of deck.sideboard) indexScryfall(c.card);
  }

  return { byOracle, byName };
}
