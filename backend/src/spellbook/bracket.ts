import { createHash } from 'node:crypto';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';

/**
 * A second opinion on a deck's bracket from Commander Spellbook's
 * `/estimate-bracket` (E1101). Their API guidelines
 * (commander-spellbook-backend docs/api.md) allow sparse unauthenticated use
 * from a third-party tool if it names itself in the User-Agent, handles 429
 * with a back-off, and credits and links back. The backend is MIT licensed.
 *
 * We call it from the server only: the browser never reaches Spellbook, the
 * answer for one decklist is cached for everyone, and a single global budget
 * keeps us under their suggested 80 requests a minute however many users ask.
 *
 * Their scheme is NOT ours. It is a set of named tags (Exhibition, Core,
 * Oddball, Powerful, Spicy, Ruthless, plus Banned), so the tag passes through
 * untouched and nothing maps it onto B1 to B5.
 */

export const SPELLBOOK_ESTIMATE_URL = 'https://backend.commanderspellbook.com/estimate-bracket';
export const SPELLBOOK_USER_AGENT = 'spellcontrol/1.0';
const TIMEOUT_MS = 8_000;
/** Their suggested safe rate is 80/min; stay well under it. */
const UPSTREAM_PER_MINUTE = 40;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
/** After a 429 or a failure, don't try upstream again for this long. */
const BACKOFF_MS = 30_000;
const RETRY_AFTER_CAP_MS = 5 * 60_000;

/** The tags Spellbook's `bracketTag` can hold. */
export const SPELLBOOK_TAGS = ['E', 'C', 'O', 'P', 'S', 'R', 'B'] as const;
export type SpellbookTag = (typeof SPELLBOOK_TAGS)[number];

export interface DeckList {
  commanders: string[];
  cards: { name: string; quantity: number }[];
}

export interface SpellbookBracket {
  tag: SpellbookTag;
}

export class SpellbookUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = 'SpellbookUnavailableError';
  }
}

const NAME_MAX = 200;
const CARDS_MAX = 400;

/** The validated, merged decklist, or the message to answer 400 with. */
export function parseDeckList(body: unknown): DeckList | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'Invalid request.';
  const b = body as Record<string, unknown>;
  const name = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= NAME_MAX ? v.trim() : null;
  const commanders: string[] = [];
  if (b.commanders !== undefined) {
    if (!Array.isArray(b.commanders) || b.commanders.length > 2) return 'At most two commanders.';
    for (const c of b.commanders) {
      const n = name(c);
      if (!n) return 'Invalid commander.';
      commanders.push(n);
    }
  }
  if (!Array.isArray(b.cards) || b.cards.length < 1 || b.cards.length > CARDS_MAX) {
    return `Send between 1 and ${CARDS_MAX} cards.`;
  }
  const counts = new Map<string, number>();
  for (const raw of b.cards) {
    if (typeof raw !== 'object' || raw === null) return 'Invalid card.';
    const r = raw as Record<string, unknown>;
    const n = name(r.name);
    const q = r.quantity;
    if (!n || typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 99) {
      return 'Invalid card.';
    }
    counts.set(n, (counts.get(n) ?? 0) + q);
  }
  return {
    commanders: [...new Set(commanders)],
    cards: [...counts].map(([n, q]) => ({ name: n, quantity: q })),
  };
}

/** SHA-256 of the list with commanders and cards sorted, so order never splits the cache. */
export function deckListKey(list: DeckList): string {
  const lines = [
    ...list.commanders.map((n) => `C ${n}`),
    ...list.cards.map((c) => `${c.quantity} ${c.name}`),
  ]
    .map((l) => l.toLowerCase())
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Maps Spellbook's payload to ours; null when it isn't the shape we know. */
export function parseEstimate(json: unknown, list: DeckList): SpellbookBracket | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;
  const tag = j.bracketTag;
  if (typeof tag !== 'string' || !(SPELLBOOK_TAGS as readonly string[]).includes(tag)) return null;
  // Spellbook skips names it doesn't know and answers "Exhibition" for what is
  // left, so a mostly unrecognized list would read as a real low verdict.
  if (!Array.isArray(j.cards)) return null;
  const submitted = list.cards.length + list.commanders.length;
  if (j.cards.length * 2 < submitted) return null;
  return { tag: tag as SpellbookTag };
}

interface Entry {
  value: SpellbookBracket;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<SpellbookBracket>>();
let blockedUntil = 0;
let windowStart = 0;
let windowCount = 0;

/** Test hook: forget the cache, the budget and the back-off. */
export function resetSpellbookState(): void {
  cache.clear();
  inflight.clear();
  blockedUntil = 0;
  windowStart = 0;
  windowCount = 0;
}

function takeBudget(now: number): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= UPSTREAM_PER_MINUTE) return false;
  windowCount++;
  return true;
}

function retryAfterMs(res: Response): number {
  const h = res.headers.get('retry-after');
  const s = h ? Number(h) : NaN;
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, RETRY_AFTER_CAP_MS) : BACKOFF_MS;
}

async function callUpstream(list: DeckList, now: number): Promise<SpellbookBracket> {
  if (now < blockedUntil) {
    throw new SpellbookUnavailableError('backing off', Math.ceil((blockedUntil - now) / 1000));
  }
  if (!takeBudget(now)) throw new SpellbookUnavailableError('budget spent', 30);
  let res: Response;
  try {
    res = await fetch(SPELLBOOK_ESTIMATE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': SPELLBOOK_USER_AGENT,
      },
      body: JSON.stringify({
        main: list.cards.map((c) => ({ card: c.name, quantity: c.quantity })),
        commanders: list.commanders.map((n) => ({ card: n, quantity: 1 })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    blockedUntil = now + BACKOFF_MS;
    logger.warn(`[spellbook] estimate request failed: ${errorMessage(err)}`);
    throw new SpellbookUnavailableError('request failed', 30);
  }
  if (res.status === 429) {
    const wait = retryAfterMs(res);
    blockedUntil = now + wait;
    logger.warn(`[spellbook] 429, backing off ${Math.round(wait / 1000)}s`);
    throw new SpellbookUnavailableError('rate limited', Math.ceil(wait / 1000));
  }
  if (!res.ok) {
    blockedUntil = now + BACKOFF_MS;
    logger.warn(`[spellbook] estimate answered ${res.status}`);
    throw new SpellbookUnavailableError(`status ${res.status}`, 30);
  }
  const parsed = parseEstimate(await res.json().catch(() => null), list);
  if (!parsed) throw new SpellbookUnavailableError('unreadable answer', 60);
  return parsed;
}

/**
 * The cached verdict for a decklist, asking Spellbook on a miss. Concurrent
 * asks for one list share one upstream call. Throws SpellbookUnavailableError
 * when there is no verdict to give.
 */
export async function getSpellbookBracket(
  list: DeckList,
  now = Date.now()
): Promise<{ bracket: SpellbookBracket; cached: boolean }> {
  const key = deckListKey(list);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return { bracket: hit.value, cached: true };
  let pending = inflight.get(key);
  if (!pending) {
    pending = callUpstream(list, now)
      .then((value) => {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { value, at: now });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return { bracket: await pending, cached: false };
}
