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
 * What the frontend receives: one entry per physical card (rows already expanded by Quantity)
 * with Scryfall data merged in when available.
 */
export interface EnrichedCard {
  /**
   * Unique identifier for this physical card copy. Two copies of the same
   * printing (same scryfallId) get distinct copyIds so the allocation system
   * can track each one independently.
   */
  copyId: string;
  // From the import row
  name: string;
  /** Scryfall oracle_id — printing-agnostic identity, used as the join key for combo data. */
  oracleId?: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  scryfallId: string;
  purchasePrice: number;
  /**
   * Epoch ms when purchasePrice was last sourced from Scryfall. Optional so cards
   * persisted before this field existed don't break — treat missing as stale.
   * Omitted when Scryfall returned no price (purchasePrice === 0).
   */
  pricedAt?: number;
  /**
   * Optional category label from the source export — ManaBox binder name, Moxfield tag, etc.
   * Surfaced to users as a filterable hint via the rules engine.
   */
  sourceCategory: string;
  /** Which import format this row came from. */
  sourceFormat: string;
  /** The owned finish for this physical copy. */
  finish: 'nonfoil' | 'foil' | 'etched';
  /** Derived from finish for backwards compat: true when finish is 'foil' or 'etched'. */
  foil: boolean;
  /** Normalized condition (nm/lp/mp/hp/damaged). Per-copy user data; Scryfall has no fallback. */
  condition?: 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';
  /** Lowercased Scryfall language code (en, ja, de, es, fr, it, pt, ru, ko, zhs, zht, ...). */
  language?: string;
  /** True when the user flagged the physical card as altered (custom art, etc.). */
  altered?: boolean;
  /** True when the card is a proxy rather than a real printing. */
  proxy?: boolean;
  /** True when the user flagged the physical card as a misprint. */
  misprint?: boolean;

  // From Scryfall (optional — undefined if Scryfall lookup failed)
  cmc?: number;
  typeLine?: string;
  colorIdentity?: string[];
  colors?: string[];
  edhrecRank?: number;
  imageSmall?: string;
  imageNormal?: string;
  imageNormalBack?: string;
  /** Cosmetic treatments — fullart, extendedart, showcase, etched, inverted, etc. */
  frameEffects?: string[];
  /** Convenience: true if either Scryfall's full_art flag OR frameEffects contains 'fullart'. */
  fullArt?: boolean;
  /** "black" | "white" | "borderless" | "silver" | "gold". */
  borderColor?: string;
  /** Card layout: normal, split, flip, transform, modal_dfc, adventure, saga, token, emblem, etc. */
  layout?: string;
  /** Mana cost string e.g. "{2}{G}{W}". For multi-face cards, faces joined with " // ". */
  manaCost?: string;
  /** Oracle (rules) text. For multi-face cards, faces joined with "\n//\n". */
  oracleText?: string;
  /** Per-format legality. Keys: standard, pioneer, modern, legacy, vintage, commander, pauper, etc. */
  legalities?: Record<string, string>;
  /** Available finishes for this printing — subset of ["nonfoil","foil","etched"]. */
  finishes?: string[];
  /** Promo treatments — specialty foil variants like "textured", "surgefoil", "halofoil",
   *  "gilded", "oilslick", "neonink", "raisedfoil", "confettifoil", "stepandrepeat". */
  promoTypes?: string[];
}

export interface DeckImportResponse {
  commander: ScryfallCard | null;
  companion: ScryfallCard | null;
  cards: ScryfallCard[];
  unresolvedNames: string[];
  /** Names skipped because Scryfall couldn't be reached (outage / rate limit) — retryable, not typos. */
  fetchErrors: string[];
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
