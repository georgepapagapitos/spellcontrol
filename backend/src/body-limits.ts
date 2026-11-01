import express, { type Express } from 'express';

/**
 * JSON body limits. The parser runs before auth and the per-route limiters, so
 * whatever the global limit is, any anonymous caller can make the server buffer
 * and parse that much. Only /api/sync legitimately posts a collection-sized
 * body; everything else (import chunks, deck text, shares, games, id lists) is
 * far under the default.
 */
export const DEFAULT_JSON_LIMIT = '1mb';

// Kept ABOVE the sync snapshot cap (MAX_SNAPSHOT_BYTES, 64MB) so an oversize
// collection is rejected by the sync route with a friendly, actionable message
// rather than a raw body-parser 413.
export const SYNC_JSON_LIMIT = '72mb';

/**
 * Mount the sync-sized parser on /api/sync first. Once it sets req.body,
 * Express's json parser skips the second one, so the small global parser only
 * ever applies to every other route.
 */
export function mountBodyParsers(app: Express): void {
  app.use('/api/sync', express.json({ limit: SYNC_JSON_LIMIT }));
  app.use(express.json({ limit: DEFAULT_JSON_LIMIT }));
}
