export interface EnrichedCard {
  /**
   * Unique identifier for this physical card copy. Two copies of the same
   * printing (same scryfallId) get distinct copyIds so the allocation system
   * can track each one independently.
   */
  copyId: string;
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
   * Kept on the card for debugging/display, but no longer filterable.
   */
  sourceCategory: string;
  /** Which import format this row came from (e.g. "manabox", "mtga", "plain"). */
  sourceFormat: string;
  /**
   * Identifier of the import batch that added this card. Lets the user delete a
   * specific import (samples, a one-off paste) without losing the rest of the
   * collection. Optional because cards saved before this field existed won't
   * have one — those cards stay until "Clear all".
   */
  importId?: string;
  /** The owned finish for this physical copy: nonfoil, foil, or etched. */
  finish: Finish;
  /** Derived from finish for backwards compat: true when finish is 'foil' or 'etched'. */
  foil: boolean;
  /** Normalized condition (nm/lp/mp/hp/damaged). Per-copy user data; Scryfall has no fallback. */
  condition?: Condition;
  /** Lowercased Scryfall language code (en, ja, de, es, fr, it, pt, ru, ko, zhs, zht, ...). */
  language?: string;
  /** True when the user flagged the physical card as altered (custom art, etc.). */
  altered?: boolean;
  /** True when the card is a proxy rather than a real printing. */
  proxy?: boolean;
  /** True when the user flagged the physical card as a misprint. */
  misprint?: boolean;
  cmc?: number;
  typeLine?: string;
  colorIdentity?: string[];
  colors?: string[];
  edhrecRank?: number;
  imageSmall?: string;
  imageNormal?: string;
  /** Back-face normal image for two-sided layouts (transform / modal_dfc / reversible / double_faced_token). */
  imageNormalBack?: string;
  /** Cosmetic treatments — fullart, extendedart, showcase, etched, inverted, etc. */
  frameEffects?: string[];
  /** True when the printing is a full-art treatment (covers both Scryfall's full_art flag and the 'fullart' frame effect). */
  fullArt?: boolean;
  /** "black" | "white" | "borderless" | "silver" | "gold". */
  borderColor?: string;
  /** Card layout: normal, split, flip, transform, modal_dfc, adventure, saga, token, emblem, etc. */
  layout?: string;
  /** Mana cost string e.g. "{2}{G}{W}". For multi-face cards, faces joined with " // ". */
  manaCost?: string;
  /** Oracle (rules) text, lowercased substring search. For multi-face cards, faces joined. */
  oracleText?: string;
  /** Per-format legality. Keys e.g. standard, pioneer, modern, legacy, vintage, commander, pauper. */
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
  unresolvedNames: string[];
  detectedFormat: string;
}

