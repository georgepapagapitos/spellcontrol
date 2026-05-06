export interface EnrichedCard {
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  scryfallId: string;
  purchasePrice: number;
  /**
   * Optional category label from the source export — ManaBox binder name, Moxfield tag, etc.
   * Empty string if the source had no category.
   */
  sourceCategory: string;
  /** Which import format this row came from (e.g. "manabox", "mtga", "plain"). */
  sourceFormat: string;
  foil: boolean;
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
  unresolvedNames: string[];
  detectedFormat: string;
}

export type SortField =
  | 'none'
  | 'color'
  | 'type'
  | 'rarity'
  | 'cmc'
  | 'name'
  | 'set'
  | 'price'
  | 'edhrec';

export type PocketSize = 4 | 9 | 18;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';

export type ColorChoice = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'M';

export type FoilChoice = 'any' | 'foil' | 'nonfoil';

export interface BinderRule {
  rarities?: Rarity[];
  priceMin?: number;
  priceMax?: number;
  colors?: ColorChoice[];
  types?: string[];
  cmcMin?: number;
  cmcMax?: number;
  nameContains?: string;
  setCodes?: string[];
  foil?: FoilChoice;
  /**
   * Substring match on the source category (ManaBox binder name, Moxfield tag, etc).
   * Useful for users who pre-categorize cards in their collection tool.
   */
  sourceCategoryContains?: string;
  /**
   * EDHREC popularity threshold. Card matches if its edhrec_rank ≤ this number.
   */
  edhrecRankMax?: number;
}

export interface BinderDef {
  id: string;
  name: string;
  position: number;
  /**
   * Match groups. A card joins this binder if it matches ANY group.
   * Empty array means "match nothing"; a single empty rule means "match everything".
   */
  rules: BinderRule[];
  sorts: SortField[];
  /** null = inherit global default pocket size */
  pocketSize: PocketSize | null;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export type BinderInput = Omit<BinderDef, 'id' | 'createdAt' | 'updatedAt'>;

/** Page = array of card slots. nulls represent empty slots in a partial last page. */
export type Page = (EnrichedCard | null)[];

/**
 * A page within a section, tagged with its 1-based page number from the unfiltered
 * layout. When search is active, non-matching cards become null in `slots` and
 * pages with zero matches are dropped — but `pageNum` keeps pointing at the original
 * physical page so the user can find the card in the real binder.
 */
export interface BinderPage {
  slots: Page;
  pageNum: number;
}

export interface BinderSection {
  /** Color identity key: W/U/B/R/G/M/C/L/?/ALL */
  colorKey: string;
  cards: EnrichedCard[];
  pages: BinderPage[];
}

export interface MaterializedBinder {
  def: BinderDef;
  effectivePocketSize: PocketSize;
  sections: BinderSection[];
  totalCards: number;
  totalPages: number;
}

export interface UnbinnedBucket {
  totalCards: number;
  sections: BinderSection[];
  totalPages: number;
  effectivePocketSize: PocketSize;
}
