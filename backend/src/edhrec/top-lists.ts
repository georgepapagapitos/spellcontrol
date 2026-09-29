/**
 * EDHREC's public "top" lists (top commanders, top cards, saltiest cards),
 * as the pure half of GET /api/edhrec/top: query validation, the list key,
 * the EDHREC path each key maps to, and the response parser. No I/O here;
 * top-store.ts fetches, stores and serves.
 *
 * Every EDHREC path is built from the enums below, never from raw request
 * input, so only allowlisted pages can ever be fetched.
 *
 * Verified live 2026-09-29 (all 81 pages 200): colour and type pages carry
 * the same deck counts as the 2-year list, so they are 2-year lists and a
 * colour or type filter always answers with period `year`.
 */

export const TOP_LIST_KINDS = ['commanders', 'cards', 'salt'] as const;
export type TopListKind = (typeof TOP_LIST_KINDS)[number];

/** `year` is EDHREC's "past 2 years" page. */
export const TOP_LIST_PERIODS = ['week', 'month', 'year'] as const;
export type TopListPeriod = (typeof TOP_LIST_PERIODS)[number];

export const TOP_CARD_TYPES = [
  'creatures',
  'instants',
  'sorceries',
  'utility-artifacts',
  'mana-artifacts',
  'enchantments',
  'planeswalkers',
  'battles',
  'utility-lands',
  'lands',
] as const;
export type TopCardType = (typeof TOP_CARD_TYPES)[number];

/** A colour page holds one cardlist per type, tagged without the hyphen. */
const COLOUR_PAGE_TYPE_TAG: Record<TopCardType, string> = {
  creatures: 'creatures',
  instants: 'instants',
  sorceries: 'sorceries',
  'utility-artifacts': 'utilityartifacts',
  'mana-artifacts': 'manaartifacts',
  enchantments: 'enchantments',
  planeswalkers: 'planeswalkers',
  battles: 'battles',
  'utility-lands': 'utilitylands',
  lands: 'lands',
};

