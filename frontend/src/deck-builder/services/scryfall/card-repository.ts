import type { ScryfallCard, ScryfallSearchResponse } from '@/deck-builder/types';

/**
 * The card-data access surface, abstracted over its backing source.
 *
 * SpellControl resolves cards two ways: a **live** path that hits the Scryfall
 * API, and an **offline** path that reads a local IndexedDB oracle store (the
 * native app's only data source when there's no backend reachable). These two
 * paths used to be an `if (offlineActive())` fork *inside* every fetch
 * function, which meant any change — a new filter, a bug fix — had to be made
 * twice and one branch was reliably forgotten (see the art-series leak).
 *
 * Now there is exactly one fork: `getCardRepository()` picks an implementation
 * once. Both implementations satisfy this interface and are held to a single
 * shared contract test (`card-repository.contract.test.ts`), so a fix applied
 * to one path that's missing from the other fails CI by construction.
 */
export interface CardRepository {
  /** Commanders matching a free-text query, EDHREC-ordered. */
  searchCommanders(query: string): Promise<ScryfallCard[]>;

  /** Scryfall-syntax card search, scoped to a color identity. */
  searchCards(
    query: string,
    colorIdentity: string[],
    options?: CardSearchOptions
  ): Promise<ScryfallSearchResponse>;

  /**
   * Resolve a single card by (case-insensitive) name. Throws if not found.
   * `arenaOnly` (E271) prefers a printing on MTG Arena over the cheapest
   * paper one — offline ignores it (no per-printing `games` data).
   */
  getCardByName(name: string, arenaOnly?: boolean): Promise<ScryfallCard>;

  /** Batch-resolve cards by name. Missing names are simply absent from the map. */
  getCardsByNames(
    names: string[],
    onProgress?: CardFetchProgress,
    preferredSet?: string,
    opts?: GetCardsByNamesOptions
  ): Promise<Map<string, ScryfallCard>>;

  /**
   * Replace cards in `cards` in-place with printings matching `scryfallQuery`'s
   * treatment filters (is:full-art, frame:*). Set filters are ignored here.
   * When `strict`, cards with no matching printing are removed from the map.
   */
  upgradeCardPrintings(
    cards: Map<string, ScryfallCard>,
    scryfallQuery: string,
    strict?: boolean
  ): Promise<void>;

  /** Names of all cards Scryfall flags `is:gamechanger`. */
  getGameChangerNames(): Promise<Set<string>>;

  /** Names of all cards banned in the given format. */
  getBanList(format: string): Promise<string[]>;

  /** Autocomplete suggestions for a partial card name. */
  autocompleteCardName(query: string): Promise<string[]>;

  /**
   * Cards whose oracle text grants a copy-limit exception
   * ("a deck can have any number / up to N cards named ..."),
   * mapped to their max copies (null = unlimited).
   */
  fetchMultiCopyCardNames(): Promise<Map<string, number | null>>;
}

export interface CardSearchOptions {
  // 'released' (newest first) surfaces brand-new cards that edhrec_rank buries —
  // used by the land merit-widen (E116). Passed straight through to Scryfall's
  // ?order= param on the live path.
  order?: 'edhrec' | 'cmc' | 'name' | 'released';
  page?: number;
  skipFormatFilter?: boolean;
  skipColorFilter?: boolean;
}

/** Progress callback for batch fetches: `(fetched, total)`. */
export type CardFetchProgress = (fetched: number, total: number) => void;

export interface GetCardsByNamesOptions {
  /**
   * Live path only. After the batched `/cards/collection` pass, cards whose
   * default printing carries no nonfoil USD price are re-fetched ONE request
   * each (`unique=prints`, cheapest first) to sharpen the price. Analysis
   * callers that resolve ~100 EDHREC recommendations pass `false`: that tail
   * is what earns a 429 (100 requests at Scryfall's 10/s ceiling) and it only
   * refines prices the cost plan can also live without. Default `true`.
   */
  priceTail?: boolean;

  /**
   * Live path only. Prefer a printing on MTG Arena over the cheapest paper
   * one (E271) — the batch `/cards/collection` endpoint can't filter by game,
   * so this post-processes any name whose returned printing lacks 'arena'
   * through the arena-preferred single-name search. Offline ignores this (no
   * per-printing `games` data). Default `false`.
   */
  arenaOnly?: boolean;

  /**
   * Which currency's cheapest printing the dump lookup picks per name, and
   * which cache key the result lives under (E522). Omit for the USD default;
   * an EUR viewer hunting for savings passes 'eur' so a printing cheaper only
   * in EUR is found and never leaks into a USD lookup.
   */
  currency?: 'usd' | 'eur';
}
