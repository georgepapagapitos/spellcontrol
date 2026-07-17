export interface EnrichedCard {
  /**
   * Unique identifier for this physical card copy. Two copies of the same
   * printing (same scryfallId) get distinct copyIds so the allocation system
   * can track each one independently.
   */
  copyId: string;
  name: string;
  /**
   * Scryfall oracle_id — printing-agnostic card identity. Stable across reprints
   * and used as the join key against the combo dataset (Commander Spellbook).
   * Optional because cards saved before this field existed won't have one;
   * sync.ts backfills via /api/cards/oracle-ids on first hydration.
   */
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
   * Epoch ms this physical copy was last edited — created via quick-add, or
   * changed through the edit-card flow (printing/finish/quantity/condition).
   * Powers the collection "Last edited" sort. Optional: cards predating this
   * field (or imported, which doesn't stamp it) fall back to their import time.
   * NOT bumped by price refreshes (price is stripped off the synced row).
   */
  updatedAt?: number;
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
  /**
   * Hero-resolution front art (Scryfall `large`, 672×936) — only consumed by
   * the full-screen CardPreview so the desktop drawer can grow without
   * upscaling `normal`. Everything else (grids, binder pockets, thumbnails)
   * keeps using imageNormal. Absent on cards enriched before this field
   * existed; consumers must fall back to imageNormal.
   */
  imageLarge?: string;
  /** Back-face hero-resolution image, paired with imageLarge for two-sided layouts. */
  imageLargeBack?: string;
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
  /**
   * Scryfall oracle tags (otags) for this card, e.g. ['mana-rock', 'ramp'].
   * Reference data decorated onto cards at materialize time from the bundled
   * tagger snapshot (see `lib/card-tags.ts`) — NEVER persisted or synced (it's
   * derived from the card name). Absent until the snapshot loads.
   */
  tags?: string[];
}

/**
 * One entry in a List — a printing reference with no ownership link (no
 * copyId; on a want list the card is typically unowned, on a tracking list
 * it's cross-referenced against the collection by oracleId/name). Carries a
 * concrete printing (defaults to the latest on add, editable via
 * CardEditDialog). Inert to deck/combo logic.
 */
export interface ListEntry {
  id: string;
  name: string;
  scryfallId: string;
  setCode: string;
  collectorNumber: string;
  finish: Finish;
  /** Printing-agnostic identity, used for the "you own N" match. */
  oracleId?: string;
  quantity: number;
  note?: string;
  /** Optional per-entry target price (display only; no automation). */
  targetPrice?: number;
  /**
   * Currency `targetPrice` was entered in. Absent = USD (entries predating
   * EUR support). Rendered as-entered for every viewer — never converted —
   * so a €5 target reads "€5" to a USD-display friend, not a relabeled "$5".
   */
  currency?: 'USD' | 'EUR';
}

/** What a manually-curated (static) list is for — see {@link ListDef.kind}. */
export type ListKind = 'want' | 'tracking';

/**
 * A user-defined list of cards. Rides inside StoredCollection (synced with
 * the collection blob).
 */
export interface ListDef {
  id: string;
  name: string;
  entries: ListEntry[];
  order: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Purpose of a static list. Absent = `'want'` (cards to acquire — feeds the
   * friend-hub trade radar and the cost-to-complete stat). `'tracking'` = a
   * hand-curated catalogue of cards the user owns (e.g. eligible commanders
   * split across binders) — excluded from trade/acquisition surfaces.
   * Not meaningful for dynamic lists (`rule` set), which are owned by
   * construction.
   */
  kind?: ListKind;
  /**
   * When set, this is a **dynamic list**: membership is computed live from the
   * collection with the binder rule engine (OR of groups), `entries` stays
   * empty, and the manual add/edit/share flows don't apply. Same shape as a
   * binder's `filterGroups`, cleaned via `cleanFilter` on save.
   */
  rule?: BinderFilterGroup[];
}

/**
 * A parsed import row the server withheld because Scryfall couldn't be reached.
 * Only `name`/`quantity` are read for display — the object carries the full
 * parsed row and is POSTed back verbatim on retry so printing/finish survive.
 */
export interface FetchErrorRow {
  name: string;
  quantity?: number;
}

export interface UploadResponse {
  cards: EnrichedCard[];
  totalRows: number;
  scryfallHits: number;
  scryfallMisses: number;
  unresolvedNames: string[];
  /** Rows withheld because the card service was unreachable — retryable, NOT imported. */
  fetchErrors: FetchErrorRow[];
  /** Raw lines the parser couldn't turn into a row at all — never resolved, never counted. */
  malformedRows: string[];
  /** Rows with an explicit quantity of 0 (wishlist/tradelist-only entries) skipped rather than imported as 1 copy. */
  skippedUnownedRows: number;
  /** Rows whose quantity exceeded the per-row cap and was clamped down to it. */
  clampedRows: number;
  detectedFormat: string;
}

export interface DeckImportResponse {
  commander: import('@/deck-builder/types').ScryfallCard | null;
  companion: import('@/deck-builder/types').ScryfallCard | null;
  cards: import('@/deck-builder/types').ScryfallCard[];
  unresolvedNames: string[];
  /** Names skipped because the card service was unreachable — retry re-runs the import. */
  fetchErrors: string[];
  detectedFormat: string;
  cardCount: number;
}

/** A known MTG product (preconstructed deck, etc.) from the MTGJSON catalog (T17). */
export interface ProductSummary {
  fileName: string;
  code: string;
  name: string;
  type: string;
  releaseDate: string;
}

/** Compact commander preview for lazy enrichment of product search rows (T17). */
export interface ProductCommanderSummary {
  name: string;
  colorIdentity: string[];
  /** Full small card image URL — rendered as a card-shaped row thumbnail. */
  image: string | null;
}

/**
 * One physical card in a product, with per-copy quantity + finish + zone — for
 * stamping owned copies and showing a per-zone breakdown.
 */
export interface ProductPhysicalCard {
  card: import('@/deck-builder/types').ScryfallCard;
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
  /** Every physical card in the box, finish-accurate — for "add to the collection". */
  physicalCards: ProductPhysicalCard[];
  unresolvedNames: string[];
  /** Names skipped because the card service was unreachable — retry by re-resolving the product. */
  fetchErrors: string[];
  /** True physical card count across every zone (playable + extras). */
  physicalCardCount: number;
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
  // Collection-only import-date sort (see binder-routing SortField); kept in sync
  // with the canonical union in `@spellcontrol/binder-routing`.
  | 'dateAdded'
  // Collection-only last-edit sort (see binder-routing SortField); kept in sync.
  | 'dateEdited';

export type SortDir = 'asc' | 'desc';

export interface SortEntry {
  field: SortField;
  dir: SortDir;
}

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
 * Flat chip-expression with explicit joiners between chips. Powers the
 * Manabox-style "Creature AND Land OR Sorcery" filter rows.
 *
 * `joiners[i]` connects `chips[i]` to `chips[i+1]`; length is exactly
 * `chips.length - 1` (no leading joiner on the first chip). The
 * evaluator (`compileExpression` in lib/rules) walks the chips with
 * **AND binding tighter than OR** — i.e. `a OR b AND c` reads as
 * `a OR (b AND c)`, matching standard boolean precedence.
 *
 * Coexists with the legacy `NegatableChip[]` shape; old fields keep
 * the old evaluator, new fields opt into this richer model.
 */
export interface ChipExpression {
  chips: NegatableChip[];
  joiners: ('AND' | 'OR')[];
}

/**
 * Single filter set per binder. All fields AND together; empty fields impose no constraint.
 */
export interface BinderFilter {
  /** Legality chips. Within an AND-group: every IS must be legal, no IS NOT may be. */
  legalities?: ChipExpression;
  colors?: ChipExpression;
  /** Rarity chips. Exact match (no substring). */
  rarities?: ChipExpression;
  cmcMin?: number;
  cmcMax?: number;
  /** Exact match on mana cost string e.g. "{2}{G}{W}" (case-insensitive, whitespace-trimmed). */
  manaCost?: string;
  /** Type-line chips. Substring match. */
  typeChips?: ChipExpression;
  /** Primary card types. Exact-token match against parsed types, e.g. Creature, Instant. */
  typeTokenChips?: ChipExpression;
  /** Supertype chips. Exact-token match against parsed supertypes (e.g. "Legendary", "Basic"). */
  supertypeChips?: ChipExpression;
  /** Subtype chips. Substring match against joined subtypes (e.g. "Angel", "Equipment"). */
  subtypeChips?: ChipExpression;
  /** Oracle-text chips. Substring match. */
  oracleChips?: ChipExpression;
  /** Scryfall oracle-tag chips (e.g. "mana-rock"). Set-membership match against card.tags. */
  oracleTagChips?: ChipExpression;
  setCodes?: string[];
  priceMin?: number;
  priceMax?: number;
  /** Finish chips. Tests against the card's available finishes set. */
  finishes?: ChipExpression;
  /** Layout chips. Exact match. */
  layouts?: ChipExpression;
  /** Substring match on card name (case-insensitive). */
  nameContains?: string;
  /** EDHREC popularity threshold. Card matches if its edhrec_rank ≤ this number. */
  edhrecRankMax?: number;
  /** Treatment chips. 'fullart' is special-cased. */
  treatments?: ChipExpression;
  /** Border chips. Exact match on borderColor. */
  borderColors?: ChipExpression;
  /**
   * Commander-eligibility constraint. undefined = no constraint;
   * true = card must be commander-eligible; false = must NOT be.
   * "Commander-eligible" = legendary creature OR oracle text contains
   * "can be your commander", AND legal/restricted in Commander
   * (see lib/commanders.ts:isCommanderEligible).
   */
  commanderEligible?: boolean;
  /**
   * A Scryfall search query (e.g. "is:shockland") snapshot-resolved to oracle
   * ids. Scryfall's curated filters can't be evaluated offline, so the editor
   * resolves the query against the live API once and stores `oracleIds`;
   * matching is plain `card.oracleId` membership. Mirrors the authoritative
   * definition in @spellcontrol/binder-routing.
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
  sorts: SortEntry[];
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
  /** 'rules' (default): filterGroups drive routing; pins are exceptions.
   *  'manual': only pinned cards appear; filterGroups are preserved but ignored. */
  mode?: 'rules' | 'manual';
  /** copyIds manually added to this binder. Claimed before rule routing so they
   *  don't land in other binders. Undefined = no pinned cards.
   *  Derived: re-resolved from `pinnedKeys` against the live collection on every
   *  collection change. This is the array materialize consumes. */
  pinnedCopyIds?: string[];
  /** Durable natural-key shadow of `pinnedCopyIds` (printingFinishKey per pin,
   *  same length & order, multiplicity preserved). copyIds are regenerated on
   *  every import, so the key — not the copyId — is the persisted source of
   *  truth that lets pins survive a collection round-trip (re-upload after a
   *  cache/sync loss). Undefined on binders created before this existed; it is
   *  backfilled on the next reconcile while the old copyIds still resolve. */
  pinnedKeys?: string[];
  /** copyIds manually excluded from this binder even if rules match them.
   *  Undefined = no exclusions. Derived from `excludedKeys`, like pinnedCopyIds. */
  excludedCopyIds?: string[];
  /** Durable natural-key shadow of `excludedCopyIds`. See `pinnedKeys`. */
  excludedKeys?: string[];
  /** When set, explicit card order overrides the binder's sort fields.
   *  Cards not in this list (new additions) are appended at the end.
   *  Undefined = use auto-sort (existing behavior).
   *  Derived: re-resolved from `manualKeys` against the live collection on
   *  every collection change, exactly like `pinnedCopyIds`. This is the array
   *  materialize consumes. */
  manualOrder?: string[];
  /** Durable natural-key shadow of `manualOrder` (printingFinishKey per slot,
   *  same length & order, multiplicity preserved). copyIds are regenerated on
   *  every import, so the key — not the copyId — is the persisted source of
   *  truth that lets a hand-arranged order survive a collection round-trip
   *  (re-upload after a cache/sync loss). Undefined on binders created before
   *  this existed or with no manual order; backfilled on the next reconcile
   *  while the old copyIds still resolve. See `pinnedKeys`. */
  manualKeys?: string[];
  /** When false, cards allocated to any deck are excluded from this binder's
   *  view and membership entirely (no fallback binder, no Uncategorized).
   *  Pin/exclusion/manualOrder metadata is preserved — cards return when the
   *  deck releases them. Undefined/true = current behavior (include them). */
  hideDeckAllocated?: boolean;
  /** Per-field custom orderings for sort values (e.g. treatment, finish).
   *  Each entry is the canonical key list in user-preferred order. Fields not
   *  present fall back to the built-in default order. */
  sortValueOrders?: Partial<Record<SortField, string[]>>;
  /** When true, a card that matches this binder's rules via ANY owned copy
   *  pulls in ALL the user's owned copies of that card (grouped by Scryfall
   *  oracleId), instead of only the printings whose per-printing attributes
   *  (price/finish/set/treatment) matched. Promotion reclaims copies from
   *  Uncategorized only — copies already routed to another binder keep
   *  first-match-wins precedence. Undefined/false = per-copy routing
   *  (existing behavior). Ignored for manual-mode binders.
   *  See `materializeBinders`. */
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
  /** Captured each time the user clicks "Mark reviewed" on this binder. The
   *  next view diffs current membership against this snapshot and surfaces
   *  added/removed cards — so volatile fields (price, EDHREC rank) silently
   *  shifting membership become visible instead of invisible drift.
   *  Keyed by `printingFinishKey` (durable across the copyId regeneration
   *  that happens on every re-import). Undefined = never reviewed yet. */
  lastReviewedSnapshot?: BinderReviewSnapshot;
  /** Scryfall printing id of the user-chosen cover card ("Set cover" in the
   *  card preview). Undefined = automatic cover: the binder's most valuable
   *  card. The override only holds while a matching copy is still in the
   *  binder — see `lib/binder-cover.ts`. */
  coverScryfallId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Snapshot of a binder's membership at the moment the user marked it reviewed.
 * `keys` is the full membership set (printingFinishKey); `cardSnapshots` pins
 * the volatile per-card fields so drift attribution can say "price went 6.20→4.80"
 * instead of just "this card left".
 */
export interface BinderReviewSnapshot {
  at: number;
  keys: string[];
  cardSnapshots: Record<string, { price: number; edhrecRank?: number }>;
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
  /** Sort chain actually applied (includes implicit tie-breakers). */
  effectiveSorts: SortEntry[];
  /** Sort chain suitable for breadcrumb display — implicit tie-breakers at
   *  their default value-order are stripped so the label reflects the user's
   *  intent without clutter. */
  displaySorts: SortEntry[];
  sections: BinderSection[];
  totalCards: number;
  totalPages: number;
  /** Sum of purchasePrice across every card — a Scryfall-snapshot
   *  approximation (cards with no/stale price contribute 0). */
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