/** Two or more colours: the same slug on the commander and card pages. */
const MULTICOLOUR_SLUG: Record<string, string> = {
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

/** `/pages/commanders/<slug>.json`. Mono colours are `mono-<colour>` here. */
export const COMMANDER_COLOUR_SLUG: Record<string, string> = {
  C: 'colorless',
  W: 'mono-white',
  U: 'mono-blue',
  B: 'mono-black',
  R: 'mono-red',
  G: 'mono-green',
  ...MULTICOLOUR_SLUG,
};

/** `/pages/top/<slug>.json`. Mono colours are the bare colour here
 *  (`/top/mono-white.json` is 403, `/top/white.json` is 200). */
export const CARD_COLOUR_SLUG: Record<string, string> = {
  C: 'colorless',
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  ...MULTICOLOUR_SLUG,
};

const WUBRG = 'WUBRG';

export interface TopListKey {
  kind: TopListKind;
  period: TopListPeriod | null;
  /** WUBRG-ordered letters, or `C` for colorless. */
  colors: string | null;
  type: TopCardType | null;
}

export type TopListQueryResult = { ok: true; key: TopListKey } | { ok: false; error: string };

function isOneOf<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

/** `undefined` when absent, the string when a single value, `false` for an
 *  array or object (a repeated or bracketed query param). */
function single(v: unknown): string | undefined | false {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : false;
}

/** Normalises a colour filter to WUBRG order, or `C`. `null` = no filter. */
export function normalizeColors(raw: string): string | null | false {
  const upper = raw.trim().toUpperCase();
  if (upper === '') return null;
  if (upper === 'C') return 'C';
  const letters = new Set(upper);
  if (letters.size !== upper.length) return false;
  for (const l of letters) if (!WUBRG.includes(l)) return false;
  return [...WUBRG].filter((l) => letters.has(l)).join('');
}

/** Validates the request's query into a list key. Every EDHREC fetch goes
 *  through a key built here, never through the raw query. */
export function parseTopListQuery(query: Record<string, unknown>): TopListQueryResult {
  const kind = single(query.kind);
  if (!isOneOf(TOP_LIST_KINDS, kind)) {
    return { ok: false, error: 'Choose a list: commanders, cards or salt.' };
  }

  const periodRaw = single(query.period);
  if (periodRaw === false || (periodRaw !== undefined && !isOneOf(TOP_LIST_PERIODS, periodRaw))) {
    return { ok: false, error: 'Period must be week, month or year.' };
  }

  const colorsRaw = single(query.colors);
  if (colorsRaw === false) return { ok: false, error: 'Colors must be WUBRG letters, or C.' };
  const colors = colorsRaw === undefined ? null : normalizeColors(colorsRaw);
  if (colors === false) return { ok: false, error: 'Colors must be WUBRG letters, or C.' };

  const typeRaw = single(query.type);
  if (typeRaw === false || (typeRaw !== undefined && !isOneOf(TOP_CARD_TYPES, typeRaw))) {
    return { ok: false, error: `Type must be one of: ${TOP_CARD_TYPES.join(', ')}.` };
  }
  const type = typeRaw ?? null;

  if (kind === 'salt') {
    if (colors !== null || type !== null) {
      return { ok: false, error: "The salt list can't be filtered by colour or type." };
    }
    return { ok: true, key: { kind, period: null, colors: null, type: null } };
  }
  if (kind === 'commanders' && type !== null) {
    return { ok: false, error: 'Only the card list can be filtered by type.' };
  }
  // Colour and type pages are 2-year lists (see the header comment).
  const period: TopListPeriod =
    colors !== null || type !== null
      ? 'year'
      : ((periodRaw as TopListPeriod | undefined) ?? 'week');
  return { ok: true, key: { kind, period, colors, type } };
}

/** The storage key: one row per distinct list. */
export function listKeyString(key: TopListKey): string {
  return [key.kind, key.period ?? '-', key.colors ?? '-', key.type ?? '-'].join(':');
}

/** The JSON page a key maps to, e.g. `/pages/commanders/week.json`. */
export function edhrecPathFor(key: TopListKey): string {
  if (key.kind === 'salt') return '/pages/top/salt.json';
  if (key.kind === 'commanders') {
    return key.colors
      ? `/pages/commanders/${COMMANDER_COLOUR_SLUG[key.colors]}.json`
      : `/pages/commanders/${key.period}.json`;
  }
  if (key.colors) return `/pages/top/${CARD_COLOUR_SLUG[key.colors]}.json`;
  if (key.type) return `/pages/top/${key.type}.json`;
  return `/pages/top/${key.period}.json`;
}

/** The human page on edhrec.com for the same list (the JSON path minus
 *  `/pages` and `.json`; verified to resolve for every shape). */
export function sourceUrlFor(key: TopListKey): string {
  return `https://edhrec.com${edhrecPathFor(key)
    .replace(/^\/pages/, '')
    .replace(/\.json$/, '')}`;
}

export interface TopListEntry {
  rank: number;
  name: string;
  /** EDHREC's `id` is a Scryfall printing id. */
  scryfallId: string | null;
  numDecks: number;
  /** Decks that could have played it. EDHREC sends 0 when it doesn't know. */
  potentialDecks: number | null;
  salt: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export class TopListParseError extends Error {}

/**
 * Parses an EDHREC page body into ranked entries for `key`. Throws
 * TopListParseError on a `redirect` body, a missing cardlist array, or (for a
 * list that must exist) a missing list. A colour page with no list for the
 * requested type is a real empty list: EDHREC omits the tag when no card of
 * that type has that identity (Bant has no battles).
 */
export function parseTopList(body: unknown, key: TopListKey): TopListEntry[] {
  const root = asRecord(body);
  if (!root) throw new TopListParseError('EDHREC sent something that is not a JSON object.');
  if ('redirect' in root)
    throw new TopListParseError(`EDHREC redirected to ${String(root.redirect)}.`);
  const lists = asRecord(asRecord(root.container)?.json_dict)?.cardlists;
  if (!Array.isArray(lists)) throw new TopListParseError('EDHREC sent a page with no card lists.');

  let list: Record<string, unknown> | null;
  if (key.kind === 'cards' && key.colors) {
    const tag = key.type ? COLOUR_PAGE_TYPE_TAG[key.type] : 'topcards';
    list = lists.map(asRecord).find((l) => l?.tag === tag) ?? null;
    if (!list) {
      if (key.type) return [];
      throw new TopListParseError('EDHREC sent a colour page with no top cards.');
    }
  } else {
    list = asRecord(lists[0]);
    if (!list) throw new TopListParseError('EDHREC sent an empty card list page.');
  }

  const views = Array.isArray(list.cardviews) ? list.cardviews : [];
  const out: TopListEntry[] = [];
  for (const raw of views) {
    const cv = asRecord(raw);
    const name = typeof cv?.name === 'string' ? cv.name.trim() : '';
    if (!cv || !name) continue;
    // A commander list's "A // B" rows are partner pairs, not one card
    // (same rule as the frontend client). Split cards keep theirs.
    if (key.kind === 'commanders' && name.includes(' // ')) continue;
    const potential = num(cv.potential_decks);
    out.push({
      rank: out.length + 1,
      name,
      scryfallId: typeof cv.id === 'string' && UUID_RE.test(cv.id) ? cv.id : null,
      numDecks: num(cv.num_decks) ?? num(cv.inclusion) ?? 0,
      potentialDecks: potential !== null && potential > 0 ? potential : null,
      salt: num(cv.salt),
    });
  }
  return out;
}
