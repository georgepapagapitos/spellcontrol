import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { sendGzippedJson } from '../gzip-json';
import { getScryfallCache } from '../scryfall-cache';

/**
 * How old a cached printing may be and still be trusted for money. The bulk
 * ingest restamps every printing nightly, so a healthy cache is always well
 * inside this; the extra half-day is slack for one missed run. Past it we go
 * live rather than quote prices from a dump that stopped arriving.
 */
export const PRICE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/**
 * Batch card lookup answered from the nightly bulk dump — the many-name,
 * many-id sibling of `/api/cards/named`, for the deck builder's batched
 * resolves (`getCardsByNames` / `getCardsByIds`). Before this, those were
 * always live `POST /cards/collection` batches from the browser, and every
 * name the batch dropped became a per-name `/cards/search` from the user's IP
 * — E333 counted 23 of them, all CORS-blocked 429s, after ONE cube build.
 *
 * Same rule as `/api/cards/named`: **cache-only, never a live Scryfall fetch.**
 * A miss is simply absent from the answer and the browser keeps its own live
 * path for it. Gated at PRICE_MAX_AGE_MS because the answer carries prices.
 *
 * Body: { names?: string[], ids?: string[], currency?: 'usd' | 'eur' } (each de-duplicated, capped at
 * LOOKUP_LIMIT). Response: { byName: Record<name as sent, card>, byId:
 * Record<id, card> }, gzipped like oracle-facts.
 */
export const cardLookupRouter: Router = Router();

const LOOKUP_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

cardLookupRouter.post(
  '/lookup',
  testAwareLimiter({ windowMs: 60_000, max: 240 }),
  (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { names?: unknown; ids?: unknown; currency?: unknown };
    const strings = (v: unknown): string[] =>
      Array.isArray(v)
        ? Array.from(
            new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))
          ).slice(0, LOOKUP_LIMIT)
        : [];
    const names = strings(body.names);
    const ids = strings(body.ids).filter((id) => UUID_RE.test(id));
    if (names.length === 0 && ids.length === 0) {
      return res.status(400).json({ error: 'Body must be { names?: string[], ids?: string[] }.' });
    }
    if (body.currency !== undefined && body.currency !== 'usd' && body.currency !== 'eur') {
      return res.status(400).json({ error: "currency must be 'usd' or 'eur'." });
    }
    sendGzippedJson(
      req,
      res,
      getScryfallCache().lookupCards(names, ids, PRICE_MAX_AGE_MS, body.currency ?? 'usd'),
      'cards/lookup'
    );
  }
);
