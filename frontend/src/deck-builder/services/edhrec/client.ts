import { logger } from '@/lib/logger';
import type {
  EDHRECTheme,
  EDHRECCard,
  EDHRECCombo,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  EDHRECSimilarCommander,
  EDHRECTopCommander,
  BudgetOption,
  TargetBracket,
  LiftEntry,
} from '@/deck-builder/types';
import { offlineSearchCards } from '@/lib/offline';
import { frontFaceName } from '@/lib/card-text';
import { sortWUBRG } from '@/deck-builder/lib/edhrecUtils';

const BASE_URL = import.meta.env.DEV ? '/edhrec-api' : 'https://json.edhrec.com';

/**
 * Network short-circuit for EDHREC. Unlike Scryfall + combos (which mirror
 * a local cache and always work either way), EDHREC has no offline shadow —
 * when the browser reports no network we hand back empty results so the deck
 * generator falls through to its Scryfall-driven heuristic fallback. Quality
 * drops vs. EDHREC suggestions, but generation completes instead of throwing.
 *
 * `navigator.onLine === false` is a coarse signal (it only knows the OS
 * thinks the interface is down, not whether EDHREC itself is reachable), but
 * it's good enough for the fast-path; genuine fetch failures still bubble up
 * to the caller-side error handling.
 */
function offlineActive(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const EMPTY_STATS: EDHRECCommanderStats = {
  avgPrice: 0,
  numDecks: 0,
  deckSize: 99,
  manaCurve: {},
  typeDistribution: {
    creature: 0,
    instant: 0,
    sorcery: 0,
    artifact: 0,
    enchantment: 0,
    land: 0,
    planeswalker: 0,
    battle: 0,
  },
  landDistribution: { basic: 0, nonbasic: 0, total: 0 },
};

function emptyCommanderData(): EDHRECCommanderData {
  return {
    themes: [],
    stats: EMPTY_STATS,
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [],
    },
    similarCommanders: [],
  };
}
const MIN_REQUEST_DELAY = 100; // 100ms between requests

class RateLimiter {
  private lastRequestTime = 0;

  async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_DELAY - timeSinceLastRequest));
    }

    this.lastRequestTime = Date.now();
  }
}

const rateLimiter = new RateLimiter();

