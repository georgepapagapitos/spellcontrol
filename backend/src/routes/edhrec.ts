import { Router, type Request, type Response } from 'express';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import { testAwareLimiter } from '../route-utils';
import { parseTopListQuery } from '../edhrec/top-lists';
import { EdhrecUnavailableError, getTopList } from '../edhrec/top-store';

/**
 * EDHREC's top lists, served from our own stored copy (edhrec/top-store.ts)
 * so browse pages never call EDHREC from the browser and an EDHREC outage
 * shows the last good list instead of an error. Public and anonymous: the
 * lists are the same for everyone.
 *
 *   GET /api/edhrec/top?kind=commanders|cards|salt[&period][&colors][&type]
 */
export const edhrecRouter: Router = Router();

const edhrecLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

const FRESH_CACHE = 'public, max-age=3600';
// A stale copy is being refreshed in the background; let browsers pick up
// the new one sooner.
const STALE_CACHE = 'public, max-age=300';

edhrecRouter.get('/top', edhrecLimiter, async (req: Request, res: Response) => {
  const parsed = parseTopListQuery(req.query);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { key } = parsed;
  try {
    const list = await getTopList(key);
    res.set('Cache-Control', list.stale ? STALE_CACHE : FRESH_CACHE);
    res.json({
      kind: key.kind,
      period: key.period,
      colors: key.colors,
      type: key.type,
      entries: list.entries,
      fetchedAt: list.fetchedAt,
      stale: list.stale,
      sourceUrl: list.sourceUrl,
    });
  } catch (err) {
    if (err instanceof EdhrecUnavailableError) {
      logger.warn(`[edhrec] no stored copy and the fetch failed: ${errorMessage(err)}`);
      res.status(502).json({ error: "Couldn't reach EDHREC." });
      return;
    }
    logger.error('[edhrec] top list failed:', err);
    res.status(500).json({ error: "Couldn't load that list." });
  }
});
