import { logger } from '@/lib/logger';
import type { ScryfallCard, ScryfallSearchResponse } from '@/deck-builder/types';
import type { CardRepository, CardSearchOptions, CardFetchProgress } from './card-repository';
import { getPartnerType, getPartnerWithName } from '@/deck-builder/lib/partnerUtils';
import { offlineGetCardByName, offlineGetCardsByNames, offlineSearchCards } from '@/lib/offline';
import { offlineDataAvailable, useOfflineStore } from '@/store/offline';
import { frontFaceName } from '@/lib/card-text';

/**
 * Cheap synchronous gate used to short-circuit every Scryfall call when the
 * local oracle store has been populated. Reads zustand state outside React —
 * same pattern the sync module uses for collection/decks stores.
 */
function offlineActive(): boolean {
  try {
    return offlineDataAvailable(useOfflineStore.getState());
  } catch {
    return false;
  }
}

const BASE_URL = import.meta.env.DEV ? '/scryfall-api' : 'https://api.scryfall.com';
const MIN_REQUEST_DELAY = 100; // 100ms between requests (Scryfall allows 10/sec)
const MAX_429_RETRIES = 4; // cap 429 retries so a sustained throttle fails instead of hanging
const BASE_429_BACKOFF_MS = 1000;
const COLLECTION_BATCH_SIZE = 75; // Scryfall /cards/collection max per request

// In-memory cache for fetched cards
const cardCache = new Map<string, ScryfallCard>();

// In-memory cache for search results (used by fillWithScryfall fallbacks)
const searchCache = new Map<string, { data: ScryfallSearchResponse; timestamp: number }>();
const SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Extract a set code from a scryfallQuery string.
 * Recognizes: set:xxx, s:xxx, e:xxx, edition:xxx (with or without quotes).
 */
export function parseSetFromQuery(scryfallQuery: string): string | undefined {
  if (!scryfallQuery) return undefined;
  const match = scryfallQuery.match(/\b(?:set|s|e|edition):["']?([a-zA-Z0-9_]+)["']?/i);
  return match ? match[1].toLowerCase() : undefined;
}

// Scryfall layouts that aren't real game pieces (art cards, tokens, emblems, etc.).
// These can sneak in via /cards/collection with a set preference or via the
// `unique=prints` upgrade search when a treatment filter (e.g. is:full-art) matches
// an art-series printing — they have legalities.commander === 'not_legal' and would
// otherwise be flagged after the deck is generated.
const NON_PLAYABLE_LAYOUTS = new Set([
  'art_series',
  'token',
  'double_faced_token',
  'emblem',
  'scheme',
  'planar',
  'vanguard',
]);

export function isPlayableCard(card: ScryfallCard): boolean {
  return !card.layout || !NON_PLAYABLE_LAYOUTS.has(card.layout);
}

/** Return a shallow copy with deck-generation flags stripped so cached objects stay clean. */
function freshCopy(card: ScryfallCard): ScryfallCard {
  const {
    isMustInclude: _mi,
    isGameChanger: _gc,
    isThemeSynergyCard: _ts,
    deckRole: _dr,
    isMdfcLand: _mdfc,
    ...clean
  } = card;
  return clean;
}

/**
 * Queue-based rate limiter that ensures requests are properly spaced.
 * All Scryfall requests MUST go through this to prevent 429 errors.
 */
class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;
  private lastRequestTime = 0;

  /**
   * Wait for permission to make a request.
   * Returns a promise that resolves when it's safe to send.
   */
  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_REQUEST_DELAY - timeSinceLastRequest)
        );
      }

      this.lastRequestTime = Date.now();
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }

    this.processing = false;
  }

  // Alias for backwards compatibility
  async throttle(): Promise<void> {
    return this.acquire();
  }
}

const rateLimiter = new RateLimiter();

