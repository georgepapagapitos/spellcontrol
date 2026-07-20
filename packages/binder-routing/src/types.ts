/**
 * Shared data types for the binder routing engine.
 *
 * These are a self-contained copy of the card/binder/sort interfaces the
 * SpellControl apps persist. The package is the source of truth for the
 * routing *logic*; the frontend keeps its own `types/index.ts` (a structural
 * superset) and the backend treats user_data as opaque JSONB — both stay
 * assignment-compatible with the shapes here by structural typing.
 */

/** The owned finish for a physical copy. */
export type Finish = 'nonfoil' | 'foil' | 'etched';

/** Normalized physical-copy condition. Per-copy user data; not from Scryfall. */
export type Condition = 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';

/**
 * A single physical card copy enriched with Scryfall data. The routing engine
 * only reads a subset of these fields; the rest ride along so callers can keep
 * passing their full stored shape.
 */
export interface EnrichedCard {
  copyId: string;
  name: string;
  oracleId?: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  scryfallId: string;
  purchasePrice: number;
  pricedAt?: number;
  /**
   * Epoch ms this physical copy was last edited — created via quick-add, or
   * changed through the edit-card flow (printing/finish/quantity/condition).
   * Powers the collection "Last edited" sort. Optional: cards predating this
   * field (or imported, which doesn't stamp it) fall back to their import time.
   * NOT bumped by price refreshes (price is stripped off the synced row).
   */
  updatedAt?: number;
  sourceCategory: string;
  sourceFormat: string;
  importId?: string;
  finish: Finish;
  foil: boolean;
  condition?: Condition;
  language?: string;
  altered?: boolean;
  proxy?: boolean;
  misprint?: boolean;
  cmc?: number;
  typeLine?: string;
  colorIdentity?: string[];
  colors?: string[];
  edhrecRank?: number;
  imageSmall?: string;
  imageNormal?: string;
  imageNormalBack?: string;
  imageLarge?: string;
  imageLargeBack?: string;
  frameEffects?: string[];
  fullArt?: boolean;
  borderColor?: string;
  layout?: string;
  manaCost?: string;
  oracleText?: string;
  legalities?: Record<string, string>;
  finishes?: string[];
  promoTypes?: string[];
  /**
   * Scryfall oracle tags (otags) for this card, e.g. ['mana-rock', 'ramp'].
   * Reference data, NOT persisted/synced — the caller decorates cards from a
   * name-keyed tag snapshot just before materializing. Absent/empty means the
   * snapshot wasn't loaded (or the card is untagged); a tag rule then matches
   * nothing for this card rather than erroring.
   */
  tags?: string[];
}

export type SortField =
  | 'none'
  | 'color'
  | 'type'
  | 'rarity'
  | 'cmc'
  | 'name'
  | 'setReleaseDate'
  | 'setName'
  | 'price'
  | 'edhrec'
  | 'collectorNumber'
  | 'quantity'
  | 'treatment'
  | 'finish'
  // Collection-only: import date, derived at sort-time from a card's importId via
  // SortContext.addedAtByImportId. Intentionally NOT in SORT_FIELDS — it has no
  // value in binder views (which don't supply that context), so it stays out of
  // the binder sort picker and is offered only by the collection sort UI.
  | 'dateAdded'
  // Collection-only: per-copy last-edit time (card.updatedAt), falling back to
  // import time. Like dateAdded, NOT in SORT_FIELDS — collection sort UI only.
  | 'dateEdited';

export type SortDir = 'asc' | 'desc';

export interface SortEntry {
  field: SortField;
  dir: SortDir;
}

/**
 * Pockets per *page* (one side of a physical sheet). See `doubleSided` on
 * BinderDef for the sheet-level metadata flag.
 */
export type PocketSize = 4 | 9 | 12;

/**
 * A type-line or oracle-text chip with an IS / IS NOT toggle.
 */
export interface NegatableChip {
  value: string;
  negate: boolean;
}

/**
 * Flat chip-expression with explicit joiners between chips. `joiners[i]`
 * connects `chips[i]` to `chips[i+1]`; length is exactly `chips.length - 1`.
 * The evaluator walks the chips with AND binding tighter than OR.
 */
export interface ChipExpression {
  chips: NegatableChip[];
  joiners: ('AND' | 'OR')[];
}

/**
 * Single filter set per binder. All fields AND together; empty fields impose
 * no constraint.
 */
