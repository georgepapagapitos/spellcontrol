export type Finish = 'nonfoil' | 'foil' | 'etched';

/** Normalized condition codes. Scryfall does not provide this — it is per-copy user data. */
export type Condition = 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';

/**
 * Normalized row produced by any parser. All fields except `name` and `quantity` are optional
 * because format coverage varies wildly:
 *   - ManaBox CSV has everything
 *   - Moxfield CSV has name/set/collectorNumber/finish/price but no Scryfall ID
 *   - MTGA-style text has name/set/collectorNumber but no price/finish/condition
 *   - Plain text has only name (and maybe a quantity prefix)
 *
 * The Scryfall enrichment step uses what's present to find the best match.
 */
export interface ImportRow {
  name: string;
  quantity: number;
  /** Set CODE (e.g. "CMR"), preferred. */
  setCode?: string;
  /** Set NAME (e.g. "Commander Legends"), kept if present but not used for lookup. */
  setName?: string;
  collectorNumber?: string;
  finish?: Finish;
  /** Normalized condition (nm/lp/mp/hp/damaged). Per-copy user data. */
  condition?: Condition;
  /** Lowercased Scryfall language code (en, ja, de, es, fr, it, pt, ru, ko, zhs, zht, ...). */
  language?: string;
  /** True when the user has flagged the physical card as altered (custom art, etc.). */
  altered?: boolean;
  /** True when the card is a proxy rather than a real printing. */
  proxy?: boolean;
  /** True when the user has flagged the physical card as a misprint. */
  misprint?: boolean;
  /** Direct Scryfall ID — when present, lookup is exact and free. */
  scryfallId?: string;
  /** Optional price (USD) from the source export. Falls back to Scryfall pricing if absent. */
  purchasePrice?: number;
  rarity?: string;
  /**
   * Original "category" label from the source (ManaBox binder name, Moxfield tag, etc).
   * Surfaced to users as a filterable hint via the rules engine.
   */
  sourceCategory?: string;
  /** Which parser produced this row — useful for debugging and for surfaced telemetry. */
  sourceFormat: ImportFormat;
  /** Section header the row appeared under (e.g. 'commander', 'sideboard'). */
  section?: string;
}

export type ImportFormat =
  | 'manabox'
  | 'archidekt'
  | 'moxfield'
  | 'deckbox'
  | 'generic-csv'
  | 'mtga'
  | 'plain'
  /** Cards materialized from an MTGJSON preconstructed-product decklist (T17). */
  | 'mtgjson';

export interface ParseResult {
  rows: ImportRow[];
  format: ImportFormat;
  /** Lines/rows that couldn't be parsed at all (malformed). Resolution failures handled later. */
  unparsedLines: string[];
  /**
   * Rows with an explicit quantity of 0 (a Deckbox/Moxfield wishlist or
   * tradelist-only entry) that were intentionally excluded rather than
   * imported as 1 copy. Not malformed — just unowned.
   */
  skippedUnownedRows: number;
}
