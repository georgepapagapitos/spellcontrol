import type { Request, RequestHandler, Response } from 'express';
import { logger } from './logger';
import type { ScryfallCard } from './types';

/** Scryfall card UUID. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids read from one request body (the bulk-cache lookup is cheap). */
export const REFRESH_MAX_IDS = 1000;
/** Ids per request allowed to fall through to the live Scryfall API. */
export const REFRESH_LIVE_PER_REQUEST = 150;
/** Live-fallback ids one IP may spend per window, across requests. */
export const REFRESH_LIVE_PER_IP = 600;
const IP_WINDOW_MS = 60_000;
/** How long an id Scryfall did not return is skipped before asking again. */
export const REFRESH_NOT_FOUND_TTL_MS = 10 * 60_000;
/** How long a printing that came back with no price is served unpriced before
 *  Scryfall is asked again. */
export const REFRESH_UNPRICED_TTL_MS = 6 * 60 * 60_000;
const MAX_TRACKED = 20_000;

/** Any market price at all, in any finish or currency. */
function hasPrice(card: ScryfallCard): boolean {
  const p = card.prices ?? {};
  return [p.usd, p.usd_foil, p.usd_etched, p.eur, p.eur_foil].some((v) => Number(v) > 0);
}

export interface RefreshPricesDeps {
  getCached: (ids: string[]) => Map<string, ScryfallCard>;
  fetchLive: (ids: string[]) => Promise<ScryfallCard[]>;
  buildPayload: (cards: ScryfallCard[], now: number) => unknown;
  now?: () => number;
}

/**
 * POST /api/refresh-prices. Open to guests on purpose. The harm to bound is
 * Scryfall 429s on the shared egress IP, so ids that aren't UUIDs never reach
 * Scryfall, live fallbacks are capped per request and per IP, and ids Scryfall
 * did not know are remembered briefly.
 */
export function createRefreshPricesHandler(deps: RefreshPricesDeps): RequestHandler {
  const now = deps.now ?? Date.now;
  const notFound = new Map<string, number>(); // id -> expiry
  const unpriced = new Map<string, number>(); // id -> expiry
  const ipSpend = new Map<string, { resetAt: number; spent: number }>();

  function sweep(t: number) {
    for (const memo of [notFound, unpriced]) {
      if (memo.size > MAX_TRACKED) {
        for (const [id, exp] of memo) if (exp <= t) memo.delete(id);
        if (memo.size > MAX_TRACKED) memo.clear();
      }
    }
    if (ipSpend.size > MAX_TRACKED) {
      for (const [ip, s] of ipSpend) if (s.resetAt <= t) ipSpend.delete(ip);
    }
  }

  return async (req: Request, res: Response) => {
    try {
      const raw = (req.body && (req.body as { scryfallIds?: unknown }).scryfallIds) as unknown;
      if (!Array.isArray(raw)) {
        return res.status(400).json({ error: 'Body must be { scryfallIds: string[] }.' });
      }
      const ids = Array.from(
        new Set(raw.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))
      ).slice(0, REFRESH_MAX_IDS);
      if (ids.length === 0) return res.json({ prices: {} });

      // Daily bulk dump first; only ids it doesn't cover are candidates for the
      // live API (see scryfall-bulk.ts for why the old all-live path 429'd).
      // A row the dump holds with no price counts as not covered: a new set's
      // cards land in the dump before their prices do, and the next ingest is
      // up to a day away (Star Trek Commander's cards read $0.00 that way,
      // 2026-11-06). `unpriced` keeps a printing that really has no price from
      // going live on every request.
      const cached = deps.getCached(ids);
      const t = now();
      sweep(t);
      const liveOk = (memo: Map<string, number>, id: string) => {
        const exp = memo.get(id);
        return !(exp !== undefined && exp > t);
      };
      const candidates = ids.filter((id) => {
        const row = cached.get(id);
        if (row) return !hasPrice(row) && liveOk(unpriced, id);
        return liveOk(notFound, id);
      });

      const ip = req.ip ?? 'unknown';
      let spend = ipSpend.get(ip);
      if (!spend || spend.resetAt <= t) {
        spend = { resetAt: t + IP_WINDOW_MS, spent: 0 };
        ipSpend.set(ip, spend);
      }
      const allowance = Math.max(
        0,
        Math.min(REFRESH_LIVE_PER_REQUEST, REFRESH_LIVE_PER_IP - spend.spent)
      );
      const live = candidates.slice(0, allowance);
      spend.spent += live.length;

      const fetched = live.length > 0 ? await deps.fetchLive(live) : [];
      if (live.length > 0) {
        const got = new Set(fetched.map((c) => c.id));
        // An empty result means the fetch gave up (429 retries, network), not
        // that every id is unknown, so only a partial answer is remembered.
        if (fetched.length > 0) {
          for (const id of live) if (!got.has(id)) notFound.set(id, t + REFRESH_NOT_FOUND_TTL_MS);
        }
        for (const card of fetched) {
          if (!hasPrice(card)) unpriced.set(card.id, t + REFRESH_UNPRICED_TTL_MS);
        }
        logger.info(
          `[refresh-prices] ${cached.size}/${ids.length} from bulk cache, ${live.length} live` +
            (candidates.length > live.length
              ? ` (${candidates.length - live.length} deferred)`
              : '')
        );
      }
      // A live answer replaces the dump's unpriced row for the same printing.
      const byId = new Map(cached);
      for (const card of fetched) byId.set(card.id, card);
      res.json(deps.buildPayload([...byId.values()], t));
    } catch (err) {
      logger.error('[refresh-prices] error:', err);
      res.status(500).json({ error: 'Price refresh failed.' });
    }
  };
}
