import { apiUrl } from './api-base';

/**
 * Read client for EDHREC's top lists, served by our own backend
 * (`GET /api/edhrec/top`). The backend keeps a daily snapshot of each list and
 * serves yesterday's copy when EDHREC can't be reached, so the browser never
 * calls EDHREC for a browse list: an EDHREC outage shows an older list, not an
 * error, and EDHREC sees one request a day instead of one per visitor.
 */

export type EdhrecTopKind = 'commanders' | 'cards' | 'salt';

/** `year` is EDHREC's "past 2 years" list; the UI calls it "2 years". */
export type EdhrecTopPeriod = 'week' | 'month' | 'year';

/** The card-type lists, in the order a picker shows them. Each exists both as
 *  a type-only list and as a section of every colour list. */
export const EDHREC_TOP_TYPES = [
  { value: 'creatures', label: 'Creatures' },
  { value: 'instants', label: 'Instants' },
  { value: 'sorceries', label: 'Sorceries' },
  { value: 'utility-artifacts', label: 'Artifacts' },
  { value: 'mana-artifacts', label: 'Mana rocks' },
  { value: 'enchantments', label: 'Enchantments' },
  { value: 'planeswalkers', label: 'Planeswalkers' },
  { value: 'battles', label: 'Battles' },
  { value: 'utility-lands', label: 'Utility lands' },
  { value: 'lands', label: 'Lands' },
] as const;

export type EdhrecTopType = (typeof EDHREC_TOP_TYPES)[number]['value'];

export function isEdhrecTopType(value: string | null | undefined): value is EdhrecTopType {
  return EDHREC_TOP_TYPES.some((t) => t.value === value);
}

export interface EdhrecTopParams {
  kind: EdhrecTopKind;
  period?: EdhrecTopPeriod;
  /** Colour identity as WUBRG letters (`WU`), or `C` for colorless. */
  colors?: string;
  type?: EdhrecTopType;
}

export interface EdhrecTopEntry {
  rank: number;
  name: string;
  /** EDHREC's printing id, which is a Scryfall card id; null when absent. */
  scryfallId: string | null;
  numDecks: number;
  /** Decks that could have played the card. null on commander and salt lists. */
  potentialDecks: number | null;
  /** EDHREC salt score, 0 to 4; only on the salt list. */
  salt: number | null;
}

export interface EdhrecTopList {
  kind: EdhrecTopKind;
  /** The window the list covers; colour and type lists are always `year`,
   *  and the salt list has none. */
  period: EdhrecTopPeriod | null;
  colors: string | null;
  type: string | null;
  entries: EdhrecTopEntry[];
  /** When the backend last got this list from EDHREC (epoch ms). */
  fetchedAt: number;
  /** True when EDHREC couldn't be reached and this is an older copy. */
  stale: boolean;
  /** The matching page on edhrec.com, for the attribution link. */
  sourceUrl: string;
}

const WUBRG = 'WUBRG';

/** WUBRG-ordered letters, `C` alone for colorless, '' for no filter. */
export function normalizeColors(colors: string | null | undefined): string {
  const upper = (colors ?? '').toUpperCase();
  const picked = [...WUBRG].filter((c) => upper.includes(c)).join('');
  if (picked) return picked;
  return upper.includes('C') ? 'C' : '';
}

/** The query string for a list, normalized so equal lists share one key. */
export function edhrecTopQuery(params: EdhrecTopParams): string {
  const q = new URLSearchParams({ kind: params.kind });
  if (params.kind !== 'salt') {
    const colors = normalizeColors(params.colors);
    const type = params.kind === 'cards' ? params.type : undefined;
    // Colour and type lists only exist for the past 2 years.
    q.set('period', colors || type ? 'year' : (params.period ?? 'week'));
    if (colors) q.set('colors', colors);
    if (type) q.set('type', type);
  }
  return q.toString();
}

/** A session keeps a list for half an hour; the backend refreshes daily. */
const TTL_MS = 30 * 60 * 1000;
const memo = new Map<string, { promise: Promise<EdhrecTopList>; at: number }>();

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* fall through */
  }
  return "Couldn't load this list.";
}

/** One EDHREC top list. Concurrent and repeat calls for the same list share
 *  one request; a failure is forgotten so the next call retries. */
export function fetchEdhrecTop(params: EdhrecTopParams): Promise<EdhrecTopList> {
  const key = edhrecTopQuery(params);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = (async () => {
    const res = await fetch(apiUrl(`/api/edhrec/top?${key}`));
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as EdhrecTopList;
  })();
  memo.set(key, { promise, at: Date.now() });
  promise.catch(() => {
    if (memo.get(key)?.promise === promise) memo.delete(key);
  });
  return promise;
}

/** Test hook: forget every memoized list. */
export function clearEdhrecTopMemo(): void {
  memo.clear();
}
