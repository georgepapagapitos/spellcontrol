import { logger } from '../logger';
import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../auth';
import { testAwareLimiter } from '../route-utils';
import {
  ensureOracleBulkBuilding,
  getOracleBulkStatus,
  refreshOracleBulk,
  type BulkStatus,
} from '../offline/bulk-cache';
import { getCombosBulk } from '../offline/combos-export';
import type { OfflineManifest } from '../offline/types';

export const offlineRouter: Router = Router();

// Bulk downloads are large (multi-megabyte) but called rarely — once per
// user per week typically. Keep a generous limiter to allow re-downloads
// after a clear-and-retry without rate-limiting normal users.
const bulkLimiter = testAwareLimiter({ windowMs: 60_000, max: 10 });
// Version/manifest reads, not bulk transfers: each is one small JSON answer,
// so bulkLimiter's 10/min is far too tight while unbounded is not an option
// either.
//
// 600/min, not the 120 this shipped with. "Roughly once per app load" was only
// true of the steady state: `fetchManifest` in download.ts retries this
// endpoint with backoff for up to three minutes while the oracle bulk warms
// after a deploy, so every client behind one venue address piles into the same
// window. 120 was reachable by a mid-sized pod doing nothing wrong.
const manifestLimiter = testAwareLimiter({ windowMs: 60_000, max: 600 });

/**
 * Tell the client to retry in a few seconds rather than blocking the request
 * while a 30-60s Scryfall bulk download + parse is in flight. Without this
 * the very first manifest request after a fresh deploy tripped nginx's
 * upstream timeout → 502 to the user. Kicks off a build in the background
 * if one isn't already running so the next retry has a chance to succeed.
 */
function sendBuilding(res: Response, status: BulkStatus): void {
  ensureOracleBulkBuilding();
  res.set('Retry-After', '5');
  res.status(503).json({
    error: 'Offline data is still being prepared on the server. Retry in a few seconds.',
    state: status.state,
    lastError: status.error?.message,
  });
}

/**
 * Manifest: tells the client which version of the oracle/combos bulks are
 * available so it can decide whether to re-download. Cheap and frequent —
 * MUST NOT block on a 30-60s bulk build (see sendBuilding).
 */
offlineRouter.get('/manifest', manifestLimiter, async (_req: Request, res: Response) => {
  const oracleStatus = getOracleBulkStatus();
  if (oracleStatus.state !== 'ready' || !oracleStatus.payload) {
    sendBuilding(res, oracleStatus);
    return;
  }
  try {
    const combos = await getCombosBulk();
    const manifest: OfflineManifest = {
      oracleVersion: oracleStatus.payload.version,
      oracleCardCount: oracleStatus.payload.cardCount,
      oracleByteSize: oracleStatus.payload.gzippedBytes,
      oracleUpdatedAt: oracleStatus.payload.updatedAt,
      combosVersion: combos.version,
      combosCount: combos.comboCount,
      combosByteSize: combos.gzippedBytes,
      combosUpdatedAt: combos.updatedAt,
    };
    res.set('Cache-Control', 'public, max-age=300');
    res.json(manifest);
  } catch (err) {
    logger.error('[offline] manifest failed:', err);
    res.status(503).json({ error: 'Offline data not yet available. Try again shortly.' });
  }
});

/**
 * Slim oracle bulk, gzipped. ETag matches `oracleVersion` from the manifest
 * so an If-None-Match request short-circuits with 304. Returns 503 fast if
 * the bulk hasn't finished building yet — frontend retries with backoff.
 */
offlineRouter.get('/oracle-cards', bulkLimiter, (req: Request, res: Response) => {
  const status = getOracleBulkStatus();
  if (status.state !== 'ready' || !status.payload) {
    sendBuilding(res, status);
    return;
  }
  const bulk = status.payload;
  const etag = `"${bulk.version}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.set({
    ETag: etag,
    'Cache-Control': 'public, max-age=3600',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Encoding': 'gzip',
    'X-Offline-Version': bulk.version,
    'X-Offline-Card-Count': String(bulk.cardCount),
  });
  res.send(bulk.gzipped);
});

offlineRouter.get('/combos', bulkLimiter, async (req: Request, res: Response) => {
  try {
    const bulk = await getCombosBulk();
    // NDJSON when asked for — the client streams it row by row and never holds
    // the whole dataset in memory. Anything else (including cached app shells
    // from before this existed) gets the legacy JSON array. Distinct ETags and
    // `Vary: Accept` keep shared caches from handing one shape to the other.
    const ndjson = (req.headers.accept ?? '').includes('application/x-ndjson');
    const etag = ndjson ? `"${bulk.version}-ndjson"` : `"${bulk.version}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.set({
      ETag: etag,
      Vary: 'Accept',
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': ndjson
        ? 'application/x-ndjson; charset=utf-8'
        : 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'X-Offline-Version': bulk.version,
      'X-Offline-Combo-Count': String(bulk.comboCount),
    });
    res.send(ndjson ? bulk.gzippedNdjson : bulk.gzipped);
  } catch (err) {
    logger.error('[offline] combos failed:', err);
    res.status(503).json({ error: 'Offline combos bulk not yet available.' });
  }
});

/**
 * Combos-only version check, independent of oracle-bulk readiness. `/manifest`
 * 503s until the (unrelated) Scryfall oracle bulk finishes its 30-60s rebuild
 * after every deploy — but the combo dataset is Postgres-backed and ready the
 * whole time. `ensure-combos.ts` polls this instead so a cold combo cache
 * doesn't silently fall back to the capped server matcher during that window
 * (E212 — that fallback was measured showing 14% of a real collection's combos).
 */
offlineRouter.get('/combos-version', manifestLimiter, async (_req: Request, res: Response) => {
  try {
    const combos = await getCombosBulk();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ combosVersion: combos.version });
  } catch (err) {
    logger.error('[offline] combos-version failed:', err);
    res.status(503).json({ error: 'Offline combos bulk not yet available.' });
  }
});

/**
 * Admin-only manual refresh of the oracle bulk. The combos bulk follows the
 * existing nightly combo ingest, so no manual trigger is exposed here.
 */
offlineRouter.post(
  '/admin/refresh-oracle',
  requireAdmin,
  bulkLimiter,
  async (_req: Request, res: Response) => {
    try {
      const bulk = await refreshOracleBulk();
      res.json({
        version: bulk.version,
        cardCount: bulk.cardCount,
        gzippedBytes: bulk.gzippedBytes,
      });
    } catch (err) {
      logger.error('[offline] manual refresh failed:', err);
      res.status(502).json({ error: 'Refresh failed.' });
    }
  }
);
