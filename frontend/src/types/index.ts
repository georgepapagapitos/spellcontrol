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
  /** Cosmetic treatments — fullart, extendedart, showcase, etched, inverted, etc. */
  frameEffects?: string[];
  /** True when the printing is a full-art treatment (covers both Scryfall's full_art flag and the 'fullart' frame effect). */
  fullArt?: boolean;
  /** "black" | "white" | "borderless" | "silver" | "gold". */
  borderColor?: string;
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

/**
 * Treatment / frame effect on a printing. "fullart" is special-cased to also
 * include older lands where Scryfall sets `full_art: true` but leaves
 * frame_effects empty.
 */
export type Treatment = 'fullart' | 'extendedart' | 'showcase' | 'etched' | 'inverted';

export type BorderColor = 'black' | 'white' | 'borderless' | 'silver' | 'gold';

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
  /**
   * Cosmetic treatments. Card matches if any of its treatments is in this list.
   * 'fullart' matches both Scryfall's full_art flag and the 'fullart' frame effect.
   */
  treatments?: Treatment[];
  /** Card matches if its borderColor is in this list. */
  borderColors?: BorderColor[];
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
  /**
   * Stable grouping key — depends on the binder's primary sort:
   *   color  → W/U/B/R/G/M/C/L/?
   *   type   → creature/instant/sorcery/...
   *   rarity → mythic/rare/uncommon/common/...
   *   cmc    → cmc-0/cmc-1/.../cmc-7+
   *   set    → setCode
   *   name   → name-A/name-B/.../name-#
   *   price  → price-0/price-lt1/...
   *   edhrec → edhrec-100/edhrec-1000/...
   *   none   → ALL
   */
  key: string;
  /** Display label for the section header (e.g. "White", "Creature", "CMC 3"). */
  label: string;
  /** Optional color-pip styling — populated only when grouping by color. */
  pip?: { background: string; border: string };
  cards: EnrichedCard[];
  pages: BinderPage[];
}

export interface MaterializedBinder {
  def: BinderDef;
  effectivePocketSize: PocketSize;
  /** Sort chain actually applied (includes the implicit Name tiebreaker if added). */
  effectiveSorts: SortField[];
  sections: BinderSection[];
  totalCards: number;
  totalPages: number;
}

export interface UncategorizedBucket {
  totalCards: number;
  sections: BinderSection[];
  totalPages: number;
  effectivePocketSize: PocketSize;
  effectiveSorts: SortField[];
}
