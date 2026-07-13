/**
 * Fetches Scryfall's full set list (~800 sets, small payload) and caches it in memory.
 * Refreshes once per TTL window. Concurrent calls share a single in-flight request.
 */

import { SCRYFALL_USER_AGENT } from './scryfall';

interface ScryfallSet {
  code: string;
  name: string;
  icon_svg_uri: string;
  released_at?: string;
  card_count?: number;
}

interface ScryfallSetsResponse {
  object: 'list';
  data: ScryfallSet[];
}

export interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
  /** Number of cards in the set per Scryfall — the set-completion denominator. */
  cardCount: number;
}

export type SetMap = Record<string, SetSummary>;

const TTL_MS = 24 * 60 * 60 * 1000;
const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';

let cached: { at: number; map: SetMap } | null = null;
let inFlight: Promise<SetMap> | null = null;

export async function getSetMap(): Promise<SetMap> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.map;
  if (inFlight) return inFlight;

  inFlight = fetchSetMap()
    .then((map) => {
      cached = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function fetchSetMap(): Promise<SetMap> {
  const response = await fetch(SCRYFALL_SETS_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': SCRYFALL_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Scryfall /sets returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as ScryfallSetsResponse;
  const map: SetMap = {};
  for (const s of json.data) {
    const code = s.code.toUpperCase();
    map[code] = {
      code,
      name: s.name,
      iconSvgUri: s.icon_svg_uri,
      releasedAt: s.released_at ?? '',
      cardCount: s.card_count ?? 0,
    };
  }
  return map;
}

/**
 * Full card list of one set (every printing/variation, collector-number order),
 * trimmed to the Scryfall fields the frontend's tiles + add-to-collection flow
 * consume. Cached in memory per set code, same TTL policy as the set map.
 */

// Scryfall-shaped subset — field names stay snake_case so the frontend can
// treat rows as ScryfallCard without a mapping layer.
export interface SetCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name?: string;
  collector_number: string;
  rarity?: string;
  layout?: string;
  cmc?: number;
  type_line?: string;
  mana_cost?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  edhrec_rank?: number;
  finishes?: string[];
  promo_types?: string[];
  frame_effects?: string[];
  full_art?: boolean;
  border_color?: string;
  legalities?: Record<string, string>;
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
  image_uris?: { small?: string; normal?: string; large?: string };
  card_faces?: Array<{
    name?: string;
    type_line?: string;
    mana_cost?: string;
    oracle_text?: string;
    colors?: string[];
    image_uris?: { small?: string; normal?: string; large?: string };
  }>;
}

export class SetNotFoundError extends Error {}

const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';
// Safety valve on next_page loops — 30 pages × 175 cards covers even Secret
// Lair Drop, the largest single set code.
const MAX_SET_PAGES = 30;
// ponytail: unbounded per-code cache; sets are a few hundred KB each and only
// visited codes cache — add LRU eviction if backend memory ever matters.
const setCardsCache = new Map<string, { at: number; cards: SetCard[] }>();
const setCardsInFlight = new Map<string, Promise<SetCard[]>>();

function trimImageUris(u?: SetCard['image_uris']): SetCard['image_uris'] | undefined {
  if (!u) return undefined;
  return { small: u.small, normal: u.normal, large: u.large };
}

function trimSetCard(raw: SetCard): SetCard {
  return {
    id: raw.id,
    oracle_id: raw.oracle_id,
    name: raw.name,
    set: raw.set,
    set_name: raw.set_name,
    collector_number: raw.collector_number,
    rarity: raw.rarity,
    layout: raw.layout,
    cmc: raw.cmc,
    type_line: raw.type_line,
    mana_cost: raw.mana_cost,
    oracle_text: raw.oracle_text,
    colors: raw.colors,
    color_identity: raw.color_identity,
    edhrec_rank: raw.edhrec_rank,
    finishes: raw.finishes,
    promo_types: raw.promo_types,
    frame_effects: raw.frame_effects,
    full_art: raw.full_art,
    border_color: raw.border_color,
    legalities: raw.legalities,
    prices: raw.prices
      ? { usd: raw.prices.usd, usd_foil: raw.prices.usd_foil, usd_etched: raw.prices.usd_etched }
      : undefined,
    image_uris: trimImageUris(raw.image_uris),
    card_faces: raw.card_faces?.map((f) => ({
      name: f.name,
      type_line: f.type_line,
      mana_cost: f.mana_cost,
      oracle_text: f.oracle_text,
      colors: f.colors,
      image_uris: trimImageUris(f.image_uris),
    })),
  };
}

export async function getSetCards(code: string): Promise<SetCard[]> {
  const key = code.toLowerCase();
  const hit = setCardsCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cards;
  const inFlight = setCardsInFlight.get(key);
  if (inFlight) return inFlight;

  const p = fetchSetCards(key)
    .then((cards) => {
      setCardsCache.set(key, { at: Date.now(), cards });
      return cards;
    })
    .finally(() => {
      setCardsInFlight.delete(key);
    });
  setCardsInFlight.set(key, p);
  return p;
}

async function fetchSetCards(code: string): Promise<SetCard[]> {
  // include_extras + include_variations so the list length matches the set's
  // card_count (alt-art variants, borderless etc. are part of the checklist).
  const params = new URLSearchParams({
    q: `e:${code}`,
    unique: 'prints',
    order: 'set',
    include_extras: 'true',
    include_variations: 'true',
  });
  let url = `${SCRYFALL_SEARCH_URL}?${params}`;
  const cards: SetCard[] = [];
  for (let page = 0; page < MAX_SET_PAGES; page++) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': SCRYFALL_USER_AGENT },
    });
    if (response.status === 404) {
      throw new SetNotFoundError(`No cards found for set "${code}".`);
    }
    if (!response.ok) {
      throw new Error(`Scryfall search for e:${code} returned HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      data: SetCard[];
      has_more?: boolean;
      next_page?: string;
    };
    for (const raw of json.data) cards.push(trimSetCard(raw));
    if (!json.has_more || !json.next_page) return cards;
    url = json.next_page;
    // Scryfall asks for 50-100ms between requests.
    await new Promise((r) => setTimeout(r, 100));
  }
  return cards;
}
