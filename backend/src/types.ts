/**
 * Subset of fields we use from Scryfall's card object.
 * Full schema: https://scryfall.com/docs/api/cards
 */
export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  colors?: string[];
  color_identity: string[];
  rarity: string;
  set: string;
  set_name: string;
  collector_number: string;
  /** EDHREC popularity rank. Lower = more popular. Missing for some cards (tokens, weird sets). */
  edhrec_rank?: number;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
  };
  card_faces?: Array<{
    name: string;
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
