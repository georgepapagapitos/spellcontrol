/**
 * Normalized row produced by any parser. All fields except `name` and `quantity` are optional
 * because format coverage varies wildly:
 *   - ManaBox CSV has everything
 *   - Moxfield CSV has name/set/collectorNumber/foil/price but no Scryfall ID
 *   - MTGA-style text has name/set/collectorNumber but no price/foil/condition
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
  foil?: boolean;
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
}

export type ImportFormat =
  | 'manabox'
  | 'archidekt'
  | 'moxfield'
  | 'deckbox'
  | 'generic-csv'
  | 'mtga'
  | 'plain';

export interface ParseResult {
  rows: ImportRow[];
  format: ImportFormat;
  /** Lines/rows that couldn't be parsed at all (malformed). Resolution failures handled later. */
  unparsedLines: string[];
}
