/**
 * The binder/collection type layer. The canonical declarations for the
 * physical-card shape (`EnrichedCard`, `Finish`, `Condition`), the sort types,
 * and every binder shape (`BinderDef`, `BinderFilter`, the section/materialize
 * types) live in `@spellcontrol/binder-routing` — re-exported here rather than
 * hand-copied so frontend/backend/routing-engine can't drift out of lockstep
 * the way they did before (board E205; the hand-mirrored copies surfaced a
 * missing field as an opaque "MaterializedBinder is not assignable to
 * MaterializedBinder" error). See that package's `src/types.ts` for the full
 * field-by-field documentation. Adding a binder-type field is a single edit
 * there. This file declares only frontend-specific types (lists, import/upload
 * responses, filter-chip unions).
 */
import type {
  BinderDef,
  BinderFilter,
  BinderFilterGroup,
  BinderPage,
  BinderReviewSnapshot,
  BinderSection,
  ChipExpression,
  Condition,
  EnrichedCard,
  Finish,
  MaterializedBinder,
  NegatableChip,
  Page,
  PocketSize,
  ScryfallQueryRule,
  SortDir,
  SortEntry,
  SortField,
  UncategorizedBucket,
} from '@spellcontrol/binder-routing';
export type {
  BinderDef,
  BinderFilter,
  BinderFilterGroup,
  BinderPage,
  BinderReviewSnapshot,
  BinderSection,
  ChipExpression,
  Condition,
  EnrichedCard,
  Finish,
  MaterializedBinder,
  NegatableChip,
  Page,
  PocketSize,
  ScryfallQueryRule,
  SortDir,
  SortEntry,
  SortField,
  UncategorizedBucket,
};

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
  /** Format sideboard rows ("Sideboard" header). Absent/empty when the input had none. */
  sideboard?: import('@/deck-builder/types').ScryfallCard[];
  /** "Maybeboard" header rows — park-candidates (E122), routed to the deck's Considering zone. */
  considering?: import('@/deck-builder/types').ScryfallCard[];
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

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';

export type ColorChoice = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'M';

/**
 * Treatment / frame effect on a printing. "fullart" is special-cased to also
 * include older lands where Scryfall sets `full_art: true` but leaves
 * frame_effects empty.
 */
export type Treatment = 'fullart' | 'extendedart' | 'showcase' | 'etched' | 'inverted';

export type BorderColor = 'black' | 'white' | 'borderless' | 'silver' | 'gold';

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

export type BinderInput = Omit<BinderDef, 'id' | 'createdAt' | 'updatedAt'>;
