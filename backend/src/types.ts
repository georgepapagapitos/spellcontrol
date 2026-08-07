/**
 * A single Scryfall ruling entry.
 * Shape: https://scryfall.com/docs/api/rulings
 */
export interface Ruling {
  published_at: string;
  comment: string;
  source: string;
}

/**
 * Subset of fields we use from Scryfall's card object.
 * Full schema: https://scryfall.com/docs/api/cards
 */
export interface ScryfallCard {
  id: string;
  /** Printing-agnostic card identity. Stable across reprints; the join key for combo data. */
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  /** Null for some multi-face layouts (e.g. reversible_card). Fall back to card_faces[0]. */
  cmc?: number;
  /** Null for some multi-face layouts (e.g. reversible_card). Fall back to card_faces[0]. */
  type_line?: string;
  colors?: string[];
  /** Always present at top level except for tokens / oddball layouts. */
  color_identity?: string[];
  rarity: string;
  set: string;
  set_name: string;
  collector_number: string;
  layout?: string;
  /** Per-format legality. Each value is "legal" | "not_legal" | "restricted" | "banned". */
  legalities?: Record<string, string>;
  /** Rules text. Null on multi-face layouts; faces hold per-face oracle text. */
  oracle_text?: string;
  /** Available finishes for this printing. e.g. ["nonfoil","foil"] or ["etched"]. */
  finishes?: string[];
  /** EDHREC popularity rank. Lower = more popular. Missing for some cards (tokens, weird sets). */
  edhrec_rank?: number;
  /** Scryfall's parsed keyword list (e.g. ["Flying","Lifelink"]). Feeds synergy classification. */
  keywords?: string[];
  /** Cosmetic treatments on this printing (e.g. "fullart", "extendedart", "showcase", "etched"). */
  frame_effects?: string[];
  /** Promo treatments — where Scryfall encodes specialty foils like "textured", "surgefoil",
   *  "halofoil", "gilded", "oilslick", "neonink", "raisedfoil", "confettifoil", "stepandrepeat". */
  promo_types?: string[];
  /** Older full-art lands set this without populating frame_effects. */
  full_art?: boolean;
  /** "black" | "white" | "borderless" | "silver" | "gold". */
  border_color?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
  /**
   * Scryfall's market-price snapshot. Strings (or null) keyed by finish.
   * Used as the fallback for `purchasePrice` when the import row didn't carry
   * one — e.g. plain text / MTGA pastes — so the in-app value column is
   * meaningful even without a CSV that has a price column.
   */
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
    eur_foil?: string | null;
  };
  card_faces?: Array<{
    name: string;
    type_line?: string;
    cmc?: number;
    colors?: string[];
    mana_cost?: string;
    oracle_text?: string;
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
      art_crop?: string;
    };
  }>;
}

/**
 * One physical card copy the frontend receives, enriched with Scryfall data.
 * Canonical shape lives in `@spellcontrol/binder-routing` (the routing
 * engine's own card type) — re-exported here rather than hand-copied so this
 * file and the frontend/routing-engine copies can't drift out of lockstep the
 * way they did before (board E205; see that package's `src/types.ts` for the
 * full field-by-field documentation). `mergeCard` below only ever sets a
 * subset of the fields — the rest (updatedAt, importId, tags, ...) are
 * optional and stamped client-side.
 */
import type { EnrichedCard } from '@spellcontrol/binder-routing';
export type { EnrichedCard };

export interface DeckImportResponse {
  commander: ScryfallCard | null;
  companion: ScryfallCard | null;
  cards: ScryfallCard[];
  /** Format sideboard rows ("Sideboard" header). Absent/empty for products and inputs with none. */
  sideboard?: ScryfallCard[];
  /** "Maybeboard" header rows — park-candidates (E122), routed to the deck's Considering zone. */
  considering?: ScryfallCard[];
  unresolvedNames: string[];
  /** Names skipped because Scryfall couldn't be reached (outage / rate limit) — retryable, not typos. */
  fetchErrors: string[];
  /** Raw lines the parser couldn't turn into a row at all — never resolved, never counted. */
  malformedRows: string[];
  detectedFormat: string;
  cardCount: number;
}

export interface UploadResponse {
  cards: EnrichedCard[];
  totalRows: number;
  scryfallHits: number;
  scryfallMisses: number;
  /** Card names that could not be resolved to Scryfall data — surfaced to user. */
  unresolvedNames: string[];
  /**
   * Rows withheld from the import because Scryfall couldn't be reached (outage /
   * rate limit). Full parsed rows so the client can retry them losslessly
   * (quantity/printing/finish intact) by POSTing them back as `{ rows }`.
   */
  fetchErrors: import('./parsers/types').ImportRow[];
  /**
   * Raw lines the parser couldn't turn into a row at all (e.g. a CSV line with
   * no name column, or a column count that doesn't match the header). These
   * never became an ImportRow — distinct from unresolvedNames, which parsed
   * fine but Scryfall didn't recognize.
   */
  malformedRows: string[];
  /** Rows with an explicit quantity of 0 (wishlist/tradelist-only entries) that were skipped rather than imported as 1 copy. */
  skippedUnownedRows: number;
  /** Rows whose quantity exceeded the per-row cap and was clamped down to it. */
  clampedRows: number;
  /** Which parser handled the input. */
  detectedFormat: string;
}

/** A known MTG product (preconstructed deck, etc.) from the MTGJSON catalog (T17). */
export interface ProductSummary {
  fileName: string;
  code: string;
  name: string;
  type: string;
  releaseDate: string;
}

/**
 * One physical card in a product, with the per-copy quantity + finish + zone so
 * the collection-add path can stamp the correct number of owned copies with the
 * right printing/treatment, and the UI can show a per-zone breakdown.
 */
export interface ProductPhysicalCard {
  card: ScryfallCard;
  quantity: number;
  finish: 'nonfoil' | 'foil' | 'etched';
  /** Originating MTGJSON zone (commander, mainBoard, displayCommander, tokens, …). */
  zone: string;
}

/** Resolved contents of a single product: the playable deck + every physical card. */
export interface ProductResolveResponse {
  product: ProductSummary;
  /** The playable singleton deck (commander + 99) — for "add as a deck". */
  deck: DeckImportResponse;
  /**
   * EVERY physical card in the box across every zone (deck cards + display
   * commanders + tokens + …), finish-accurate — for "add to the collection".
   */
  physicalCards: ProductPhysicalCard[];
  /** Names of cards that couldn't be resolved to Scryfall data. */
  unresolvedNames: string[];
  /** Physical-card names skipped because Scryfall couldn't be reached — retry by re-resolving the product. */
  fetchErrors: string[];
  /**
   * True physical card count across every zone MTGJSON lists, counted from the
   * raw decklist so it includes cards that failed to resolve. Surfaced so the
   * user can reconcile against the physical box.
   */
  physicalCardCount: number;
}
