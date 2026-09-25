import {
  asRecord,
  asString,
  clampDeckName,
  countProjectable,
  isProjectableSlot,
} from '../shares/projections';
import { cardArtUrl } from '../shares/og';

export interface ListingFields {
  name: string;
  format: string;
  commanderName: string | null;
  commanderImageNormal: string | null;
  colorIdentity: string[];
  bracket: number | null;
  /**
   * The auto-estimate, independent of `bracket` (stated ?? estimate) — so a
   * listing can show "Bracket 2 · est. 4" instead of letting a stated number
   * hide what the deck actually estimates at (2026-09-24 ruling). Null when
   * the deck has never been analyzed.
   */
  estimatedBracket: number | null;
  cardCount: number;
  /**
   * og:image for the public `/d/:slug` landing (w1-public-routes-linkability).
   * Resolved from the real Scryfall art_crop field at publish time via
   * `cardArtUrl` (backend/src/shares/og.ts) — never a `/normal/`-replace
   * guess — so it never fabricates a 404. See ORCHESTRATOR AMENDMENT in the
   * PR spec.
   */
  ogArtCrop: string | null;
}

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
}

function asFiniteNumber(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/**
 * Reads an inline (unknown-shaped) ScryfallCard's `.normal` image, mirroring
 * `cardArtUrl`'s direct-field / `card_faces[0]` fallback (backend/src/shares/og.ts)
 * — same raw Scryfall shape, different image size (merge-card.ts reads the
 * two sizes the same way for the app's own normalized cards).
 */
function normalImageUrl(raw: unknown): string | undefined {
  const card = asRecord(raw);
  if (!card) return undefined;
  const direct = asString(asRecord(card.image_uris)?.normal);
  if (direct) return direct;
  const face = Array.isArray(card.card_faces) ? asRecord(card.card_faces[0]) : null;
  return asString(asRecord(face?.image_uris)?.normal);
}

/**
 * A deck's overall color identity: the union of its commander(s)' identities.
 * Mirrors DeckEditorPage's `commanderColorIdentity` memo exactly (insertion
 * order, no sort). A non-commander deck has neither field set, so this is [].
 */
function deckColorIdentity(commander: unknown, partnerCommander: unknown): string[] {
  const identity = new Set<string>();
  for (const c of asStringArray(asRecord(commander)?.color_identity)) identity.add(c);
  for (const c of asStringArray(asRecord(partnerCommander)?.color_identity)) identity.add(c);
  return [...identity];
}

/**
 * Parses the listing-relevant slice of a deck's stored JSONB (the frontend's
 * `Deck` shape) for `deck_publications`. `deckData` is opaque JSONB to the
 * backend (see routes/sync.ts), so every read is defensive; only a non-empty
 * `name` is required — everything else degrades to null/0/[] rather than
 * throwing. Returns null for a non-object or a missing/empty name (the
 * publish route turns that into its own 400).
 */
export function extractListingFields(deckData: unknown): ListingFields | null {
  const deck = asRecord(deckData);
  if (!deck) return null;
  const rawName = asString(deck.name);
  if (!rawName) return null;
  // `deck_publications.deck_name` is the /d/:slug <title>, its og:title, the
  // hero h1 and the /u/ tile. Clamp once, here, where they all read from
  // (board E342) — the deck's own stored name keeps whatever the owner typed.
  const name = clampDeckName(rawName);

  const cardsArr = Array.isArray(deck.cards) ? deck.cards : [];
  const firstMainboardCard = asRecord(cardsArr[0])?.card;
  const { commander, partnerCommander } = deck;

  return {
    name,
    format: asString(deck.format) ?? 'commander',
    commanderName: asString(asRecord(commander)?.name) ?? null,
    commanderImageNormal: normalImageUrl(commander) ?? null,
    colorIdentity: deckColorIdentity(commander, partnerCommander),
    bracket:
      asFiniteNumber(deck.bracketOverride) ??
      asFiniteNumber(asRecord(deck.bracketEstimation)?.bracket) ??
      null,
    estimatedBracket: asFiniteNumber(asRecord(deck.bracketEstimation)?.bracket) ?? null,
    // Counted with the SAME guard the public deck page renders with, not
    // `cardsArr.length`: this number is the /d/:slug link preview's "N cards"
    // and the /u/ tile's count, and a slot with no `card` is one the page
    // drops (board E343, fourth instance of the same shape).
    cardCount:
      (commander ? 1 : 0) +
      (partnerCommander ? 1 : 0) +
      countProjectable(cardsArr, isProjectableSlot),
    ogArtCrop:
      cardArtUrl(commander) ??
      cardArtUrl(partnerCommander) ??
      cardArtUrl(firstMainboardCard) ??
      null,
  };
}
