/**
 * Shared data types for the binder routing engine.
 *
 * This file is the single source of truth for BOTH the physical-card shape
 * (`EnrichedCard` and its `Finish`/`Condition` companions — re-exported by
 * frontend/src/types/index.ts and backend/src/types.ts rather than hand-copied;
 * see CLAUDE.md's game-core precedent, this used to be three independently-
 * maintained copies that drifted, board E205) AND the binder shapes
 * (BinderDef, BinderFilter, the sort/section/materialize types), which the
 * frontend re-exports the same way. Add or change a field here, once — there
 * is no second copy to keep in sync.
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
  /**
   * What the user actually PAID for this copy — cost basis, NOT market value
   * (`purchasePrice` above holds the current market price, restamped from a
   * device-local cache on the frontend). Sourced from an import file's
   * purchase-price column or typed in the edit dialog; never touched by a
   * price refresh. Only ever positive: `0` and absent both mean "no recorded
   * price" — see frontend `lib/cost-basis.ts` / backend `merge-card.ts`.
   */
  acquiredPrice?: number;
  /**
   * Display currency `acquiredPrice` was recorded in. Absent = USD.
   */
  acquiredCurrency?: string;
  /**
   * User-entered market-price override for THIS PHYSICAL COPY (E204) — for a
   * card Scryfall prices wrong or not at all (altered, signed, graded,
   * misprint, an obscure foreign printing). Replaces `purchasePrice`
   * everywhere market value is read: collection total, binder price rules,
   * price filters/sorts, value history/movers. Separate from `acquiredPrice`
   * (cost basis, what was paid) — neither field ever touches the other.
   * `undefined` means "use market price"; absent is never $0, exactly like
   * `acquiredPrice`. Applied at the single price-resolution chokepoint,
   * frontend `lib/card-prices.ts:applyPrices`, which is what makes it survive
   * every price refresh: the refresh writes fresh market data to the
   * device-local cache, but `applyPrices` never re-stamps `purchasePrice`
   * from that cache while an override is set. An explicit override also wins
   * over the proxy-zeroing default (`proxy: true` → $0) — a user's stated
   * value for a specific copy is more specific than a blanket default.
   */
  priceOverride?: number;
  /**
   * Display currency `priceOverride` was recorded in. Absent = USD (mirrors
   * `acquiredCurrency`). `applyPrices` applies the override only while this
   * matches the active display currency — there is no FX conversion in this
   * app (EUR prices are Cardmarket's own quote, not a USD conversion), so a
   * currency-mismatched override falls back to the real market price rather
   * than showing a wrong-currency number as if it were live. The override is
   * still shown as set-but-dormant rather than silently lost.
   */
  priceOverrideCurrency?: string;
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
  /**
   * Which Secret Lair *drop* this printing came from, e.g. 'Goblin Storm'.
   * Scryfall lumps every Secret Lair into the single flat `SLD` set with no
   * drop metadata, so this can't be derived from set fields — it comes from the
   * MTGJSON-built drop map. Like `tags`, this is reference data: NOT persisted
   * or synced, decorated onto cards by the caller just before materializing
   * (frontend `lib/sld-drops.ts`). When present it stands in for the card's set
   * everywhere the `setName` / `setReleaseDate` sorts look — the drop IS the set
   * for a Secret Lair. Absent on non-SLD cards, and on the handful of SLD
   * numbers MTGJSON doesn't cover; those keep the flat "Secret Lair Drop" set.
   */
  sldDrop?: string;
  /** YYYY-MM-DD release date of `sldDrop`, used to order drop sections. */
  sldDropReleasedAt?: string;
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
 * Pockets per *page* (one side of a physical sheet). A double-sided binder
 * stores `pocketSize × 2` cards per sheet, but in this app a "page" always
 * means one side — so totals, capacity, and slide counts all use this number
 * as the per-page divisor. See `doubleSided` on BinderDef for the sheet-level
 * metadata flag.
 */
