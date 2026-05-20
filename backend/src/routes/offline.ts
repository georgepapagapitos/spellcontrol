import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getOracleBulk, refreshOracleBulk } from '../offline/bulk-cache';
import { getCombosBulk } from '../offline/combos-export';
import type { OfflineManifest } from '../offline/types';

export const offlineRouter: Router = Router();

// Bulk downloads are large (multi-megabyte) but called rarely — once per
// user per week typically. Keep a generous limiter to allow re-downloads
// after a clear-and-retry without rate-limiting normal users.
const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;
const bulkLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, max: 10 });

/**
 * Manifest: tells the client which version of the oracle/combos bulks are
 * available so it can decide whether to re-download. Cheap and frequent.
 */
offlineRouter.get('/manifest', async (_req: Request, res: Response) => {
  try {
    const [oracle, combos] = await Promise.all([getOracleBulk(), getCombosBulk()]);
    const manifest: OfflineManifest = {
      oracleVersion: oracle.version,
      oracleCardCount: oracle.cardCount,
      oracleByteSize: oracle.gzippedBytes,
      oracleUpdatedAt: oracle.updatedAt,
      combosVersion: combos.version,
      combosCount: combos.comboCount,
      combosByteSize: combos.gzippedBytes,
      combosUpdatedAt: combos.updatedAt,
    };
    res.set('Cache-Control', 'public, max-age=300');
    res.json(manifest);
  } catch (err) {
    console.error('[offline] manifest failed:', err);
    res.status(503).json({ error: 'Offline data not yet available. Try again shortly.' });
  }
});

/**
 * Slim oracle bulk, gzipped. ETag matches `oracleVersion` from the manifest
 * so an If-None-Match request short-circuits with 304.
 */
offlineRouter.get('/oracle-cards', bulkLimiter, async (req: Request, res: Response) => {
  try {
    const bulk = await getOracleBulk();
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
  } catch (err) {
    console.error('[offline] oracle-cards failed:', err);
    res.status(503).json({ error: 'Offline oracle bulk not yet available.' });
  }
});

offlineRouter.get('/combos', bulkLimiter, async (req: Request, res: Response) => {
  try {
    const bulk = await getCombosBulk();
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
      'X-Offline-Combo-Count': String(bulk.comboCount),
    });
    res.send(bulk.gzipped);
  } catch (err) {
    console.error('[offline] combos failed:', err);
    res.status(503).json({ error: 'Offline combos bulk not yet available.' });
  }
});

/**
 * Admin-only manual refresh of the oracle bulk. The combos bulk follows the
 * existing nightly combo ingest, so no manual trigger is exposed here.
 */
offlineRouter.post('/admin/refresh-oracle', async (_req: Request, res: Response) => {
  try {
    const bulk = await refreshOracleBulk();
    res.json({
      version: bulk.version,
      cardCount: bulk.cardCount,
      gzippedBytes: bulk.gzippedBytes,
    });
  } catch (err) {
    console.error('[offline] manual refresh failed:', err);
    res.status(502).json({ error: 'Refresh failed.' });
  }
});