// Cache for commander data
const commanderCache = new Map<string, { data: EDHRECCommanderData; timestamp: number }>();
const partnerPopularityCache = new Map<string, { data: Map<string, number>; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Raw EDHREC response types
// Note: EDHREC cardlist cards have limited fields - they're pre-categorized by tag
interface RawEDHRECCard {
  name: string;
  sanitized: string;
  // inclusion is deck COUNT, not percentage - we calculate percentage from potential_decks
  inclusion?: number;
  num_decks?: number;
  potential_decks?: number;
  synergy?: number;
  prices?: Record<string, { price: number }>;
  image_uris?: Array<{ normal: string; art_crop?: string }>;
  color_identity?: string[];
  // Note: cmc and primary_type are NOT available in cardlist cards
  // They must be fetched from Scryfall when converting cards
  cmc?: number;
  salt?: number;
  type_line?: string; // Sometimes present in EDHREC data
}

interface RawCardList {
  tag: string;
  cardviews: RawEDHRECCard[];
}

interface RawEDHRECResponse {
  // EDHREC may return a redirect instead of actual data (e.g. partner name ordering)
  redirect?: string;

  // Top-level stats
  avg_price?: number;
  creature?: number;
  instant?: number;
  sorcery?: number;
  artifact?: number;
  enchantment?: number;
  land?: number;
  planeswalker?: number;
  battle?: number;
  basic?: number;
  nonbasic?: number;
  num_decks_avg?: number;
  deck_size?: number; // Non-commander deck size
  // Similar commanders
  similar?: Array<{
    name: string;
    sanitized: string;
    color_identity?: string[];
    cmc?: number;
    image_uris?: Array<{ normal: string }>;
    url?: string;
  }>;

  // Panels with themes, mana curve, etc.
  panels?: {
    taglinks?: Array<{
      value: string;
      slug: string;
      count: number;
    }>;
    mana_curve?: Record<string, number>; // CMC -> count (keys are strings in JSON)
  };

  // Card lists
  container?: {
    json_dict?: {
      cardlists?: RawCardList[];
      card?: { name: string };
    };
  };
}

/**
 * Format commander name for EDHREC URL
 * "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
 * "Venat, Heart of Hydaelyn // Hydaelyn, the Mothercrystal" -> "venat-heart-of-hydaelyn"
 * "Clavileño, First of the Blessed" -> "clavileno-first-of-the-blessed"
 *
 * For double-faced cards (containing "//"), EDHREC uses only the front face name.
 */
export function formatCommanderNameForUrl(name: string): string {
  // Handle double-faced cards - use only the front face name
  const frontFace = frontFaceName(name);

  return frontFace
    .normalize('NFD') // Decompose accented chars (ñ -> n + combining tilde)
    .replace(/[\u0300-\u036f]/g, '') // Strip combining diacritical marks
    .toLowerCase()
    .replace(/[',]/g, '') // Remove apostrophes and commas
    .replace(/[^a-z0-9\s-]/g, '') // Remove other special characters (& etc.) before spacing
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Collapse multiple hyphens
}

/**
 * Get the URL suffix for budget/expensive card pools.
 * 'any' -> '', 'budget' -> '/budget', 'expensive' -> '/expensive'
 */
function getBudgetSuffix(budgetOption?: BudgetOption): string {
  if (budgetOption === 'budget') return '/budget';
  if (budgetOption === 'expensive') return '/expensive';
  return '';
}

const TARGET_BRACKET_SLUGS: Record<number, string> = {
  1: 'exhibition',
  2: 'core',
  3: 'upgraded',
  4: 'optimized',
  5: 'cedh',
};

function getTargetBracketSuffix(targetBracket?: TargetBracket): string {
  if (!targetBracket || targetBracket === 'all') return '';
  return `/${TARGET_BRACKET_SLUGS[targetBracket]}`;
}

async function edhrecFetch<T>(endpoint: string): Promise<T> {
  await rateLimiter.throttle();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      // Rate limited - wait and retry once
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return edhrecFetch<T>(endpoint);
    }
    throw new Error(`EDHREC API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // EDHREC returns { redirect: "..." } instead of real data for wrong partner orderings
  if (data.redirect) {
    throw new Error(`EDHREC redirect to ${data.redirect}`);
  }

  return data;
}

// Tags that represent high-priority theme synergy cards
const THEME_SYNERGY_TAGS = new Set(['highsynergycards', 'topcards', 'gamechangers']);

/** Map from cardlist tag (lowercased) to the MTG card type it implies. */
const TAG_TYPE_MAP: Record<string, string> = {
  creatures: 'Creature',
  instants: 'Instant',
  sorceries: 'Sorcery',
  utilityartifacts: 'Artifact',
  manaartifacts: 'Artifact',
  enchantments: 'Enchantment',
  planeswalkers: 'Planeswalker',
  utilitylands: 'Land',
  lands: 'Land',
};

/**
 * Backfill color identities on commanders whose colorIdentity is empty by
 * fetching the missing names from Scryfall. Mutates the passed array in-place
 * and returns the updated array.
 */
async function backfillColorIdentities(
  commanders: EDHRECTopCommander[]
): Promise<EDHRECTopCommander[]> {
  if (!commanders.some((c) => c.colorIdentity.length === 0)) return commanders;
  try {
    const { getCardsByNames } = await import('@/deck-builder/services/scryfall/client');
    const names = commanders.filter((c) => c.colorIdentity.length === 0).map((c) => c.name);
    const cardMap = await getCardsByNames(names);
    return commanders.map((c) => {
      if (c.colorIdentity.length > 0) return c;
      const card = cardMap.get(c.name);
      return { ...c, colorIdentity: card?.color_identity ?? [] };
    });
  } catch {
    // Scryfall lookup failed — show without color pips
    return commanders;
  }
}

/**
 * Parse raw EDHREC card into our format
 * @param raw - Raw card data from EDHREC
 * @param tagHint - Optional tag from the cardlist to help determine primary_type
 */
function parseCard(raw: RawEDHRECCard, tagHint?: string): EDHRECCard {
  // Calculate inclusion as percentage (EDHREC returns deck count)
  const inclusionCount = raw.inclusion || 0;
  const potentialDecks = raw.potential_decks || 1;
  const inclusionPercent = potentialDecks > 0 ? (inclusionCount / potentialDecks) * 100 : 0;

  // Derive primary_type from the cardlist tag if available
  const tagLower = tagHint?.toLowerCase() || '';
  let primaryType = TAG_TYPE_MAP[tagLower] ?? 'Unknown';

  // Fallback: derive from type_line if EDHREC provided it
  if (primaryType === 'Unknown' && raw.type_line) {
    const tl = raw.type_line.split('—')[0].split('//')[0].toLowerCase();
    if (tl.includes('creature')) primaryType = 'Creature';
    else if (tl.includes('instant')) primaryType = 'Instant';
    else if (tl.includes('sorcery')) primaryType = 'Sorcery';
    else if (tl.includes('artifact')) primaryType = 'Artifact';
    else if (tl.includes('enchantment')) primaryType = 'Enchantment';
    else if (tl.includes('planeswalker')) primaryType = 'Planeswalker';
    else if (tl.includes('land')) primaryType = 'Land';
    else if (tl.includes('battle')) primaryType = 'Battle';
  }

  // Check if this card is from a high-priority synergy list
  const isThemeSynergyCard = THEME_SYNERGY_TAGS.has(tagLower);
  const isNewCard = tagLower === 'newcards';
  const isGameChanger = tagLower === 'gamechangers';

  return {
    name: raw.name,
    sanitized: raw.sanitized,
    primary_type: primaryType,
    inclusion: inclusionPercent, // Now a percentage (0-100)
    num_decks: raw.num_decks || 0,
    synergy: raw.synergy,
    isThemeSynergyCard,
    isNewCard,
    isGameChanger,
    prices: raw.prices
      ? {
          tcgplayer: raw.prices.tcgplayer,
          cardkingdom: raw.prices.cardkingdom,
        }
      : undefined,
    image_uris: raw.image_uris,
    color_identity: raw.color_identity,
    cmc: raw.cmc, // Note: will be undefined from EDHREC, fetched from Scryfall later
    salt: raw.salt,
  };
}

/**
 * Parse mana_curve from EDHREC response (keys are strings in JSON)
 * Converts { "1": 10, "2": 12, ... } to { 1: 10, 2: 12, ... }
 */
function parseManaCurve(rawCurve?: Record<string, number>): Record<number, number> {
  const result: Record<number, number> = {};
  if (!rawCurve) return result;

  for (const [key, value] of Object.entries(rawCurve)) {
    const cmc = parseInt(key, 10);
    if (!isNaN(cmc) && value > 0) {
      result[cmc] = value;
    }
  }
  return result;
}

/**
 * Parse the top-level stats block (averages, type/land distribution, curve)
 * out of a raw EDHREC response. Identical across the single-commander, theme,
 * and partner-theme fetches.
 */
function parseEdhrecStats(response: RawEDHRECResponse): EDHRECCommanderStats {
  return {
    avgPrice: response.avg_price || 0,
    numDecks: response.num_decks_avg || 0,
    deckSize: response.deck_size || 81, // Default to 81 if missing
    manaCurve: parseManaCurve(response.panels?.mana_curve),
    typeDistribution: {
      creature: response.creature || 0,
      instant: response.instant || 0,
      sorcery: response.sorcery || 0,
      artifact: response.artifact || 0,
      enchantment: response.enchantment || 0,
      land: response.land || 0,
      planeswalker: response.planeswalker || 0,
      battle: response.battle || 0,
    },
    landDistribution: {
      basic: response.basic || 0,
      nonbasic: response.nonbasic || 0,
      total: response.land || 0,
    },
  };
}

/**
 * Build both possible EDHREC slugs for partner commanders.
 * EDHREC doesn't always use alphabetical order (e.g. commander before background),
 * so we return both orderings to try.
 */
function getPartnerSlugs(commander1: string, commander2: string): [string, string] {
  const slug1 = formatCommanderNameForUrl(commander1);
  const slug2 = formatCommanderNameForUrl(commander2);
  // Primary: commander1 first, secondary: commander2 first
  return [`${slug1}-${slug2}`, `${slug2}-${slug1}`];
}

/**
 * Parse a raw EDHREC response into structured commander data.
 * Shared by both single-commander and partner-commander fetches.
 */
function parseEdhrecResponse(response: RawEDHRECResponse, cacheKey: string): EDHRECCommanderData {
  // Parse themes from taglinks
  const rawTaglinks = response.panels?.taglinks || [];
  const themes: EDHRECTheme[] = rawTaglinks.map((t) => ({
    name: t.value,
    slug: t.slug,
    count: t.count,
    url: `/themes/${t.slug}/${cacheKey}`,
    popularityPercent: 0, // Will calculate below
  }));

  // Calculate popularity percentages
  const totalThemeDecks = themes.reduce((sum, t) => sum + t.count, 0);
  for (const theme of themes) {
    theme.popularityPercent = totalThemeDecks > 0 ? (theme.count / totalThemeDecks) * 100 : 0;
  }

  // Sort by count (highest first)
  themes.sort((a, b) => b.count - a.count);

  // Parse stats — mana_curve lives inside panels, not at the top level
  const stats = parseEdhrecStats(response);

  // Parse card lists directly from EDHREC tags
  const cardlists = parseCardlists(response);

  // Parse similar commanders
  const similarCommanders: EDHRECSimilarCommander[] = (response.similar || []).map((s) => ({
    name: s.name,
    sanitized: s.sanitized,
    colorIdentity: s.color_identity || [],
    cmc: s.cmc || 0,
    imageUrl: s.image_uris?.[0]?.normal,
    url: s.url || `/commanders/${s.sanitized}`,
  }));

  const data: EDHRECCommanderData = {
    themes,
    stats,
    cardlists,
    similarCommanders,
  };

  // Cache the result
  commanderCache.set(cacheKey, { data, timestamp: Date.now() });

  return data;
}

/**
 * Parse cardlists from a raw EDHREC response into categorized lists.
 * Shared by both commander data and theme data parsing.
 */
function parseCardlists(response: RawEDHRECResponse): EDHRECCommanderData['cardlists'] {
  const rawCardLists = response.container?.json_dict?.cardlists || [];
  logger.debug('[EDHREC] Raw cardlists count:', rawCardLists.length);
  logger.debug(
    '[EDHREC] Available tags:',
    rawCardLists.map((l: RawCardList) => l.tag)
  );

  const cardlists: EDHRECCommanderData['cardlists'] = {
    creatures: [],
    instants: [],
    sorceries: [],
    artifacts: [],
    enchantments: [],
    planeswalkers: [],
    lands: [],
    allNonLand: [],
  };

  // Track cards for deduplication across lists
  const seenCards = new Map<string, EDHRECCard>();
  // Track known types from typed lists (creatures, instants, etc.) even for deduped cards
  const knownTypes = new Map<string, string>();

  for (const list of rawCardLists) {
    if (!list.cardviews || list.cardviews.length === 0) continue;

    const tag = list.tag.toLowerCase();
    logger.debug(`[EDHREC] Processing list "${list.tag}" with ${list.cardviews.length} cards`);

    // Determine the type this tag implies (if any)
    const impliedType = TAG_TYPE_MAP[tag];

    for (const rawCard of list.cardviews) {
      // Record known type from typed lists — even if the card gets deduped
      if (impliedType) {
        knownTypes.set(rawCard.name, impliedType);
      }

      // Skip if we've seen this card with higher inclusion
      const existing = seenCards.get(rawCard.name);
      const potentialDecks = rawCard.potential_decks || 1;
      const inclusionPercent =
        potentialDecks > 0 ? ((rawCard.inclusion || 0) / potentialDecks) * 100 : 0;

      if (existing && existing.inclusion >= inclusionPercent) {
        continue;
      }

      const card = parseCard(rawCard, list.tag);

      // Preserve known primary_type when a generic list (Unknown) replaces a typed entry
      if (card.primary_type === 'Unknown') {
        const known =
          existing?.primary_type !== 'Unknown' ? existing?.primary_type : knownTypes.get(card.name);
        if (known) card.primary_type = known;
      }

      seenCards.set(card.name, card);

      // Add to the appropriate category based on EDHREC's tag
      if (tag === 'creatures') {
        cardlists.creatures.push(card);
        cardlists.allNonLand.push(card);
      } else if (tag === 'instants') {
        cardlists.instants.push(card);
        cardlists.allNonLand.push(card);
      } else if (tag === 'sorceries') {
        cardlists.sorceries.push(card);
        cardlists.allNonLand.push(card);
      } else if (tag === 'utilityartifacts' || tag === 'manaartifacts') {
        cardlists.artifacts.push(card);
        cardlists.allNonLand.push(card);
      } else if (tag === 'enchantments') {
        cardlists.enchantments.push(card);
        cardlists.allNonLand.push(card);
      } else if (tag === 'planeswalkers') {
        cardlists.planeswalkers.push(card);
        cardlists.allNonLand.push(card);
      } else if (tag === 'utilitylands' || tag === 'lands') {
        cardlists.lands.push(card);
      } else if (
        tag === 'newcards' ||
        tag === 'highsynergycards' ||
        tag === 'topcards' ||
        tag === 'gamechangers'
      ) {
        cardlists.allNonLand.push(card);
      }
    }
  }

  // Final pass: backfill any remaining Unknown types from knownTypes map
  for (const card of cardlists.allNonLand) {
    if (card.primary_type === 'Unknown') {
      const known = knownTypes.get(card.name);
      if (known) card.primary_type = known;
    }
  }

  // Sort each category by inclusion rate (highest first)
  for (const key of Object.keys(cardlists) as (keyof typeof cardlists)[]) {
    cardlists[key].sort((a, b) => b.inclusion - a.inclusion);
  }

  logger.debug('[EDHREC] Categorized cards by tag:', {
    creatures: cardlists.creatures.length,
    instants: cardlists.instants.length,
    sorceries: cardlists.sorceries.length,
    artifacts: cardlists.artifacts.length,
    enchantments: cardlists.enchantments.length,
    planeswalkers: cardlists.planeswalkers.length,
    lands: cardlists.lands.length,
    allNonLand: cardlists.allNonLand.length,
  });

  if (cardlists.creatures.length > 0) {
    logger.debug('[EDHREC] Sample creature:', cardlists.creatures[0]);
  }

  return cardlists;
}

/**
 * Merge cardlists from two EDHREC datasets (for partner fallback)
 */
function mergeCardlists(
  data1: EDHRECCommanderData,
  data2: EDHRECCommanderData
): EDHRECCommanderData['cardlists'] {
  const mergeCategory = (list1: EDHRECCard[], list2: EDHRECCard[]): EDHRECCard[] => {
    const cardMap = new Map<string, EDHRECCard>();
    for (const card of [...list1, ...list2]) {
      const existing = cardMap.get(card.name);
      if (!existing || card.inclusion > existing.inclusion) {
        cardMap.set(card.name, card);
      }
    }
    return Array.from(cardMap.values()).sort((a, b) => b.inclusion - a.inclusion);
  };

  return {
    creatures: mergeCategory(data1.cardlists.creatures, data2.cardlists.creatures),
    instants: mergeCategory(data1.cardlists.instants, data2.cardlists.instants),
    sorceries: mergeCategory(data1.cardlists.sorceries, data2.cardlists.sorceries),
    artifacts: mergeCategory(data1.cardlists.artifacts, data2.cardlists.artifacts),
    enchantments: mergeCategory(data1.cardlists.enchantments, data2.cardlists.enchantments),
    planeswalkers: mergeCategory(data1.cardlists.planeswalkers, data2.cardlists.planeswalkers),
    lands: mergeCategory(data1.cardlists.lands, data2.cardlists.lands),
    allNonLand: mergeCategory(data1.cardlists.allNonLand, data2.cardlists.allNonLand),
  };
}

/**
 * Minimum decks/cards for an EDHREC page to carry real signal, rather than
 * being statistical noise. A bracket- or theme-narrowed URL can resolve to a
 * page EDHREC still serves (valid JSON, 200 OK) with almost no underlying
 * decks (E93). Calibrated against live measurements: a bracket+theme combo
 * page returned 0 decks / 0 cards, a cEDH-only page returned 19 decks, while
 * a healthy theme page carried 768 decks / 267 cards. 25 decks and 10
 * non-land cards sit comfortably above the observed noise floor and below
 * every verified-healthy page.
 */
export const MIN_HEALTHY_POOL_DECKS = 25;
export const MIN_HEALTHY_POOL_CARDS = 10;

/**
 * True when a parsed EDHREC pool is too thin to build a deck from — too few
 * decks contributed to the page's stats, or too few distinct non-land cards
 * recommended. Generation should ladder down to a broader page rather than
 * accept a pool like this silently.
 */
export function isPoolTooThin(data: EDHRECCommanderData): boolean {
  return (
    data.stats.numDecks < MIN_HEALTHY_POOL_DECKS ||
    data.cardlists.allNonLand.length < MIN_HEALTHY_POOL_CARDS
  );
}

/**
 * Fetch full commander data from EDHREC
 */
export async function fetchCommanderData(
  commanderName: string,
  budgetOption?: BudgetOption,
  targetBracket?: TargetBracket
): Promise<EDHRECCommanderData> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const bracketSuffix = getTargetBracketSuffix(targetBracket);
  const budgetSuffix = getBudgetSuffix(budgetOption);
  const cacheKey = `${formattedName}${bracketSuffix}${budgetSuffix}`;

  // Check cache first — important: a populated cache entry from a prior online
  // session is still valuable when offline, so we check it before the offline
  // short-circuit.
  const cached = commanderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return emptyCommanderData();

  try {
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${formattedName}${bracketSuffix}${budgetSuffix}.json`
    );

    return parseEdhrecResponse(response, cacheKey);
  } catch (error) {
    logger.error('Failed to fetch EDHREC commander data:', error);
    throw error;
  }
}

/**
 * Try both partner-slug orderings with a caller-supplied fetch function.
 * Returns the first successful result, or null when both orderings fail.
 * Used to factor out the "try [slugA, slugB]" loop shared by partner data
 * and partner theme-data fetches.
 */
async function tryPartnerSlugs<T>(
  slugs: [string, string],
  fetchFn: (slug: string) => Promise<T>
): Promise<T | null> {
  for (const slug of slugs) {
    try {
      return await fetchFn(slug);
    } catch {
      // Try the other ordering
    }
  }
  return null;
}

/**
 * Fetch EDHREC data for partner commanders.
 * Tries the combined partner page first, falls back to merging individual data.
 */
export async function fetchPartnerCommanderData(
  commander1: string,
  commander2: string,
  budgetOption?: BudgetOption,
  targetBracket?: TargetBracket
): Promise<EDHRECCommanderData> {
  const [slugA, slugB] = getPartnerSlugs(commander1, commander2);
  const bracketSuffix = getTargetBracketSuffix(targetBracket);
  const budgetSuffix = getBudgetSuffix(budgetOption);

  // Check cache for either ordering
  for (const slug of [slugA, slugB]) {
    const cacheKey = `${slug}${bracketSuffix}${budgetSuffix}`;
    const cached = commanderCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  if (offlineActive()) return emptyCommanderData();

  // Try both orderings - EDHREC doesn't always use alphabetical order
  // (redirects are detected and thrown by edhrecFetch)
  const partnerData = await tryPartnerSlugs([slugA, slugB], async (slug) => {
    const cacheKey = `${slug}${bracketSuffix}${budgetSuffix}`;
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${slug}${bracketSuffix}${budgetSuffix}.json`
    );
    logger.debug(
      `[EDHREC] Found partner page: /pages/commanders/${slug}${bracketSuffix}${budgetSuffix}.json`
    );
    return parseEdhrecResponse(response, cacheKey);
  });
  if (partnerData) return partnerData;

  logger.debug(`[EDHREC] No partner page found, merging individual data`);

  // Fallback: fetch both individually and merge
  const [data1, data2] = await Promise.all([
    fetchCommanderData(commander1, budgetOption, targetBracket).catch(() => null),
    fetchCommanderData(commander2, budgetOption, targetBracket).catch(() => null),
  ]);

  if (data1 && data2) {
    const mergedData: EDHRECCommanderData = {
      themes: data1.themes,
      stats: data1.stats,
      cardlists: mergeCardlists(data1, data2),
      similarCommanders: data1.similarCommanders,
    };
    commanderCache.set(slugA, { data: mergedData, timestamp: Date.now() });
    return mergedData;
  }

  if (data1) return data1;
  if (data2) return data2;

  throw new Error(`Failed to fetch EDHREC data for both ${commander1} and ${commander2}`);
}

/**
 * Fetch commander themes from EDHREC (backwards compatible)
 */
export async function fetchCommanderThemes(commanderName: string): Promise<EDHRECTheme[]> {
  const data = await fetchCommanderData(commanderName);
  return data.themes;
}

/**
 * Fetch themes for partner commanders (combines both)
 */
export async function fetchPartnerThemes(
  commander1: string,
  commander2: string
): Promise<EDHRECTheme[]> {
  // Try both orderings - EDHREC doesn't always use alphabetical order
  const [slugA, slugB] = getPartnerSlugs(commander1, commander2);

  for (const slug of [slugA, slugB]) {
    try {
      const data = await fetchCommanderData(slug);
      if (data.themes.length > 0) {
        return data.themes;
      }
    } catch {
      // This ordering didn't work, try the other
    }
  }

  // Fallback: fetch both individually and merge themes
  const [data1, data2] = await Promise.all([
    fetchCommanderData(commander1).catch(() => null),
    fetchCommanderData(commander2).catch(() => null),
  ]);

  const themes1 = data1?.themes || [];
  const themes2 = data2?.themes || [];

  // Merge and deduplicate themes
  const themeMap = new Map<string, EDHRECTheme>();

  for (const theme of [...themes1, ...themes2]) {
    const existing = themeMap.get(theme.name);
    if (existing) {
      // Combine counts
      existing.count += theme.count;
    } else {
      themeMap.set(theme.name, { ...theme });
    }
  }

  const merged = Array.from(themeMap.values());
  const totalDecks = merged.reduce((sum, t) => sum + t.count, 0);

  // Recalculate percentages
  for (const theme of merged) {
    theme.popularityPercent = totalDecks > 0 ? (theme.count / totalDecks) * 100 : 0;
  }

  return merged.sort((a, b) => b.count - a.count);
}

/**
 * Fetch theme-specific commander data from EDHREC
 * Uses endpoint like /pages/commanders/skullbriar-the-walking-grave/plus-1-plus-1-counters.json
 */
export async function fetchCommanderThemeData(
  commanderName: string,
  themeSlug: string,
  budgetOption?: BudgetOption,
  targetBracket?: TargetBracket
): Promise<EDHRECCommanderData> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const bracketSuffix = getTargetBracketSuffix(targetBracket);
  const budgetSuffix = getBudgetSuffix(budgetOption);
  const cacheKey = `${formattedName}${bracketSuffix}/${themeSlug}${budgetSuffix}`;

  // Check cache first
  const cached = commanderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return emptyCommanderData();

  try {
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${formattedName}${bracketSuffix}/${themeSlug}${budgetSuffix}.json`
    );

    // Parse stats
    const stats = parseEdhrecStats(response);

    // Parse card lists using shared parser
    const cardlists = parseCardlists(response);

    const data: EDHRECCommanderData = {
      themes: [], // Theme-specific pages don't have sub-themes
      stats,
      cardlists,
      similarCommanders: [], // Not relevant for theme pages
    };

    // Cache the result
    commanderCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    logger.error(`Failed to fetch EDHREC theme data for ${themeSlug}:`, error);
    throw error;
  }
}

/**
 * Fetch theme-specific data for partner commanders.
 * Tries the combined partner theme page first, falls back to primary commander's theme.
 */
export async function fetchPartnerThemeData(
  commander1: string,
  commander2: string,
  themeSlug: string,
  budgetOption?: BudgetOption,
  targetBracket?: TargetBracket
): Promise<EDHRECCommanderData> {
  const [slugA, slugB] = getPartnerSlugs(commander1, commander2);
  const bracketSuffix = getTargetBracketSuffix(targetBracket);
  const budgetSuffix = getBudgetSuffix(budgetOption);

  // Check cache for either ordering
  for (const slug of [slugA, slugB]) {
    const cacheKey = `${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}`;
    const cached = commanderCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  if (offlineActive()) return emptyCommanderData();

  // Try both orderings
  const themeData = await tryPartnerSlugs([slugA, slugB], async (slug) => {
    const cacheKey = `${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}`;
    const response = await edhrecFetch<RawEDHRECResponse>(
      `/pages/commanders/${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}.json`
    );
    logger.debug(
      `[EDHREC] Found partner theme page: ${slug}${bracketSuffix}/${themeSlug}${budgetSuffix}`
    );
    const data: EDHRECCommanderData = {
      themes: [],
      stats: parseEdhrecStats(response),
      cardlists: parseCardlists(response),
      similarCommanders: [],
    };
    commanderCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  });
  if (themeData) return themeData;

  logger.debug(`[EDHREC] No partner theme page found, falling back to primary commander`);
  // Fallback: use primary commander's theme data
  return fetchCommanderThemeData(commander1, themeSlug, budgetOption, targetBracket);
}

/**
 * Partner popularity data from EDHREC's /partners/ endpoint
 */
export interface PartnerPopularity {
  name: string; // Partner commander name
  numDecks: number; // Number of decks with this pairing
}

/**
 * Fetch partner popularity data from EDHREC.
 * Returns a map of partner name -> deck count for the given commander.
 */
export async function fetchPartnerPopularity(commanderName: string): Promise<Map<string, number>> {
  const formattedName = formatCommanderNameForUrl(commanderName);
  const cacheKey = `partners-${formattedName}`;

  // Check cache
  const cached = partnerPopularityCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return new Map();

  try {
    const response = await edhrecFetch<{ partnercounts?: Array<{ value: string; count: number }> }>(
      `/pages/partners/${formattedName}.json`
    );

    const result = new Map<string, number>();
    for (const entry of response.partnercounts || []) {
      result.set(entry.value, entry.count);
    }

    partnerPopularityCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    logger.error(`[EDHREC] Failed to fetch partner popularity for ${commanderName}:`, error);
    return new Map();
  }
}

/**
 * Clear the commander cache
 */
export function clearCommanderCache(): void {
  commanderCache.clear();
}

// --- Salt index ---
// EDHREC's cardlist payloads don't carry per-card salt scores, but the
// `top/salt.json` page exposes the top-100 saltiest cards with a `label` like
// "Salt Score: 3.06\n16316 decks". We parse that into a name → salt map and
// cache it for the session. Cards not in the top-100 are treated as ~0 salt.

let saltIndexPromise: Promise<Map<string, number>> | null = null;

export function fetchSaltIndex(): Promise<Map<string, number>> {
  if (saltIndexPromise) return saltIndexPromise;
  if (offlineActive()) {
    saltIndexPromise = Promise.resolve(new Map<string, number>());
    return saltIndexPromise;
  }
  saltIndexPromise = (async () => {
    try {
      const raw = await edhrecFetch<RawEDHRECResponse>('/pages/top/salt.json');
      const cardviews = raw.container?.json_dict?.cardlists?.[0]?.cardviews ?? [];
      const out = new Map<string, number>();
      for (const c of cardviews as Array<{ name: string; label?: string }>) {
        const m = /Salt Score:\s*([\d.]+)/.exec(c.label ?? '');
        if (m) out.set(c.name, parseFloat(m[1]));
      }
      return out;
    } catch (err) {
      logger.warn('[EDHREC] Failed to fetch salt index:', err);
      saltIndexPromise = null; // allow retry next time
      return new Map<string, number>();
    }
  })();
  return saltIndexPromise;
}

// --- Top commanders (fetched live from EDHREC) ---

/** Map sorted color key → EDHREC URL slug */
const COLOR_SLUG_MAP: Record<string, string> = {
  '': 'year',
  C: 'colorless',
  W: 'mono-white',
  U: 'mono-blue',
  B: 'mono-black',
  R: 'mono-red',
  G: 'mono-green',
  WU: 'azorius',
  WB: 'orzhov',
  WR: 'boros',
  WG: 'selesnya',
  UB: 'dimir',
  UR: 'izzet',
  UG: 'simic',
  BR: 'rakdos',
  BG: 'golgari',
  RG: 'gruul',
  WUB: 'esper',
  WUR: 'jeskai',
  WUG: 'bant',
  WBR: 'mardu',
  WBG: 'abzan',
  WRG: 'naya',
  UBR: 'grixis',
  UBG: 'sultai',
  URG: 'temur',
  BRG: 'jund',
  WUBR: 'yore-tiller',
  WUBG: 'witch-maw',
  WURG: 'ink-treader',
  WBRG: 'dune-brood',
  UBRG: 'glint-eye',
  WUBRG: 'five-color',
};

interface RawTopCommanderEntry {
  name: string;
  sanitized: string;
  num_decks?: number;
  inclusion?: number;
  color_identity?: string[];
}

interface RawTopCommandersResponse {
  container?: {
    json_dict?: {
      cardlists?: Array<{
        header?: string;
        cardviews?: RawTopCommanderEntry[];
      }>;
    };
  };
}

const topCommanderCache = new Map<string, { data: EDHRECTopCommander[]; timestamp: number }>();
const TOP_COMMANDER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch the full EDHREC commander typeahead list (all commander names).
 * Cached for the session lifetime.
 */
let allCommanderNamesCache: string[] | null = null;
export async function fetchAllCommanderNames(): Promise<string[]> {
  if (allCommanderNamesCache) return allCommanderNamesCache;
  if (offlineActive()) {
    // Offline: derive the commander list from the local oracle store. Cached
    // so subsequent calls within the session don't re-scan.
    const resp = await offlineSearchCards('is:commander', { skipColorFilter: true });
    allCommanderNamesCache = resp.data.map((c) => c.name);
    return allCommanderNamesCache;
  }
  await rateLimiter.throttle();
  const res = await fetch(`${BASE_URL}/static/typeahead/commanders`);
  if (!res.ok) throw new Error(`EDHREC typeahead failed: ${res.status}`);
  const names: string[] = await res.json();
  allCommanderNamesCache = names;
  return names;
}

/**
 * Fetch top commanders from EDHREC for a given color identity.
 * Pass an empty array for overall top commanders (past year).
 * Results are cached for 30 minutes.
 */
export async function fetchTopCommanders(colors: string[]): Promise<EDHRECTopCommander[]> {
  // Sort colors in WUBRG order and build cache key
  const sorted = sortWUBRG(colors, /* excludeC */ true);
  const key = colors.includes('C') ? 'C' : sorted.join('');
  const slug = COLOR_SLUG_MAP[key];
  if (!slug) return [];

  const cached = topCommanderCache.get(key);
  if (cached && Date.now() - cached.timestamp < TOP_COMMANDER_CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return [];

  try {
    const response = await edhrecFetch<RawTopCommandersResponse>(`/pages/commanders/${slug}.json`);

    const cardviews = response.container?.json_dict?.cardlists?.[0]?.cardviews ?? [];
    const isOverall = key === '';
    // Filter out partner pairs (e.g. "Kraum // Tymna") before taking top 12
    const top = cardviews.filter((e) => !e.name.includes('//')).slice(0, 12);

    let commanders: EDHRECTopCommander[] = top.map((entry, i) => ({
      rank: i + 1,
      name: entry.name,
      sanitized: entry.sanitized,
      colorIdentity: isOverall
        ? (entry.color_identity?.map((c) => c.toUpperCase()) ?? [])
        : key === 'C'
          ? []
          : sorted,
      numDecks: entry.num_decks ?? entry.inclusion ?? 0,
    }));

    // The overall "year" endpoint doesn't include color_identity on page 1.
    // Batch-fetch from Scryfall to fill them in.
    if (isOverall) commanders = await backfillColorIdentities(commanders);

    topCommanderCache.set(key, { data: commanders, timestamp: Date.now() });
    return commanders;
  } catch (error) {
    logger.warn(`[EDHREC] Failed to fetch top commanders for "${slug}":`, error);
    return cached?.data ?? [];
  }
}

const playstyleCommanderCache = new Map<
  string,
  { data: EDHRECTopCommander[]; timestamp: number }
>();

/**
 * Fetch the top commanders for a play style (an EDHREC theme/tag such as
 * "aristocrats", "tokens", "voltron"). Backs the "search by play style"
 * entry in the guided builder. Color identity isn't on the tag page, so
 * it's backfilled from Scryfall. Cached for 30 minutes.
 */
export async function fetchPlaystyleCommanders(tagSlug: string): Promise<EDHRECTopCommander[]> {
  const key = tagSlug.toLowerCase().trim();
  const cached = playstyleCommanderCache.get(key);
  if (cached && Date.now() - cached.timestamp < TOP_COMMANDER_CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return [];

  try {
    const response = await edhrecFetch<RawTopCommandersResponse>(`/pages/tags/${key}.json`);
    const cardlists = response.container?.json_dict?.cardlists ?? [];
    // The tag page leads with "New Commanders" then "Top Commanders" —
    // prefer the latter, falling back to the first commander-ish list.
    const list =
      cardlists.find((c) => /top commanders/i.test(c.header ?? '')) ??
      cardlists.find((c) => /commanders/i.test(c.header ?? '')) ??
      cardlists[0];

    const entries = (list?.cardviews ?? []).filter((e) => !e.name.includes('//')).slice(0, 18);

    let commanders: EDHRECTopCommander[] = entries.map((entry, i) => ({
      rank: i + 1,
      name: entry.name,
      sanitized: entry.sanitized,
      colorIdentity: entry.color_identity?.map((c) => c.toUpperCase()) ?? [],
      numDecks: entry.num_decks ?? entry.inclusion ?? 0,
    }));

    // Tag pages omit color_identity — backfill from Scryfall for the pips.
    commanders = await backfillColorIdentities(commanders);

    playstyleCommanderCache.set(key, { data: commanders, timestamp: Date.now() });
    return commanders;
  } catch (error) {
    logger.warn(`[EDHREC] Failed to fetch play-style commanders for "${key}":`, error);
    return cached?.data ?? [];
  }
}

/** All color combo keys (excluding '' for overall and 'C' for colorless) */
const ALL_COLOR_KEYS = Object.keys(COLOR_SLUG_MAP).filter((k) => k !== '' && k !== 'C');

/**
 * Fetch commanders from EDHREC for all color combos that *include* the given colors.
 * E.g. colors=['G'] returns commanders from mono-green, golgari, simic, ..., WUBRG.
 * Returns all entries (not capped to 12) sorted by deck count, with duplicates removed.
 */
export async function fetchCommandersIncludingColors(
  colors: string[]
): Promise<EDHRECTopCommander[]> {
  // Colorless is its own identity — doesn't combine with other colors
  if (colors.includes('C')) {
    return fetchAllCommandersForColor(['C']);
  }

  const required = new Set(colors.map((c) => c.toUpperCase()));
  // Find all color keys that contain every required color
  const matchingKeys = ALL_COLOR_KEYS.filter((key) => [...required].every((c) => key.includes(c)));
  if (matchingKeys.length === 0) return [];

  // Fetch all matching combos in parallel (uses cache internally)
  const results = await Promise.all(
    matchingKeys.map((key) => fetchAllCommandersForColor(key.split('')))
  );

  // Union + dedupe by name, keeping the entry with the highest deck count
  const map = new Map<string, EDHRECTopCommander>();
  for (const list of results) {
    for (const cmd of list) {
      const existing = map.get(cmd.name);
      if (!existing || cmd.numDecks > existing.numDecks) {
        map.set(cmd.name, cmd);
      }
    }
  }

  return [...map.values()].sort((a, b) => b.numDecks - a.numDecks);
}

/**
 * Fetch ALL commanders (up to 100) for an exact color combo from EDHREC.
 * Unlike fetchTopCommanders which returns top 12, this returns the full page.
 * Results are cached for 30 minutes.
 */
const fullCommanderCache = new Map<string, { data: EDHRECTopCommander[]; timestamp: number }>();

async function fetchAllCommandersForColor(colors: string[]): Promise<EDHRECTopCommander[]> {
  const sorted = sortWUBRG(colors, /* excludeC */ true);
  const key = colors.includes('C') ? 'C' : sorted.join('');
  const slug = COLOR_SLUG_MAP[key];
  if (!slug) return [];

  const cached = fullCommanderCache.get(key);
  if (cached && Date.now() - cached.timestamp < TOP_COMMANDER_CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return [];

  try {
    const response = await edhrecFetch<RawTopCommandersResponse>(`/pages/commanders/${slug}.json`);
    const cardviews = response.container?.json_dict?.cardlists?.[0]?.cardviews ?? [];
    const commanders: EDHRECTopCommander[] = cardviews
      .filter((e) => !e.name.includes('//'))
      .map((entry, i) => ({
        rank: i + 1,
        name: entry.name,
        sanitized: entry.sanitized,
        colorIdentity: key === 'C' ? [] : sorted,
        numDecks: entry.num_decks ?? entry.inclusion ?? 0,
      }));

    fullCommanderCache.set(key, { data: commanders, timestamp: Date.now() });
    return commanders;
  } catch (error) {
    logger.warn(`[EDHREC] Failed to fetch all commanders for "${slug}":`, error);
    return cached?.data ?? [];
  }
}

/**
 * Fetch all multi-copy card quantities from an EDHREC average deck.
 * Returns a Map of cardName → quantity for cards with >1 copy, or null if the fetch failed entirely.
 * Returning null (fetch failed) vs empty Map (fetch succeeded, no multi-copy cards) is important
 * for distinguishing fallback behavior.
 */
export async function fetchAverageDeckMultiCopies(
  commanderName: string,
  cardNamesToCheck: string[],
  themeSlug?: string
): Promise<Map<string, number> | null> {
  if (offlineActive()) return null;

  try {
    await rateLimiter.throttle();

    const formatted = formatCommanderNameForUrl(commanderName);
    const themePart = themeSlug ? `/${themeSlug}` : '';
    const url = `${BASE_URL}/pages/average-decks/${formatted}${themePart}.json`;

    logger.debug(`[EDHREC] Fetching average deck from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      logger.warn(
        `[EDHREC] Average deck fetch failed (${response.status}) for ${formatted}${themePart}`
      );
      return null;
    }

    const data = await response.json();
    const deckList: string[] = data?.deck || data?.decklist || [];

    if (!Array.isArray(deckList) || deckList.length === 0) {
      logger.warn('[EDHREC] Average deck has no deck array');
      return null;
    }

    // Build a lookup set for the cards we care about
    const lookupSet = new Set(cardNamesToCheck.map((n) => n.toLowerCase()));
    const result = new Map<string, number>();

    // Each entry is "N CardName" (e.g., "20 Slime Against Humanity", "1 Sol Ring")
    for (const entry of deckList) {
      const match = entry.match(/^(\d+)\s+(.+)$/);
      if (match) {
        const quantity = parseInt(match[1], 10);
        const name = match[2].trim();
        if (quantity > 1 && lookupSet.has(name.toLowerCase())) {
          // Use the original casing from cardNamesToCheck
          const originalName = cardNamesToCheck.find((n) => n.toLowerCase() === name.toLowerCase());
          result.set(originalName ?? name, quantity);
          logger.debug(
            `[EDHREC] Found ${quantity} copies of "${originalName ?? name}" in average deck`
          );
        }
      }
    }

    return result;
  } catch (error) {
    logger.warn('[EDHREC] Failed to fetch average deck multi-copies:', error);
    return null;
  }
}

// --- Combo data ---

const comboCache = new Map<string, { data: EDHRECCombo[]; timestamp: number }>();

interface RawComboEntry {
  cardviews: { name: string; id: string; sanitized: string }[];
  href?: string;
  combo: {
    comboId: string;
    count: number;
    results: string[];
    nonCardPrerequisiteCount: number;
    rank: number;
    comboVote?: { bracket: string };
  };
}

// Maps comboId → EDHREC href path (e.g. "/combos/golgari/250-779")
// Populated when combo list is fetched, used by fetchComboDetails
const comboHrefMap = new Map<string, string>();

interface RawComboResponse {
  container?: {
    json_dict?: {
      cardlists?: RawComboEntry[];
    };
  };
}

/**
 * Fetch known combos for a commander from EDHREC.
 * Returns combos sorted by popularity (deckCount descending).
 */
export async function fetchCommanderCombos(commanderName: string): Promise<EDHRECCombo[]> {
  const slug = formatCommanderNameForUrl(commanderName);

  const cached = comboCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  if (offlineActive()) return [];

  try {
    const response = await edhrecFetch<RawComboResponse>(`/pages/combos/${slug}.json`);

    const rawCombos = response.container?.json_dict?.cardlists || [];

    const combos: EDHRECCombo[] = rawCombos.map((entry) => {
      // Store href for later detail fetches
      if (entry.href) comboHrefMap.set(entry.combo.comboId, entry.href);
      const cards = entry.cardviews.map((cv) => ({ name: cv.name, id: cv.id }));
      const rawBracket = entry.combo.comboVote?.bracket;
      return {
        comboId: entry.combo.comboId,
        cards,
        results: entry.combo.results || [],
        deckCount: entry.combo.count || 0,
        rank: entry.combo.rank || 0,
        bracket: typeof rawBracket === 'number' ? rawBracket : null,
        bracketTag: null,
        prereqCount: entry.combo.nonCardPrerequisiteCount || 0,
        cardCount: cards.length,
        href: entry.href ?? null,
      };
    });

    combos.sort((a, b) => b.deckCount - a.deckCount);

    comboCache.set(slug, { data: combos, timestamp: Date.now() });
    return combos;
  } catch (error) {
    logger.error(`[EDHREC] Failed to fetch combos for ${commanderName}:`, error);
    return [];
  }
}

// --- EDHREC combo details ---

export interface ComboDetails {
  prerequisites: string[];
  steps: string[];
  results: string[];
}

const comboDetailsCache = new Map<string, ComboDetails>();

interface RawComboDetailResponse {
  combo?: {
    prerequisites?: { description: string; zones: string[] }[];
    steps?: string[];
    results?: string[];
  };
}

/**
 * Fetch detailed combo info (prerequisites, steps, results) from EDHREC's
 * combo detail page JSON. Uses the href captured during combo list fetch.
 */
export async function fetchComboDetails(comboId: string): Promise<ComboDetails> {
  const cached = comboDetailsCache.get(comboId);
  if (cached) return cached;

  const href = comboHrefMap.get(comboId);
  if (!href) throw new Error(`No EDHREC href for combo ${comboId}`);

  const data = await edhrecFetch<RawComboDetailResponse>(`/pages${href}.json`);
  const combo = data.combo;
  if (!combo) throw new Error('No combo data in response');

  const details: ComboDetails = {
    prerequisites: combo.prerequisites?.map((p) => p.description).filter(Boolean) ?? [],
    steps: combo.steps ?? [],
    results: combo.results ?? [],
  };

  comboDetailsCache.set(comboId, details);
  return details;
}

// --- Card-page lift data ---
//
// EDHREC's per-card page (`/pages/cards/<slug>.json`) lists co-played cards
// under `highliftcards` (distinctive co-plays) and `topcards` (most-played-
// with), plus assorted meta lists (top/new commanders, new cards) that don't
// belong in a co-play candidate pool. Each cardview carries a raw `lift` +
// `inclusion`/`num_decks`/`potential_decks` but no ready-made co-play
// percentage — derived below. The page's top-level `similar` list is
// intentionally not consumed here; it's already indexed locally via
// cardSimilar.ts + public/card-similar.json.

interface RawCardPageView {
  id?: string;
  // Optional despite EDHREC always sending it: toLiftEntry defensively guards
  // a missing/empty name at runtime, so the type shouldn't overpromise.
  name?: string;
  sanitized?: string;
  url?: string;
  lift?: number;
  inclusion?: number;
  num_decks?: number;
  potential_decks?: number;
}

interface RawCardPageList {
  tag: string;
  header?: string;
  cardviews: RawCardPageView[];
}

interface RawCardPageResponse {
  container?: {
    json_dict?: {
      cardlists?: RawCardPageList[];
      similar?: string[]; // not consumed here — see cardSimilar.ts
    };
  };
}

// Aggregate/other-commander lists — not genuine co-play candidates.
const LIFT_POOL_SKIP_TAGS = new Set(['topcommanders', 'newcommanders', 'newcards']);

/** Strict floor: entries below this sample size are kept but flagged `lowSample`. */
export const LIFT_STRICT_FLOOR = 50;

/**
 * Adaptive low-sample floor: a cardview needs at least this many co-occurring
 * decks to enter the pool at all, scaled down for a niche seed card whose
 * overall potential-deck count is small (otherwise niche seeds would yield an
 * empty pool under the flat strict floor).
 */
export function liftDeckFloor(potentialDecks: number): number {
  return Math.min(50, Math.max(12, Math.round(potentialDecks * 0.02)));
}

function toLiftEntry(cv: RawCardPageView): LiftEntry | null {
  const lift = cv.lift ?? 0;
  if (!cv.name || lift <= 0) return null;
  const numDecks = cv.num_decks ?? cv.inclusion ?? 0;
  const potentialDecks = cv.potential_decks ?? 0;
  if (numDecks < liftDeckFloor(potentialDecks)) return null;
  return {
    name: cv.name,
    lift,
    coPlayPct: potentialDecks > 0 ? Math.round((numDecks / potentialDecks) * 100) : 0,
    numDecks,
    potentialDecks,
    lowSample: numDecks < LIFT_STRICT_FLOOR,
  };
}

/**
 * Pool of co-play candidates from a card page: every non-meta cardlist,
 * floor-filtered and deduped by name (keeping the max-lift occurrence),
 * sorted by lift descending.
 */
export function parseCardLiftPool(raw: RawCardPageResponse): LiftEntry[] {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const byName = new Map<string, LiftEntry>();
  for (const list of lists) {
    if (LIFT_POOL_SKIP_TAGS.has(list.tag)) continue;
    for (const cv of list.cardviews ?? []) {
      const entry = toLiftEntry(cv);
      if (!entry) continue;
      const existing = byName.get(entry.name);
      if (!existing || entry.lift > existing.lift) byName.set(entry.name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => b.lift - a.lift || a.name.localeCompare(b.name));
}

/**
 * The two headline card-page relation lists on their own, floor-filtered but
 * NOT deduped/re-sorted against each other — callers that want "why this
 * card" evidence get EDHREC's own curated order.
 */
export function parseCardRelations(raw: RawCardPageResponse): {
  highLift: LiftEntry[];
  topCards: LiftEntry[];
} {
  const lists = raw.container?.json_dict?.cardlists ?? [];
  const build = (tag: string): LiftEntry[] => {
    const cardviews = lists.find((l) => l.tag === tag)?.cardviews ?? [];
    const out: LiftEntry[] = [];
    for (const cv of cardviews) {
      const entry = toLiftEntry(cv);
      if (entry) out.push(entry);
    }
    return out;
  };
  return { highLift: build('highliftcards'), topCards: build('topcards') };
}

const cardPageCache = new Map<string, { raw: RawCardPageResponse; timestamp: number }>();
const CARD_PAGE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Shared by fetchCardLiftPool/fetchCardRelations so a card page is fetched
// (and rate-limited) at most once per TTL window regardless of which caller
// asks first.
async function fetchRawCardPage(cardName: string): Promise<RawCardPageResponse | null> {
  const slug = formatCommanderNameForUrl(cardName);

  const cached = cardPageCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CARD_PAGE_CACHE_TTL) return cached.raw;

  if (offlineActive()) return null;

  try {
    const raw = await edhrecFetch<RawCardPageResponse>(`/pages/cards/${slug}.json`);
    cardPageCache.set(slug, { raw, timestamp: Date.now() });
    return raw;
  } catch (error) {
    logger.warn(`[EDHREC] Failed to fetch card page for "${cardName}":`, error);
    return null;
  }
}

/**
 * Co-play candidate pool for a single seed card, sourced from its EDHREC
 * card page. Soft-fails to `[]` on any network/offline issue — this feeds
 * deck generation, which must continue without EDHREC lift data.
 */
export async function fetchCardLiftPool(cardName: string): Promise<LiftEntry[]> {
  const raw = await fetchRawCardPage(cardName);
  return raw ? parseCardLiftPool(raw) : [];
}

/**
 * The headline `highliftcards`/`topcards` relations for a single seed card —
 * the "why this card" evidence lists, as opposed to the merged pool above.
 */
export async function fetchCardRelations(
  cardName: string
): Promise<{ highLift: LiftEntry[]; topCards: LiftEntry[] }> {
  const raw = await fetchRawCardPage(cardName);
  return raw ? parseCardRelations(raw) : { highLift: [], topCards: [] };
}
