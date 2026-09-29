import {
  asRecord,
  asString,
  clampDeckName,
  countProjectable,
  isProjectableSlot,
} from '../shares/projections';
import { pickDeckCover, type DeckCoverInput } from '@spellcontrol/deck-metrics';
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

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/**
 * A deck's overall color identity, the same colors the owner's own deck index
 * shows (frontend `effectiveDeckColors` + DecksIndexPage's pip order):
 *
 * - With a commander: the union of the commander(s)' identities, in insertion
 *   order (DeckEditorPage's `commanderColorIdentity` memo).
 * - Without one (Pauper, Modern, Standard, …): the union over the mainboard and
 *   sideboard cards, most-used color first, ties in WUBRG order. Reading only
 *   the commander here left every non-commander deck colorless in Discover,
 *   on /u/:username and in the friend library: no pips, a grey strip, and a
 *   color filter that matched it under any selection.
 */
function deckColorIdentity(
  commander: unknown,
  partnerCommander: unknown,
  zones: unknown[][]
): string[] {
  if (asRecord(commander) || asRecord(partnerCommander)) {
    const identity = new Set<string>();
    for (const c of asStringArray(asRecord(commander)?.color_identity)) identity.add(c);
    for (const c of asStringArray(asRecord(partnerCommander)?.color_identity)) identity.add(c);
    return [...identity];
  }
  // One count per slot per color, as deckColorFrequency does: a 4-of is four
  // slots, so it weighs four times a one-of.
  const counts = new Map<string, number>();
  for (const zone of zones) {
    for (const slot of zone) {
      for (const c of asStringArray(asRecord(asRecord(slot)?.card)?.color_identity)) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
  }
  return [...counts.keys()].sort(
    (a, b) => counts.get(b)! - counts.get(a)! || WUBRG.indexOf(a) - WUBRG.indexOf(b)
  );
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
  const sideboardArr = Array.isArray(deck.sideboard) ? deck.sideboard : [];
  const { commander, partnerCommander } = deck;

  return {
    name,
    format: asString(deck.format) ?? 'commander',
    commanderName: asString(asRecord(commander)?.name) ?? null,
    commanderImageNormal: normalImageUrl(commander) ?? null,
    colorIdentity: deckColorIdentity(commander, partnerCommander, [cardsArr, sideboardArr]),
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
    // The same cover the owner sees on the deck's tile and page: their pick,
    // else the commander, else the deck's signature card.
    ogArtCrop: cardArtUrl(pickDeckCover(deck as DeckCoverInput<unknown>)) ?? null,
  };
}
