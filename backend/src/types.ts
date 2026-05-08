/**
 * Subset of fields we use from Scryfall's card object.
 * Full schema: https://scryfall.com/docs/api/cards
 */
export interface ScryfallCard {
  id: string;
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
    };
  }>;
}

/**
 * What the frontend receives: one entry per physical card (rows already expanded by Quantity)
 * with Scryfall data merged in when available.
 */
export interface EnrichedCard {
  // From the import row
  name: string;
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
  foil: boolean;

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

export interface UploadResponse {
  cards: EnrichedCard[];
  totalRows: number;
  scryfallHits: number;
  scryfallMisses: number;
  /** Card names that could not be resolved to Scryfall data — surfaced to user. */
  unresolvedNames: string[];
  /** Which parser handled the input. */
  detectedFormat: string;
}