export interface DeckImportResponse {
  commander: import('@/deck-builder/types').ScryfallCard | null;
  companion: import('@/deck-builder/types').ScryfallCard | null;
  cards: import('@/deck-builder/types').ScryfallCard[];
  unresolvedNames: string[];
  detectedFormat: string;
  cardCount: number;
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

/**
 * Pockets per *page* (one side of a physical sheet). A double-sided binder
 * stores `pocketSize × 2` cards per sheet, but in this app a "page" always
 * means one side — so totals, capacity, and slide counts all use this number
 * as the per-page divisor. See `doubleSided` on BinderDef for the metadata
 * flag.
 */
export type PocketSize = 4 | 9 | 12;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';

export type ColorChoice = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'M';

/**
 * Treatment / frame effect on a printing. "fullart" is special-cased to also
 * include older lands where Scryfall sets `full_art: true` but leaves
 * frame_effects empty.
 */
export type Treatment = 'fullart' | 'extendedart' | 'showcase' | 'etched' | 'inverted';

export type BorderColor = 'black' | 'white' | 'borderless' | 'silver' | 'gold';

export type Finish = 'nonfoil' | 'foil' | 'etched';

/** Normalized physical-copy condition. Per-copy user data; not from Scryfall. */
export type Condition = 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';

export type Format =
  | 'standard'
  | 'pioneer'
  | 'modern'
  | 'legacy'
  | 'vintage'
  | 'commander'
  | 'pauper';

/**
 * Card layouts we surface as filter chips. Card.layout values from Scryfall.
 * Multi-face layouts a player typically cares about for binder organization.
 */
export type Layout =
  | 'normal'
  | 'split'
  | 'flip'
  | 'transform'
  | 'modal_dfc'
  | 'adventure'
  | 'meld'
  | 'leveler'
  | 'saga'
  | 'planar'
  | 'scheme'
  | 'vanguard'
  | 'token'
  | 'double_faced_token'
  | 'emblem'
  | 'augment'
  | 'host'
  | 'class';

/**
 * A type-line or oracle-text chip with an IS / IS NOT toggle.
 * Within a single chip list, IS chips are OR'd among themselves and IS NOT chips
 * are all required to NOT match (AND-of-negations). Card matches the chip list iff:
 *   (no IS chips OR matches at least one IS chip) AND (matches no IS NOT chip).
 */
export interface NegatableChip {
  value: string;
  negate: boolean;
}

/**
 * Single filter set per binder. All fields AND together; empty fields impose no constraint.
 */
export interface BinderFilter {
  /**
   * Legality chips with IS / IS NOT semantics. IS = card legal in that format;
   * IS NOT = card not legal in that format. Multiple IS chips: card must be legal in ALL of them.
   */
  legalities?: NegatableChip[];
  colors?: NegatableChip[];
  /** Rarity chips with IS / IS NOT semantics. Exact match (no substring). */
  rarities?: NegatableChip[];
  cmcMin?: number;
  cmcMax?: number;
  /** Exact match on mana cost string e.g. "{2}{G}{W}" (case-insensitive, whitespace-trimmed). */
  manaCost?: string;
  /** Type-line chips with IS / IS NOT semantics. Substring match. */
  typeChips?: NegatableChip[];
  /** Oracle-text chips with IS / IS NOT semantics. Substring match. */
  oracleChips?: NegatableChip[];
  setCodes?: string[];
  priceMin?: number;
  priceMax?: number;
  /** Finish chips with IS / IS NOT semantics. Tests against the card's available finishes set. */
  finishes?: NegatableChip[];
  /** Layout chips with IS / IS NOT semantics. Exact match. */
  layouts?: NegatableChip[];
  /** Substring match on card name (case-insensitive). */
  nameContains?: string;
  /** EDHREC popularity threshold. Card matches if its edhrec_rank ≤ this number. */
  edhrecRankMax?: number;
  /** Treatment chips with IS / IS NOT semantics. 'fullart' is special-cased. */
  treatments?: NegatableChip[];
  /** Border chips with IS / IS NOT semantics. Exact match on borderColor. */
  borderColors?: NegatableChip[];
}

/**
 * One OR-branch of a binder's matching rules. The binder accepts a card if it
 * matches ANY group; within a group, all `filter` fields AND together as before.
 * `name` is an optional user-supplied label shown in the editor; the materialize
 * path doesn't read it.
 */
export interface BinderFilterGroup {
  name?: string;
  filter: BinderFilter;
}

export interface BinderDef {
  id: string;
  name: string;
  position: number;
  /**
   * OR-list of filter groups. A card joins this binder if it matches any group.
   * Always has length ≥ 1; a single group with an empty filter matches every card.
   */
  filterGroups: BinderFilterGroup[];
  sorts: SortField[];
  /** null = inherit global default pocket size */
  pocketSize: PocketSize | null;
  /**
   * True if each physical sheet stores cards on both sides (e.g. a "9-pocket
   * double-sided" binder = pockets-per-page 9, two pages per sheet). Pure
   * metadata — display, totals, and chunking are driven by `pocketSize`
   * alone (each side is its own page).
   */
  doubleSided: boolean;
  /**
   * Fixed binder capacity in cards. null = flexible (binder grows with cards).
   * Stored as a raw card count so users can express off-multiples (e.g. a binder
   * with a torn page). Page count is derived: ceil(fixedCapacity / pocketSize).
   * Over-capacity is surfaced as a non-blocking warning, not enforced.
   */
  fixedCapacity: number | null;
  color: string;
  /** Marks binders created via "Load samples" — purely for tagging in the UI. */
  isSample?: boolean;
  /** copyIds manually added to this binder. Claimed before rule routing so they
   *  don't land in other binders. Undefined = no pinned cards. */
  pinnedCopyIds?: string[];
  /** copyIds manually excluded from this binder even if rules match them.
   *  Undefined = no exclusions. */
  excludedCopyIds?: string[];
  /** When set, explicit card order overrides the binder's sort fields.
   *  Cards not in this list (new additions) are appended at the end.
   *  Undefined = use auto-sort (existing behavior). */
  manualOrder?: string[];
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
