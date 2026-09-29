// What a Scryfall printing's layout means for a deck: whether it is a real
// game piece at all, and the card a reversible printing prints. A leaf (types
// only, no imports of app code) so the Scryfall client and the generator's
// alternate pools can both use it without an import cycle.
import type { ScryfallCard } from '@/deck-builder/types';

// Scryfall layouts that aren't real game pieces (art cards, tokens, emblems, etc.).
// These can sneak in via /cards/collection with a set preference or via the
// `unique=prints` upgrade search when a treatment filter (e.g. is:full-art) matches
// an art-series printing — they have legalities.commander === 'not_legal' and would
// otherwise be flagged after the deck is generated.
const NON_PLAYABLE_LAYOUTS = new Set([
  'art_series',
  'token',
  'double_faced_token',
  'emblem',
  'scheme',
  'planar',
  'vanguard',
]);

export function isPlayableCard(card: ScryfallCard): boolean {
  return !card.layout || !NON_PLAYABLE_LAYOUTS.has(card.layout);
}

type Face = NonNullable<ScryfallCard['card_faces']>[number] & {
  cmc?: number;
  oracle_id?: string;
};

/**
 * A reversible printing as the card it prints (E527). Scryfall's
 * `reversible_card` layout is one card with the same face on both sides (the
 * Secret Lair "Krark's Thumb // Krark's Thumb"): the name doubles, and cmc,
 * type line, oracle text and oracle_id live on the faces only. Art searches
 * find these printings for their art, in the art-theme pool and in the
 * strict printing upgrade that follows it, and the card went on through
 * generation under the doubled name with no mana value (a "NaN" curve
 * bucket, no tagger tags, no EDHREC match). Flattening it onto its front face
 * keeps the printing (its art, set and price) and restores the card; every
 * other layout passes through untouched.
 *
 * Generation only: a collection keeps the real reversible object, both faces
 * and both images, because that is what the player owns.
 */
export function resolveReversiblePrinting(card: ScryfallCard): ScryfallCard {
  const face = card.card_faces?.[0] as Face | undefined;
  if (card.layout !== 'reversible_card' || !face) return card;
  const { card_faces: _faces, ...printing } = card;
  return {
    ...printing,
    layout: 'normal',
    name: face.name,
    oracle_id: card.oracle_id ?? face.oracle_id ?? '',
    mana_cost: face.mana_cost,
    cmc: Number.isFinite(card.cmc) ? card.cmc : (face.cmc ?? 0),
    type_line: face.type_line,
    oracle_text: face.oracle_text,
    flavor_text: face.flavor_text,
    colors: card.colors ?? face.colors,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    // Scryfall sends a face the full image set; the face type lists fewer.
    image_uris: card.image_uris ?? (face.image_uris as ScryfallCard['image_uris'] | undefined),
  };
}