export interface BinderFilter {
  legalities?: ChipExpression;
  colors?: ChipExpression;
  rarities?: ChipExpression;
  cmcMin?: number;
  cmcMax?: number;
  manaCost?: string;
  typeChips?: ChipExpression;
  /** Primary card types. Exact-token match against parsed types, e.g. Creature, Instant. */
  typeTokenChips?: ChipExpression;
  /** Supertype chips. Exact-token match against parsed supertypes (e.g. "Legendary", "Basic"). */
  supertypeChips?: ChipExpression;
  /** Subtype chips. Substring match against joined subtypes (e.g. "Angel", "Equipment"). */
  subtypeChips?: ChipExpression;
  oracleChips?: ChipExpression;
  /**
   * Scryfall oracle-tag chips (e.g. "mana-rock", "removal"). Each chip names a
   * tag from the bundled tagger snapshot; a card matches if `card.tags` contains
   * it. Far more precise than oracle-text substrings for semantic concepts —
   * "mana-rock" beats the word "add", which also catches "addition".
   */
  oracleTagChips?: ChipExpression;
  setCodes?: string[];
  priceMin?: number;
  priceMax?: number;
  finishes?: ChipExpression;
  layouts?: ChipExpression;
  nameContains?: string;
  edhrecRankMax?: number;
  treatments?: ChipExpression;
  borderColors?: ChipExpression;
  commanderEligible?: boolean;
  /**
   * A Scryfall search query (e.g. "is:shockland") snapshot-resolved to a set of
   * oracle ids. Scryfall's curated filters can't be evaluated offline, so the
   * editor resolves the query against the live API once and stores the resulting
   * `oracleIds`; matching is plain `card.oracleId` membership. `resolvedAt` lets
   * the UI show staleness and offer a manual re-run.
   */
  scryfallQuery?: ScryfallQueryRule;
}

export interface ScryfallQueryRule {
  query: string;
  oracleIds: string[];
  resolvedAt?: number;
}

/**
 * One OR-branch of a binder's matching rules. The binder accepts a card if it
 * matches ANY group; within a group, all `filter` fields AND together.
 */
export interface BinderFilterGroup {
  name?: string;
  filter: BinderFilter;
}

/**
 * Snapshot of a binder's membership at the moment the user marked it reviewed.
 */
export interface BinderReviewSnapshot {
  at: number;
  keys: string[];
  cardSnapshots: Record<
    string,
    { price: number; edhrecRank?: number; legalities?: Record<string, string> }
  >;
}

export interface BinderDef {
  id: string;
  name: string;
  position: number;
  filterGroups: BinderFilterGroup[];
  sorts: SortEntry[];
  /** null = inherit global default pocket size */
  pocketSize: PocketSize | null;
  doubleSided: boolean;
  fixedCapacity: number | null;
  color: string;
  isSample?: boolean;
  /** 'rules' (default): filterGroups drive routing; 'manual': only pins appear. */
  mode?: 'rules' | 'manual';
  pinnedCopyIds?: string[];
  pinnedKeys?: string[];
  excludedCopyIds?: string[];
  excludedKeys?: string[];
  manualOrder?: string[];
  manualKeys?: string[];
  hideDeckAllocated?: boolean;
  sortValueOrders?: Partial<Record<SortField, string[]>>;
  keepPrintingsTogether?: boolean;
  /**
   * 'sort' (default): sections are driven by the primary sort field (color/type/…).
   * 'group': one section per filterGroup, in group order, each labeled by the group's
   * optional `name`. First-matching-group-wins when a card matches multiple groups.
   * Empty sections are hidden. The shared binder `sorts` apply within each group section.
   */
  sectionMode?: 'sort' | 'group';
  /**
   * How many sort levels force a new page when their category changes.
   * 1 = default: only the primary sort starts fresh pages (sections).
   * 2 = primary AND secondary sort each begin their own page.
   * N = the first N sort levels break pages; the leaf (deepest active sort)
   *     never breaks — cards pack continuously within the deepest page.
   * Undefined/0/1 all resolve to the default: primary-only page breaks.
   * Ignored for manual-ordered binders.
   */
  pageBreakDepth?: number;
  lastReviewedSnapshot?: BinderReviewSnapshot;
  /** Scryfall printing id of the user-chosen cover card. Undefined = automatic
   *  cover (most valuable card). Routing/materialize never read it — it's
   *  mirrored here so the two BinderDef definitions stay in lockstep. */
  coverScryfallId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Page = array of card slots. nulls represent empty slots in a partial last page. */
export type Page = (EnrichedCard | null)[];

/**
 * A page within a section, tagged with its 1-based page number from the
 * unfiltered layout.
 */
export interface BinderPage {
  slots: Page;
  pageNum: number;
}

export interface BinderSection {
  key: string;
  label: string;
  /** Optional color-pip styling — populated only when grouping by color. */
  pip?: { background: string; border: string };
  cards: EnrichedCard[];
  pages: BinderPage[];
}

export interface MaterializedBinder {
  def: BinderDef;
  effectivePocketSize: PocketSize;
  effectiveSorts: SortEntry[];
  displaySorts: SortEntry[];
  sections: BinderSection[];
  totalCards: number;
  totalPages: number;
  totalValue: number;
}

export interface UncategorizedBucket {
  totalCards: number;
  sections: BinderSection[];
  totalPages: number;
  effectivePocketSize: PocketSize;
  effectiveSorts: SortEntry[];
  displaySorts: SortEntry[];
}

/** Scryfall set metadata, keyed by upper-case set code. */
export interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
}

export type SetMap = Record<string, SetSummary>;