async function scryfallFetch<T>(endpoint: string, attempt = 0): Promise<T> {
  await rateLimiter.throttle();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      // Rate limited — honor Retry-After if present, else exponential backoff.
      // Capped (MAX_429_RETRIES) so a sustained throttle throws instead of
      // recursing forever and hanging deck generation.
      const retryAfter = Number(response.headers.get('Retry-After'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : BASE_429_BACKOFF_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return scryfallFetch<T>(endpoint, attempt + 1);
    }
    throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function liveSearchCommanders(query: string): Promise<ScryfallCard[]> {
  if (!query.trim()) return [];
  try {
    const encodedQuery = encodeURIComponent(`is:commander f:commander ${query}`);
    const response = await scryfallFetch<ScryfallSearchResponse>(
      `/cards/search?q=${encodedQuery}&order=edhrec`
    );
    return response.data;
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return [];
    throw err;
  }
}

async function offlineSearchCommanders(query: string): Promise<ScryfallCard[]> {
  if (!query.trim()) return [];
  const resp = await offlineSearchCards(`is:commander ${query}`, { order: 'edhrec' });
  return resp.data;
}

export async function searchCommanders(query: string): Promise<ScryfallCard[]> {
  return getCardRepository().searchCommanders(query);
}

async function liveSearchCards(
  query: string,
  colorIdentity: string[],
  options: CardSearchOptions = {}
): Promise<ScryfallSearchResponse> {
  const { order = 'edhrec', page = 1, skipFormatFilter = false, skipColorFilter = false } = options;

  // Empty colorIdentity means "unrestricted" here — generic surfaces
  // (collection add, lists, scanner, binder-rule preview) pass [] with no
  // commander in sight, and an implicit `id<=c` fallback turned every one of
  // them colorless-only (prod regression: searching "bolas's citadel" while
  // adding to the collection 404'd). Callers that DO mean "colorless
  // commander" say so explicitly via commanderSearchIdentity().
  const colorFilter =
    !skipColorFilter && colorIdentity.length > 0 ? `id<=${colorIdentity.join('')}` : '';
  const formatFilter = skipFormatFilter ? '' : 'f:commander';
  // Wrap query in parentheses so color filter applies to entire query (including OR clauses)
  const fullQuery = `${colorFilter} (${query}) ${formatFilter}`;
  const encodedQuery = encodeURIComponent(fullQuery.trim());

  // Check search cache first
  const cacheKey = `${encodedQuery}|${order}|${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    return cached.data;
  }

  const result = await scryfallFetch<ScryfallSearchResponse>(
    `/cards/search?q=${encodedQuery}&order=${order}&page=${page}`
  );

  searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

function offlineSearchCardsImpl(
  query: string,
  colorIdentity: string[],
  options: CardSearchOptions = {}
): Promise<ScryfallSearchResponse> {
  const { order = 'edhrec', page = 1, skipFormatFilter = false, skipColorFilter = false } = options;
  return offlineSearchCards(query, {
    colorIdentity,
    // The offline slim catalog has no release-date index (and carries no
    // brand-new cards anyway), so 'released' is meaningless here — fall back to
    // edhrec order. The merit-widen that needs 'released' is a live-data path.
    order: order === 'released' ? 'edhrec' : order,
    page,
    skipFormatFilter,
    skipColorFilter,
  });
}

export async function searchCards(
  query: string,
  colorIdentity: string[],
  options: CardSearchOptions = {}
): Promise<ScryfallSearchResponse> {
  return getCardRepository().searchCards(query, colorIdentity, options);
}

/**
 * A commander's color identity as a search filter. A colorless commander
 * (Kozilek, the Great Distortion) has `color_identity: []`, which searchCards
 * treats as "no color filter" — that gap once let Omniscience ({U}{U}{U}) into
 * a colorless deck via scryfallFill, which has no client-side identity check.
 * Deck-generation call sites route their commander identity through this so
 * colorless becomes an explicit `id<=C` (the offline parser handles it too:
 * 'C' parses to the empty WUBRG set, matching only colorless cards).
 */
export function commanderSearchIdentity(colorIdentity: string[]): string[] {
  return colorIdentity.length > 0 ? colorIdentity : ['C'];
}

/**
 * Search always against the live Scryfall API, regardless of offline-bundle
 * availability. The alternative-generator previews (art motif / era) use
 * operators (art:, year<=) the offline query parser can't evaluate, so they
 * must bypass the offline repository even when it would otherwise be active.
 */
export async function searchCardsLive(
  query: string,
  colorIdentity: string[],
  options: CardSearchOptions = {}
): Promise<ScryfallSearchResponse> {
  // `wrappedLive`/`withPlayableFilter`/`liveCardRepository` are declared further
  // down the module; that's safe because this function only runs at call time,
  // long after the module has finished evaluating and they're initialized.
  wrappedLive ??= withPlayableFilter(liveCardRepository);
  return wrappedLive.searchCards(query, colorIdentity, options);
}

/**
 * Pauper Commander (PDH) commander search — ALWAYS live. Eligibility is
 * derived (any creature with an uncommon printing; Scryfall dropped the
 * restricted=commander convention, so there is no `f:` / `is:` query for it),
 * and the offline query parser has no rarity clause. `unique:cards` keeps a
 * printing that MATCHES the query, so results come back as uncommon printings
 * — the same thing `isPdhCommanderEligible` validates on the stored card.
 */
export async function searchPdhCommanders(query: string): Promise<ScryfallCard[]> {
  if (!query.trim()) return [];
  try {
    const response = await searchCardsLive(`t:creature r:uncommon ${query}`, [], {
      skipFormatFilter: true,
      order: 'edhrec',
    });
    return response.data;
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return [];
    throw err;
  }
}

/**
 * Random PDH-eligible commander from the live API ("Surprise me" in PDH mode).
 * `colorIdentity` is an EXACT identity match when non-empty (mirrors the
 * EDHREC surprise-me behavior); `['C']` means colorless.
 */
export async function getRandomPdhCommander(colorIdentity: string[] = []): Promise<ScryfallCard> {
  const idClause = colorIdentity.length > 0 ? ` id=${colorIdentity.join('').toLowerCase()}` : '';
  return scryfallFetch<ScryfallCard>(
    `/cards/random?q=${encodeURIComponent(`t:creature r:uncommon${idClause}`)}`
  );
}

async function liveGetCardByName(name: string, exact = true): Promise<ScryfallCard> {
  const cached = cardCache.get(name);
  if (cached) return freshCopy(cached);

  const param = exact ? 'exact' : 'fuzzy';
  const encodedName = encodeURIComponent(name);
  const card = await scryfallFetch<ScryfallCard>(`/cards/named?${param}=${encodedName}`);

  // `/cards/named` returns Scryfall's DEFAULT printing, which can be foil-only
  // (e.g. a Secret Lair: usd:null, usd_foil:"89.28"). Callers treat this as the
  // cheapest printing for deck/market pricing, so when the default lacks a nonfoil
  // USD price, fall back to the price-ordered search (same cheapest-nonfoil
  // resolution the batch path uses). Only fires for foil-only defaults.
  if (!card.prices?.usd) {
    const cheapest = await fetchCardByNameThrottled(card.name);
    if (cheapest?.prices?.usd) {
      cardCache.set(name, cheapest);
      cardCache.set(cheapest.name, cheapest);
      return freshCopy(cheapest);
    }
  }

  cardCache.set(card.name, card);
  return freshCopy(card);
}

async function offlineGetCardByNameImpl(name: string): Promise<ScryfallCard> {
  const cached = cardCache.get(name);
  if (cached) return freshCopy(cached);

  const card = await offlineGetCardByName(name);
  if (!card || !isPlayableCard(card)) {
    // A non-playable hit means the offline name index resolved to an art card
    // shadowing the real one (poisoned pre-#304 bulk). Treat it as a miss and
    // don't cache it — resolved for good once the client re-syncs.
    throw new Error(`Card "${name}" not found in offline data.`);
  }
  cardCache.set(card.name, card);
  return freshCopy(card);
}

export async function getCardByName(name: string, exact = true): Promise<ScryfallCard> {
  return getCardRepository().getCardByName(name, exact);
}

/**
 * Fetch a single card by its exact Scryfall printing id (live API only).
 *
 * `getCardByName` resolves to the cheapest nonfoil printing — fine for deck
 * cards, wrong when the *specific* printing matters (an owned commander the
 * user picked from their collection). This hits `/cards/:id`, preserving the
 * printing's id/set/finishes so downstream allocation binds the exact copy.
 *
 * Offline has no by-printing index (the slim oracle store keeps one printing
 * per oracle), so this is live-only; offline callers go through
 * `getOwnedPrinting`, which degrades to name resolution + an id override.
 */
export async function getCardById(id: string): Promise<ScryfallCard> {
  const cached = cardCache.get(id);
  if (cached) return freshCopy(cached);

  const card = await scryfallFetch<ScryfallCard>(`/cards/${encodeURIComponent(id)}`);
  if (!isPlayableCard(card)) {
    throw new Error(
      `Card id "${id}" resolved to a non-playable ${card.layout ?? 'unknown'} printing.`
    );
  }
  cardCache.set(card.id, card);
  return freshCopy(card);
}

/**
 * Resolve the full card for the *specific* printing the user owns — used when
 * selecting a commander from one's collection so the deck reflects the physical
 * copy (printing + finish), not the cheapest printing.
 *
 * Live: `/cards/:id` returns the exact printing. Offline (or if the id is
 * unknown to Scryfall — data drift): resolve by name for complete oracle data,
 * then override the result's `id` with the owned printing so the allocator
 * still binds the owned copy (`pickCollectionCopy` keys on `card.id`, and
 * `DeckDisplay` sources image/finish from the allocated copy).
 */
export async function getOwnedPrinting(scryfallId: string, name: string): Promise<ScryfallCard> {
  if (!offlineActive()) {
    try {
      return await getCardById(scryfallId);
    } catch {
      // Fall through to name resolution + id override (printing unknown to
      // Scryfall — stale collection data, withdrawn printing, etc.).
    }
  }
  const card = await getCardByName(name, true);
  return { ...card, id: scryfallId };
}

/**
 * Fetch a single card by name with proper rate limiting.
 * Returns null if not found instead of throwing.
 */
async function fetchCardByNameThrottled(name: string, retries = 2): Promise<ScryfallCard | null> {
  try {
    await rateLimiter.acquire();

    // Search for cheapest USD paper printing across all sets
    // Filter out digital-only printings and require a USD price
    const searchQuery = encodeURIComponent(`!"${name}" -is:digital`);
    const response = await fetch(
      `${BASE_URL}/cards/search?q=${searchQuery}&unique=prints&order=usd&dir=asc`,
      { headers: { Accept: 'application/json' } }
    );

    if (response.ok) {
      const searchResult = (await response.json()) as ScryfallSearchResponse;
      const playable = searchResult.data.filter(isPlayableCard);
      if (playable.length > 0) {
        // Prefer a printing with a normal USD price, then any price, then first result
        const card =
          playable.find((c) => c.prices?.usd) ||
          playable.find((c) => getCardPrice(c)) ||
          playable[0];
        cardCache.set(name, card);
        // Also cache under Scryfall's canonical name if different
        if (card.name !== name) cardCache.set(card.name, card);
        return card;
      }
    }

    if (response.status === 429 && retries > 0) {
      const backoffMs = 1000 * (3 - retries);
      logger.warn(`[Scryfall] Rate limited, backing off ${backoffMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return fetchCardByNameThrottled(name, retries - 1);
    }

    // Fallback to /cards/named if search returned no results (name mismatch, etc.)
    if (response.status === 404) {
      await rateLimiter.acquire();
      const namedResponse = await fetch(
        `${BASE_URL}/cards/named?exact=${encodeURIComponent(name)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!namedResponse.ok) return null;
      const card = (await namedResponse.json()) as ScryfallCard;
      if (!isPlayableCard(card)) return null;
      cardCache.set(card.name, card);
      return card;
    }

    return null;
  } catch {
    return null;
  }
}

/** Split requested names into already-cached results and the names still to fetch. */
function partitionCachedCards(
  names: string[],
  preferredSet?: string
): { result: Map<string, ScryfallCard>; uncachedNames: string[] } {
  const result = new Map<string, ScryfallCard>();
  const uncachedNames: string[] = [];
  for (const name of names) {
    // When a preferred set is specified, use a composite cache key.
    const cacheKey = preferredSet ? `${name}|${preferredSet}` : name;
    const cached = cardCache.get(cacheKey);
    if (cached) result.set(name, freshCopy(cached));
    else uncachedNames.push(name);
  }
  return { result, uncachedNames };
}

/**
 * Offline batch resolve: walk the local oracle store. `preferredSet` is ignored
 * — the slim payload keeps one representative printing per oracle, and that
 * degradation is acceptable for offline mode.
 */
async function offlineGetCardsByNamesImpl(
  names: string[],
  onProgress?: CardFetchProgress
): Promise<Map<string, ScryfallCard>> {
  const { result, uncachedNames } = partitionCachedCards(names);
  if (uncachedNames.length === 0) return result;

  const found = await offlineGetCardsByNames(uncachedNames);
  for (const [name, card] of found) {
    // Skip poisoned pre-#304 offline rows so they never enter the cache or result.
    if (!isPlayableCard(card)) continue;
    cardCache.set(name, card);
    result.set(name, freshCopy(card));
    if (card.name.includes(' // ')) {
      const front = frontFaceName(card.name);
      result.set(front, freshCopy(card));
      cardCache.set(front, card);
    }
  }
  onProgress?.(uncachedNames.length, uncachedNames.length);
  return result;
}

/**
 * Live batch fetch via Scryfall's /cards/collection endpoint.
 * Fetches up to 75 cards per request, drastically reducing API calls vs individual lookups.
 */
async function liveGetCardsByNames(
  names: string[],
  onProgress?: CardFetchProgress,
  preferredSet?: string
): Promise<Map<string, ScryfallCard>> {
  if (names.length === 0) return new Map();

  const { result, uncachedNames } = partitionCachedCards(names, preferredSet);
  if (uncachedNames.length === 0) return result;

  logger.debug(
    `[Scryfall] Fetching ${uncachedNames.length} cards via /cards/collection${preferredSet ? ` (set: ${preferredSet})` : ''}...`
  );

  // Track names not found in the preferred set for a fallback pass
  const setNotFoundNames: string[] = [];

  // Use Scryfall's /cards/collection endpoint (up to 75 per request)
  for (let i = 0; i < uncachedNames.length; i += COLLECTION_BATCH_SIZE) {
    const batch = uncachedNames.slice(i, i + COLLECTION_BATCH_SIZE);
    const identifiers = preferredSet
      ? batch.map((name) => ({ name, set: preferredSet }))
      : batch.map((name) => ({ name }));

    await rateLimiter.acquire();

    try {
      const response = await fetch(`${BASE_URL}/cards/collection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ identifiers }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          data: ScryfallCard[];
          not_found: Array<{ name?: string; set?: string }>;
        };
        for (const card of data.data) {
          if (!isPlayableCard(card)) continue;
          const cacheKey = preferredSet ? `${card.name}|${preferredSet}` : card.name;
          cardCache.set(cacheKey, card);
          if (!preferredSet) cardCache.set(card.name, card); // also cache under plain name when no set preference
          const copy = freshCopy(card);
          result.set(card.name, copy);
          // For DFCs, also store under front-face name so EDHREC lookups match
          if (card.name.includes(' // ')) {
            const frontFace = frontFaceName(card.name);
            result.set(frontFace, copy);
            if (preferredSet) cardCache.set(`${frontFace}|${preferredSet}`, card);
            else cardCache.set(frontFace, card);
          }
        }
        if (data.not_found.length > 0) {
          if (preferredSet) {
            // Collect not-found names for fallback pass without set constraint
            for (const nf of data.not_found) {
              if (nf.name) setNotFoundNames.push(nf.name);
            }
          } else {
            logger.warn(`[Scryfall] ${data.not_found.length} cards not found in collection batch`);
          }
        }
      } else if (response.status === 429) {
        // Rate limited - back off and retry this batch
        logger.warn('[Scryfall] Rate limited on collection fetch, backing off...');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        i -= COLLECTION_BATCH_SIZE; // retry this batch
        continue;
      }
    } catch (err) {
      logger.warn('[Scryfall] Collection batch failed:', err);
    }

    onProgress?.(Math.min(i + COLLECTION_BATCH_SIZE, uncachedNames.length), uncachedNames.length);
  }

  // Fallback pass: re-fetch cards not found in the preferred set without set constraint
  if (preferredSet && setNotFoundNames.length > 0) {
    logger.debug(
      `[Scryfall] ${setNotFoundNames.length} cards not in set "${preferredSet}", re-fetching without set constraint...`
    );
    for (let i = 0; i < setNotFoundNames.length; i += COLLECTION_BATCH_SIZE) {
      const batch = setNotFoundNames.slice(i, i + COLLECTION_BATCH_SIZE);
      const identifiers = batch.map((name) => ({ name }));

      await rateLimiter.acquire();

      try {
        const response = await fetch(`${BASE_URL}/cards/collection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ identifiers }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            data: ScryfallCard[];
            not_found: Array<{ name?: string }>;
          };
          for (const card of data.data) {
            if (!isPlayableCard(card)) continue;
            cardCache.set(card.name, card);
            const copy = freshCopy(card);
            result.set(card.name, copy);
            if (card.name.includes(' // ')) {
              const frontFace = frontFaceName(card.name);
              result.set(frontFace, copy);
              cardCache.set(frontFace, card);
            }
          }
        } else if (response.status === 429) {
          logger.warn('[Scryfall] Rate limited on fallback collection fetch, backing off...');
          await new Promise((resolve) => setTimeout(resolve, 1500));
          i -= COLLECTION_BATCH_SIZE;
          continue;
        }
      } catch (err) {
        logger.warn('[Scryfall] Fallback collection batch failed:', err);
      }
    }
  }

  // Re-fetch cards that came back with no NONFOIL price (e.g. unreleased reprints,
  // or a default printing that's foil-only like a Secret Lair). We gate on
  // `prices.usd` specifically, NOT getCardPrice() — the latter falls back to
  // usd_foil, so a $1 common whose default printing only has a $89 foil price
  // would look "priced" and skip the cheapest-nonfoil re-fetch below.
  // Skip when user specified a preferred set — they want that set's printing, not the cheapest
  if (!preferredSet) {
    const noPriceNames = uncachedNames.filter((name) => {
      const card = result.get(name);
      return card && !card.prices?.usd;
    });
    if (noPriceNames.length > 0) {
      logger.debug(
        `[Scryfall] Re-fetching ${noPriceNames.length} cards with no price for older printings...`
      );
      for (const name of noPriceNames) {
        const card = await fetchCardByNameThrottled(name);
        if (card && getCardPrice(card)) {
          cardCache.set(name, card);
          result.set(name, freshCopy(card));
        }
      }
    }
  }

  // For any names not found via collection, try individual fallback
  const notFound = uncachedNames.filter((name) => !result.has(name));
  if (notFound.length > 0) {
    logger.debug(`[Scryfall] Retrying ${notFound.length} not-found cards individually...`);
    for (const name of notFound) {
      const card = await fetchCardByNameThrottled(name);
      if (card) {
        result.set(name, freshCopy(card));
      }
    }
  }

  logger.debug(`[Scryfall] Batch fetch complete: ${result.size} cards found`);
  return result;
}

export async function getCardsByNames(
  names: string[],
  onProgress?: CardFetchProgress,
  preferredSet?: string
): Promise<Map<string, ScryfallCard>> {
  return getCardRepository().getCardsByNames(names, onProgress, preferredSet);
}

const UPGRADE_BATCH_SIZE = 15; // Card names per search query for printing upgrades

/**
 * Offline upgrade: a no-op. The slim payload stores one representative printing
 * per oracle, so we can't upgrade to a specific frame/treatment — cards keep
 * their default printing. Strict mode also degrades to a no-op since we can't
 * reliably detect "no matching printing exists" without the data.
 */
async function offlineUpgradeCardPrintings(): Promise<void> {
  /* intentionally empty — see doc comment */
}

/**
 * Upgrade card printings in a map to match non-set Scryfall filters (e.g. is:full-art, frame:extendedart).
 * Searches for matching printings in batches and replaces entries in-place.
 * Set-based filters (set:xxx) are stripped since those are handled by getCardsByNames.
 * When strict=true, cards without a matching printing are REMOVED from the map.
 */
async function liveUpgradeCardPrintings(
  cards: Map<string, ScryfallCard>,
  scryfallQuery: string,
  strict: boolean = false
): Promise<void> {
  if (!scryfallQuery) return;

  // Strip set filters — already handled by getCardsByNames' preferredSet
  const filters = scryfallQuery
    .replace(/\b(?:set|s|e|edition):["']?[a-zA-Z0-9_]+["']?/gi, '')
    .trim();
  if (!filters) return;

  // Collect card names, using front-face name for DFCs in search queries
  const entries: { searchName: string; mapKey: string }[] = [];
  for (const [key, card] of cards) {
    const searchName = frontFaceName(card.name);
    entries.push({ searchName, mapKey: key });
  }

  if (entries.length === 0) return;

  logger.debug(
    `[Scryfall] Upgrading printings for ${entries.length} cards with filters: ${filters}${strict ? ' (strict)' : ''}`
  );
  const cacheKeyPrefix = `upgrade|${filters}|`;
  let upgraded = 0;
  const matchedKeys = new Set<string>();

  for (let i = 0; i < entries.length; i += UPGRADE_BATCH_SIZE) {
    const batch = entries.slice(i, i + UPGRADE_BATCH_SIZE);

    // Check cache first and separate cached vs uncached
    const uncached: typeof batch = [];
    for (const entry of batch) {
      const cached = cardCache.get(`${cacheKeyPrefix}${entry.searchName}`);
      if (cached) {
        cards.set(entry.mapKey, freshCopy(cached));
        matchedKeys.add(entry.mapKey);
        upgraded++;
      } else {
        uncached.push(entry);
      }
    }

    if (uncached.length === 0) continue;

    // Build OR query: (!"Card1" OR !"Card2" OR ...) <filters>
    const nameQuery = uncached.map((e) => `!"${e.searchName}"`).join(' OR ');
    const fullQuery = `(${nameQuery}) ${filters}`;
    const encodedQuery = encodeURIComponent(fullQuery);

    await rateLimiter.acquire();

    try {
      const response = await fetch(
        `${BASE_URL}/cards/search?q=${encodedQuery}&unique=prints&order=released&dir=desc`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (response.ok) {
        const data = (await response.json()) as ScryfallSearchResponse;
        // Build a name -> first matching card map (most recent printing first due to order=released desc).
        // Skip art-series and other non-playable layouts — `unique=prints` includes them,
        // and they often match treatment filters like is:full-art / frame:extendedart.
        const matchMap = new Map<string, ScryfallCard>();
        for (const card of data.data) {
          if (!isPlayableCard(card)) continue;
          const frontName = frontFaceName(card.name);
          if (!matchMap.has(card.name) && !matchMap.has(frontName)) {
            matchMap.set(card.name, card);
            if (frontName !== card.name) matchMap.set(frontName, card);
          }
        }

        // Replace matching cards in the result map and cache them
        for (const entry of uncached) {
          const match =
            matchMap.get(entry.searchName) ?? matchMap.get(cards.get(entry.mapKey)?.name ?? '');
          if (match) {
            cardCache.set(`${cacheKeyPrefix}${entry.searchName}`, match);
            cards.set(entry.mapKey, freshCopy(match));
            matchedKeys.add(entry.mapKey);
            // Also update front-face key if it exists
            if (match.name.includes(' // ')) {
              const frontFace = frontFaceName(match.name);
              if (cards.has(frontFace)) {
                cards.set(frontFace, freshCopy(match));
                matchedKeys.add(frontFace);
              }
            }
            upgraded++;
          }
        }
      }
      // 404 = no results for this batch, not an error — just means no matching printings
    } catch {
      // Search failed, skip this batch — cards keep their default printings
    }
  }

  // In strict mode, remove cards that had no matching printing
  if (strict) {
    const removed: string[] = [];
    for (const entry of entries) {
      if (!matchedKeys.has(entry.mapKey)) {
        cards.delete(entry.mapKey);
        removed.push(entry.searchName);
      }
    }
    if (removed.length > 0) {
      logger.debug(
        `[Scryfall] Strict filter removed ${removed.length} cards with no "${filters}" printing`
      );
    }
  }

  if (upgraded > 0) {
    logger.debug(`[Scryfall] Upgraded ${upgraded}/${entries.length} cards to match "${filters}"`);
  }
}

export async function upgradeCardPrintings(
  cards: Map<string, ScryfallCard>,
  scryfallQuery: string,
  strict: boolean = false
): Promise<void> {
  return getCardRepository().upgradeCardPrintings(cards, scryfallQuery, strict);
}

/**
 * Pre-cache basic lands for faster deck generation.
 * Call this once at the start of deck generation.
 */
export async function prefetchBasicLands(): Promise<void> {
  const basicLands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];

  // Check if already cached
  const uncached = basicLands.filter((name) => !cardCache.has(name));
  if (uncached.length === 0) return;

  await getCardsByNames(uncached);
}

/**
 * Get a cached card if available (for basic lands).
 */
export function getCachedCard(name: string): ScryfallCard | undefined {
  const cached = cardCache.get(name);
  return cached ? freshCopy(cached) : undefined;
}

/**
 * Official Commander Game Changers list (Feb 9, 2026 — 53 cards).
 * Used as the offline fallback when is:gamechanger cannot be queried live.
 * Update when the RC publishes a new list and the live query is reachable to verify.
 * Canonical names must match Scryfall exactly (commas in "Narset, Parter of Veils" etc.).
 */
const HARDCODED_GAME_CHANGERS: ReadonlySet<string> = new Set([
  // White
  'Drannith Magistrate',
  'Enlightened Tutor',
  'Farewell',
  'Humility',
  "Serra's Sanctum",
  'Smothering Tithe',
  "Teferi's Protection",
  // Blue
  'Consecrated Sphinx',
  'Cyclonic Rift',
  'Fierce Guardianship',
  'Force of Will',
  'Gifts Ungiven',
  'Intuition',
  'Mystical Tutor',
  'Narset, Parter of Veils',
  'Rhystic Study',
  "Thassa's Oracle",
  // Black
  'Ad Nauseam',
  "Bolas's Citadel",
  'Braids, Cabal Minion',
  'Demonic Tutor',
  'Imperial Seal',
  'Necropotence',
  'Opposition Agent',
  'Orcish Bowmasters',
  'Tergrid, God of Fright',
  'Vampiric Tutor',
  // Red
  'Gamble',
  "Jeska's Will",
  'Underworld Breach',
  // Green
  'Biorhythm',
  'Crop Rotation',
  "Gaea's Cradle",
  'Natural Order',
  'Seedborn Muse',
  'Survival of the Fittest',
  'Worldly Tutor',
  // Multicolor
  'Aura Shards',
  'Coalition Victory',
  'Grand Arbiter Augustin IV',
  'Notion Thief',
  // Colorless / Lands
  'Ancient Tomb',
  'Chrome Mox',
  'Field of the Dead',
  'Glacial Chasm',
  'Grim Monolith',
  "Lion's Eye Diamond",
  'Mana Vault',
  "Mishra's Workshop",
  'Mox Diamond',
  'Panoptic Mirror',
  'The One Ring',
  'The Tabernacle at Pendrell Vale',
]);

// Cached set of game changer card names from Scryfall
let gameChangerNamesCache: Set<string> | null = null;
let gameChangerCacheTimestamp = 0;
const GC_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Live fetch of all `is:gamechanger` card names from Scryfall, paginated.
 */
async function liveGetGameChangerNames(): Promise<Set<string>> {
  if (gameChangerNamesCache && Date.now() - gameChangerCacheTimestamp < GC_CACHE_TTL) {
    return gameChangerNamesCache;
  }

  const names = new Set<string>();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await scryfallFetch<ScryfallSearchResponse>(
        `/cards/search?q=${encodeURIComponent('is:gamechanger')}&page=${page}`
      );
      for (const card of response.data) {
        names.add(card.name);
        // For DFCs, also index by front face so EDHREC name lookups match
        if (card.name.includes(' // ')) {
          names.add(frontFaceName(card.name));
        }
      }
      hasMore = response.has_more;
      page++;
    } catch {
      break;
    }
  }

  if (names.size === 0) {
    // First-page network failure → fall back to hardcoded list so the live path
    // also degrades gracefully rather than zeroing the GC floor.
    logger.debug('[Scryfall] GC live fetch returned empty; using hardcoded fallback');
    gameChangerNamesCache = new Set(HARDCODED_GAME_CHANGERS);
  } else {
    // Union: hardcoded list as a floor so mid-TTL RC additions aren't silently lost.
    // Live Scryfall wins on any overlap (same card name = same value anyway).
    gameChangerNamesCache = new Set([...HARDCODED_GAME_CHANGERS, ...names]);
  }
  gameChangerCacheTimestamp = Date.now();
  logger.debug(`[Scryfall] Cached ${gameChangerNamesCache.size} game changer card names`);
  return gameChangerNamesCache;
}

/**
 * Offline game-changer names: seeded from the hardcoded Feb 2026 RC list so
 * native/offline users get correct GC floors without a network call.
 */
async function offlineGetGameChangerNames(): Promise<Set<string>> {
  if (gameChangerNamesCache && Date.now() - gameChangerCacheTimestamp < GC_CACHE_TTL) {
    return gameChangerNamesCache;
  }
  // Seed from the hardcoded Feb 2026 RC list so native/offline users get
  // correct GC floors without a network call.
  gameChangerNamesCache = new Set(HARDCODED_GAME_CHANGERS);
  gameChangerCacheTimestamp = Date.now();
  return gameChangerNamesCache;
}

export async function getGameChangerNames(): Promise<Set<string>> {
  return getCardRepository().getGameChangerNames();
}

// Cached ban list results by format
const banListCache = new Map<string, { names: string[]; timestamp: number }>();
const BAN_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Live fetch of all cards banned in a given format, paginated.
 */
async function liveGetBanList(format: string): Promise<string[]> {
  const cached = banListCache.get(format);
  if (cached && Date.now() - cached.timestamp < BAN_CACHE_TTL) {
    return cached.names;
  }

  const names: string[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await scryfallFetch<ScryfallSearchResponse>(
        `/cards/search?q=${encodeURIComponent(`banned:${format}`)}&unique=cards&order=name&page=${page}`
      );
      for (const card of response.data) {
        names.push(card.name);
      }
      hasMore = response.has_more;
      page++;
    } catch {
      break;
    }
  }

  banListCache.set(format, { names, timestamp: Date.now() });
  return names;
}

/**
 * Offline ban list: walk the local oracle store and pluck rows where the
 * format's legality is "banned". Single pass, no pagination.
 */
async function offlineGetBanList(format: string): Promise<string[]> {
  const cached = banListCache.get(format);
  if (cached && Date.now() - cached.timestamp < BAN_CACHE_TTL) {
    return cached.names;
  }
  const resp = await offlineSearchCards(`banned:${format}`, {
    skipFormatFilter: true,
    skipColorFilter: true,
    order: 'name',
  });
  const names = resp.data.map((c) => c.name);
  banListCache.set(format, { names, timestamp: Date.now() });
  return names;
}

/**
 * Fetch all cards banned in a given format.
 */
export async function getBanList(format: string): Promise<string[]> {
  return getCardRepository().getBanList(format);
}

/** Convenience alias for commander ban list */
export async function getCommanderBanList(): Promise<string[]> {
  return getBanList('commander');
}

async function liveAutocompleteCardName(query: string): Promise<string[]> {
  if (!query.trim() || query.length < 2) return [];
  const encodedQuery = encodeURIComponent(query);
  const response = await scryfallFetch<{ data: string[] }>(`/cards/autocomplete?q=${encodedQuery}`);
  return response.data;
}

/**
 * Offline autocomplete: local prefix-and-contains match against the oracle
 * store. Prefixes rank above substring hits, capped at 20 so the dropdown
 * stays tight.
 */
async function offlineAutocompleteCardName(query: string): Promise<string[]> {
  if (!query.trim() || query.length < 2) return [];
  const lower = query.toLowerCase();
  const resp = await offlineSearchCards(lower, {
    skipFormatFilter: true,
    skipColorFilter: true,
    order: 'name',
  });
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const card of resp.data) {
    const lc = card.name.toLowerCase();
    if (lc.startsWith(lower)) prefix.push(card.name);
    else if (lc.includes(lower)) contains.push(card.name);
    if (prefix.length >= 20) break;
  }
  return [...prefix, ...contains].slice(0, 20);
}

export async function autocompleteCardName(query: string): Promise<string[]> {
  return getCardRepository().autocompleteCardName(query);
}

// Helper to get image URL with fallback for double-faced cards
export function getCardImageUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string {
  if (card.image_uris) {
    return card.image_uris[size];
  }

  // Double-faced card - use front face
  if (card.card_faces && card.card_faces[0]?.image_uris) {
    return card.card_faces[0].image_uris[size];
  }

  // Fallback placeholder
  return 'https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000000.jpg';
}

/**
 * Get the best available USD price for a card.
 * Falls back through: usd → usd_foil → usd_etched → eur → eur_foil
 * Returns the price string or null if no price is available.
 */
// Non-snow basics only — deliberately NOT the canonical land-identity set in
// lib/allocations. Snow-Covered basics carry a real market price, so they must
// fall through to their actual `prices`, not the $0.05 basic floor below.
const ZERO_PRICE_BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

export function getCardPrice(card: ScryfallCard, currency: 'USD' | 'EUR' = 'USD'): string | null {
  if (ZERO_PRICE_BASICS.has(card.name)) return '0.05';
  const p = card.prices;
  if (currency === 'EUR')
    return p?.eur || p?.eur_foil || p?.usd || p?.usd_foil || p?.usd_etched || null;
  return p?.usd || p?.usd_foil || p?.usd_etched || p?.eur || p?.eur_foil || null;
}

// Get the front face type_line for a card.
// MDFCs have type_line like "Instant // Land" — this returns only "Instant" (the front face).
export function getFrontFaceTypeLine(card: ScryfallCard): string {
  if (card.card_faces && card.card_faces.length >= 2 && card.card_faces[0]?.type_line) {
    return card.card_faces[0].type_line;
  }
  return card.type_line || '';
}

// Check if a card is double-faced (has separate face images)
export function isDoubleFacedCard(card: ScryfallCard): boolean {
  return (
    !card.image_uris &&
    !!card.card_faces &&
    card.card_faces.length >= 2 &&
    !!card.card_faces[0]?.image_uris &&
    !!card.card_faces[1]?.image_uris
  );
}

// Check if a card is a Modal Double-Faced Card with a land on the back face.
// Spell/land MDFCs like "Jwari Disruption // Jwari Ruins" (Instant // Land) can be
// played as either face from hand — they're effectively spells that double as lands.
// Excludes: pathway lands (Land // Land), transform DFCs, split cards.
export function isMdfcLand(card: ScryfallCard): boolean {
  if (!card.card_faces || card.card_faces.length < 2) return false;
  // Primary check: use layout field from Scryfall API
  if (card.layout && card.layout !== 'modal_dfc') return false;
  // Fallback for missing layout: require combined type_line pattern
  if (!card.layout && !card.type_line?.includes(' // ')) return false;
  const frontType = card.card_faces[0].type_line?.toLowerCase() ?? '';
  const backType = card.card_faces[1].type_line?.toLowerCase() ?? '';
  return !frontType.includes('land') && backType.includes('land');
}

// The 5 Kamigawa: Neon Dynasty channel lands — legendary lands with Channel abilities.
// These are format staples: lands that double as spells via discard, with no downside.
export const CHANNEL_LANDS: Record<string, string> = {
  'Boseiju, Who Endures': 'G',
  'Otawara, Soaring City': 'U',
  'Eiganjo, Seat of the Empire': 'W',
  'Takenuma, Abandoned Mire': 'B',
  'Sokenzan, Crucible of Defiance': 'R',
};

/** Check if a card is one of the 5 Kamigawa channel lands. */
export function isChannelLand(card: ScryfallCard): boolean {
  return card.name in CHANNEL_LANDS;
}

/** Get channel lands that match a given color identity. */
export function getChannelLandsForColors(
  colorIdentity: string[]
): { name: string; color: string }[] {
  return Object.entries(CHANNEL_LANDS)
    .filter(([, color]) => colorIdentity.includes(color))
    .map(([name, color]) => ({ name, color }));
}

// Search Scryfall for MDFC spell/lands matching a commander's color identity.
// Returns ALL cards where front face is a spell and back face is a land.
// Paginates through all results so nothing is missed.
export async function searchMdfcLands(colorIdentity: string[]): Promise<ScryfallCard[]> {
  const query = 'is:mdfc t:land';
  const allCards: ScryfallCard[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await searchCards(query, colorIdentity, { order: 'edhrec', page });
    allCards.push(...result.data);
    hasMore = result.has_more;
    page++;
  }

  return allCards.filter((card) => isMdfcLand(card));
}

// Get back face image URL for a double-faced card
export function getCardBackFaceUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string | null {
  if (!isDoubleFacedCard(card)) return null;
  return card.card_faces![1].image_uris![size] ?? null;
}

/**
 * Search for valid partner commanders based on the primary commander's partner type
 */
export async function searchValidPartners(
  commander: ScryfallCard,
  searchQuery = ''
): Promise<ScryfallCard[]> {
  const partnerType = getPartnerType(commander);

  if (partnerType === 'none') {
    return [];
  }

  let query: string;

  switch (partnerType) {
    case 'partner':
      // Generic Partner - find other commanders with Partner keyword
      // Exclude "Partner with X" and "Friends forever" (Scryfall lumps them all under keyword:partner)
      query = `is:commander f:commander keyword:partner -o:"Partner with" -o:"Friends forever"`;
      break;

    case 'partner-with': {
      // Partner with X - fetch the specific card
      const partnerName = getPartnerWithName(commander);
      if (!partnerName) return [];
      try {
        const partner = await getCardByName(partnerName, true);
        return partner ? [partner] : [];
      } catch {
        return [];
      }
    }

    case 'friends-forever':
      // Friends forever - find other commanders with Friends forever in oracle text
      // Scryfall returns keyword:Partner for these, so we must use oracle text search
      query = `is:commander f:commander o:"Friends forever"`;
      break;

    case 'choose-background':
      // Choose a Background - find Background enchantments
      query = `t:background`;
      break;

    case 'background':
      // Background - find commanders with "Choose a Background"
      query = `is:commander f:commander o:"Choose a Background"`;
      break;

    case 'doctors-companion':
      // Doctor's Companion - find Doctor creatures that are commanders
      query = `is:commander f:commander t:doctor`;
      break;

    case 'doctor':
      // Doctor - find creatures with Doctor's companion keyword
      query = `is:commander f:commander keyword:"Doctor's companion"`;
      break;

    default:
      return [];
  }

  // Add user search query if provided
  if (searchQuery.trim()) {
    query = `${query} ${searchQuery}`;
  }

  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await scryfallFetch<ScryfallSearchResponse>(
      `/cards/search?q=${encodedQuery}&order=edhrec`
    );

    // Filter out the commander itself from results
    return response.data.filter((card) => card.name !== commander.name);
  } catch {
    return [];
  }
}

// Word-to-number mapping for parsing "up to seven" style caps
const WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

// Cached result so we only query Scryfall once per session
let multiCopyCardsCache: Map<string, number | null> | null = null;

/** Parse a copy-limit phrase from oracle text into a map entry. */
function recordMultiCopy(result: Map<string, number | null>, name: string, oracleText: string) {
  const oracle = oracleText.toLowerCase();
  // "a deck can have any number of cards named X" → unlimited
  if (oracle.includes('any number of cards named')) {
    result.set(name, null);
    return;
  }
  // "a deck can have up to seven cards named X" → parse the number
  const capMatch = oracle.match(/a deck can have up to (\w+) cards named/);
  if (capMatch) {
    const num = WORD_TO_NUMBER[capMatch[1]] ?? parseInt(capMatch[1], 10);
    result.set(name, isNaN(num) ? null : num);
  }
}

async function liveFetchMultiCopyCardNames(): Promise<Map<string, number | null>> {
  if (multiCopyCardsCache) return multiCopyCardsCache;
  const result = new Map<string, number | null>();
  try {
    const encodedQuery = encodeURIComponent('o:"a deck can have" f:commander');
    const response = await scryfallFetch<ScryfallSearchResponse>(
      `/cards/search?q=${encodedQuery}&unique=cards`
    );
    for (const card of response.data) {
      recordMultiCopy(
        result,
        card.name,
        card.oracle_text || card.card_faces?.[0]?.oracle_text || ''
      );
    }
  } catch (error) {
    logger.warn('[Scryfall] Failed to fetch multi-copy card list:', error);
  }
  multiCopyCardsCache = result;
  return result;
}

async function offlineFetchMultiCopyCardNames(): Promise<Map<string, number | null>> {
  if (multiCopyCardsCache) return multiCopyCardsCache;
  const result = new Map<string, number | null>();
  const resp = await offlineSearchCards('o:"a deck can have"', { skipColorFilter: true });
  for (const card of resp.data) {
    recordMultiCopy(result, card.name, card.oracle_text || card.card_faces?.[0]?.oracle_text || '');
  }
  multiCopyCardsCache = result;
  return result;
}

/**
 * Fetches all cards with "a deck can have any number/up to N" oracle text.
 * Returns a map of card name → maxCopies (null = unlimited).
 * Results are cached for the session — only one lookup ever made.
 */
export async function fetchMultiCopyCardNames(): Promise<Map<string, number | null>> {
  return getCardRepository().fetchMultiCopyCardNames();
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository assembly — the ONLY live/offline fork
//
// Every exported card-fetch function above delegates to `getCardRepository()`.
// That function is the single point where the live-vs-offline decision is made,
// replacing what used to be an `if (offlineActive())` branch inside each
// function (where a fix applied to one branch reliably missed the other — see
// the art-series leak). Both implementations satisfy `CardRepository` and are
// held to one shared contract test.
// ─────────────────────────────────────────────────────────────────────────────

/** Live implementation — hits the Scryfall API. */
export const liveCardRepository: CardRepository = {
  searchCommanders: liveSearchCommanders,
  searchCards: liveSearchCards,
  getCardByName: liveGetCardByName,
  getCardsByNames: liveGetCardsByNames,
  upgradeCardPrintings: liveUpgradeCardPrintings,
  getGameChangerNames: liveGetGameChangerNames,
  getBanList: liveGetBanList,
  autocompleteCardName: liveAutocompleteCardName,
  fetchMultiCopyCardNames: liveFetchMultiCopyCardNames,
};

/** Offline implementation — reads the local IndexedDB oracle store. */
export const offlineCardRepository: CardRepository = {
  searchCommanders: offlineSearchCommanders,
  searchCards: offlineSearchCardsImpl,
  getCardByName: offlineGetCardByNameImpl,
  getCardsByNames: offlineGetCardsByNamesImpl,
  upgradeCardPrintings: offlineUpgradeCardPrintings,
  getGameChangerNames: offlineGetGameChangerNames,
  getBanList: offlineGetBanList,
  autocompleteCardName: offlineAutocompleteCardName,
  fetchMultiCopyCardNames: offlineFetchMultiCopyCardNames,
};

/**
 * Wrap a repository so non-playable layouts (art cards, tokens, emblems, ...)
 * can never escape *any* card-returning method. This is the single enforcement
 * point for `isPlayableCard` — applied identically to both implementations, so
 * a filter can no longer be half-applied to one path. Methods that return
 * names/strings rather than card objects pass through untouched.
 */
export function withPlayableFilter(repo: CardRepository): CardRepository {
  return {
    getGameChangerNames: repo.getGameChangerNames,
    getBanList: repo.getBanList,
    autocompleteCardName: repo.autocompleteCardName,
    fetchMultiCopyCardNames: repo.fetchMultiCopyCardNames,

    async searchCommanders(query) {
      return (await repo.searchCommanders(query)).filter(isPlayableCard);
    },
    async searchCards(query, colorIdentity, options) {
      const res = await repo.searchCards(query, colorIdentity, options);
      return { ...res, data: res.data.filter(isPlayableCard) };
    },
    async getCardByName(name, exact) {
      const card = await repo.getCardByName(name, exact);
      if (!isPlayableCard(card)) {
        throw new Error(
          `Card "${name}" resolved to a non-playable ${card.layout ?? 'unknown'} printing.`
        );
      }
      return card;
    },
    async getCardsByNames(names, onProgress, preferredSet) {
      const map = await repo.getCardsByNames(names, onProgress, preferredSet);
      for (const [key, card] of map) {
        if (!isPlayableCard(card)) map.delete(key);
      }
      return map;
    },
    async upgradeCardPrintings(cards, scryfallQuery, strict) {
      await repo.upgradeCardPrintings(cards, scryfallQuery, strict);
      for (const [key, card] of cards) {
        if (!isPlayableCard(card)) cards.delete(key);
      }
    },
  };
}

let wrappedLive: CardRepository | null = null;
let wrappedOffline: CardRepository | null = null;

/**
 * The single live/offline fork. Returns the playable-filtered repository for
 * the current mode. Selection is per-call because offline data can finish
 * downloading mid-session; the wrapped repos are memoized so the wrapper isn't
 * rebuilt on every card fetch.
 */
// When set, every card fetch routes to the live API regardless of offline-bundle
// availability. The alternative generators (oracle-role / art-theme / historical)
// use Scryfall operators the offline query parser can't evaluate (otag:, arttag:,
// year<=) — on a device with the offline bundle downloaded, routing those searches
// offline would silently return the wrong cards. The generator sets this for the
// duration of a non-EDHREC build and clears it in a finally.
// ponytail: module-global, fine because generation is single-flight (one user-
// initiated build at a time); make it a counter if concurrent builds ever land.
let forceLive = false;
export function setForceLiveSearch(value: boolean): void {
  forceLive = value;
}

export function getCardRepository(): CardRepository {
  if (offlineActive() && !forceLive) {
    wrappedOffline ??= withPlayableFilter(offlineCardRepository);
    return wrappedOffline;
  }
  wrappedLive ??= withPlayableFilter(liveCardRepository);
  return wrappedLive;
}

/** Cap an offline IDB read: while the bulk cache is mid-ingest the store is
 *  write-locked and a read can *stall* (not throw) for a long time, which would
 *  hang any awaiter (e.g. the carousel's resolve → an infinite spinner). Past
 *  this many ms we abandon the offline read and fall through to the live path. */
const OFFLINE_READ_TIMEOUT_MS = 3000;

/** Reject `p` if it hasn't settled within `ms` — used to bound a possibly-stalled
 *  offline read so resolution can fall back to live instead of hanging forever. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('offline-read-timeout')), ms)),
  ]);
}

/**
 * Resolve a card by name offline-first, with a live fallback — and never throw.
 *
 * The offline oracle store can be *incomplete* (first-run bulk download still in
 * flight) or simply not carry a given name (the slim payload keeps one printing
 * per oracle), in which case the offline path throws — OR, while the bulk cache
 * is ingesting, an offline read can *stall* under the write lock. Both cases are
 * handled: the offline read is time-capped, and on miss/throw/timeout — when the
 * device is online — we retry the lookup against the live Scryfall API. This keeps
 * name-only consumers (chiefly the card-preview carousel, which re-resolves thin
 * EDHREC/synergy rows by name) from dead-ending or hanging on a card the offline
 * store can't (yet) resolve. Returns null only when both paths miss, so callers
 * can surface one "couldn't load" affordance instead of catching throws.
 *
 * When offline mode is inactive the primary path already IS live, so a miss is
 * terminal (no pointless second live call, no timeout needed).
 */
export async function getCardByNameResilient(
  name: string,
  exact = true,
  offlineTimeoutMs = OFFLINE_READ_TIMEOUT_MS
): Promise<ScryfallCard | null> {
  const offline = offlineActive();
  try {
    const primary = getCardRepository().getCardByName(name, exact);
    return await (offline ? withTimeout(primary, offlineTimeoutMs) : primary);
  } catch {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (offline && online) {
      try {
        wrappedLive ??= withPlayableFilter(liveCardRepository);
        return await wrappedLive.getCardByName(name, exact);
      } catch {
        return null;
      }
    }
    return null;
  }
}