export type PocketSize = 4 | 9 | 12;

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
 * `chips.length - 1` (no leading joiner on the first chip). The evaluator
 * (`compileExpression` in rules.ts) walks the chips with **AND binding
 * tighter than OR** — i.e. `a OR b AND c` reads as `a OR (b AND c)`,
 * matching standard boolean precedence.
 *
 * Coexists with the legacy `NegatableChip[]` shape; old fields keep
 * the old evaluator, new fields opt into this richer model.
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
   * (see commanders-core.ts:isCommanderEligible).
   */
  commanderEligible?: boolean;
  /**
   * Proxy constraint. undefined = no constraint; true = card must be flagged
   * `proxy`; false = must NOT be. Keeps real cards and proxies out of the same
   * physical binder.
   */
  proxy?: boolean;
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
 * `name` is an optional user-supplied label shown in the editor; the
 * materialize path doesn't read it.
 */
export interface BinderFilterGroup {
  name?: string;
  filter: BinderFilter;
}

/**
 * Snapshot of a binder's membership at the moment the user marked it reviewed.
 * `keys` is the full membership set (printingFinishKey); `cardSnapshots` pins
 * the volatile per-card fields so drift attribution can say "price went 6.20→4.80"
 * or "banned in Commander" instead of just "this card left". `legalities` holds
 * only the formats some binder rule references (see frontend
 * `binder-drift.ts:referencedLegalityFormats`) — never the full per-card map.
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
  /**
   * Permanent, owner-set fact (like `doubleSided`) — this binder's cards may
   * show up in a game night's trade board once the owner separately opts a
   * specific night in (a fresh, revocable per-attendee choice; see the
   * frontend's `GameNight.myTradeOptIn`). Absent/false = not tradeable;
   * setting this alone changes nothing visible to anyone. Routing/materialize
   * never read it — binder metadata that rides along like `color`.
   */
  tradeable?: boolean;
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
  /**
   * Flow sections onto shared pages instead of giving each its own.
   *
   * By default every section starts a fresh page, which is right for a dozen
   * big colour/type sections but ruinous for many small ones: 35 Secret Lair
   * drops of 1–7 cards burn 39 twelve-pocket pages to hold 199 cards. With
   * this on, consecutive sections are merged while their cards still fit the
   * same page, so a page can carry several drops — but a section is never
   * split across a page boundary, which is the property that actually matters
   * physically. Same binder: 19 pages instead of 39.
   *
   * Merged sections keep every original label (see `BinderSection.labels`) so
   * the header still names each drop on the page. Ignored for manual-ordered
   * binders and when there's no grouping (a single section can't be packed).
   *
   * `'continuous'` goes further: cards flow edge-to-edge with **no empty
   * pockets at all** (except the binder's final page) — a section may start
   * mid-page and spill onto the next. Sections then close only where the
   * running card count lands exactly on a page boundary, preserving the
   * sections-own-whole-pages invariant the render depends on. Built for
   * closed, finite groupings (Secret Lair drops) where reserving pockets for
   * growth is pure waste; the trade-off is that a later insertion shifts
   * every card after it. Older clients treat the unknown truthy value as
   * plain packing, so the field degrades gracefully.
   */
  packSections?: boolean | 'continuous';
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
   *  binder — see frontend `lib/binder-cover.ts`. Routing/materialize never
   *  read it. */
  coverScryfallId?: string;
  createdAt: number;
  updatedAt: number;
}

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
  /**
   * Distinct group labels physically present on this page, in slot order.
   * Set only for merged sections (`BinderDef.packSections`) covering more
   * than one group — where the section header alone can't say which of its
   * groups sits on which page. Absent everywhere else.
   */
  labels?: string[];
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
  /**
   * The individual group labels this section covers. Length > 1 only when
   * `BinderDef.packSections` merged several groups onto shared pages; `label`
   * is then their joined form. Renderers that want to chip each group
   * separately read this; everything else can keep using `label`.
   */
  labels?: string[];
  /**
   * Per-card group label, parallel to `cards`. Present only for merged
   * sections, so a single card can name the group it came from instead of
   * inheriting the whole joined run (a 40-drop Secret Lair section is
   * unreadable as one card's context line).
   */
  cardLabels?: string[];
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

/** Scryfall set metadata, keyed by upper-case set code. */
export interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
}

export type SetMap = Record<string, SetSummary>;
