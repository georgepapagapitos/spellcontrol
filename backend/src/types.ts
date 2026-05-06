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
  /** EDHREC popularity rank. Lower = more popular. Missing for some cards (tokens, weird sets). */
  edhrec_rank?: number;
  /** Cosmetic treatments on this printing (e.g. "fullart", "extendedart", "showcase", "etched"). */
  frame_effects?: string[];
  /** Older full-art lands set this without populating frame_effects. */
  full_art?: boolean;
  /** "black" | "white" | "borderless" | "silver" | "gold". */
  border_color?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
  };
  card_faces?: Array<{
    name: string;
    type_line?: string;
    cmc?: number;
    colors?: string[];
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
  /** Cosmetic treatments — fullart, extendedart, showcase, etched, inverted, etc. */
  frameEffects?: string[];
  /** Convenience: true if either Scryfall's full_art flag OR frameEffects contains 'fullart'. */
  fullArt?: boolean;
  /** "black" | "white" | "borderless" | "silver" | "gold". */
  borderColor?: string;
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
