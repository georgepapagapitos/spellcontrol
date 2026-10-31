import { Router, type Request, type Response } from 'express';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import { testAwareLimiter } from '../route-utils';
import { parseTopListQuery } from '../edhrec/top-lists';
import { EdhrecUnavailableError, getTopList } from '../edhrec/top-store';
import { parseEdhrecPagePath } from '../edhrec/page-paths';
import { PageUnavailableError, getPage, gunzipPage } from '../edhrec/page-store';

/**
 * EDHREC's top lists, served from our own stored copy (edhrec/top-store.ts)
 * so browse pages never call EDHREC from the browser and an EDHREC outage
 * shows the last good list instead of an error. Public and anonymous: the
 * lists are the same for everyone.
 *
 *   GET /api/edhrec/top?kind=commanders|cards|salt[&period][&colors][&type]
 *   GET /api/edhrec/page/<EDHREC path>   e.g. /page/pages/commanders/atraxa-praetors-voice.json
 *
 * The second serves the page JSON the deck builder reads, byte-identical to
 * json.edhrec.com's, from our own copy (edhrec/page-store.ts).
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

// Generation reads a few dozen pages and the browser client spaces them
// 100ms apart, so this is generous for one user and still a ceiling on abuse.
const pageLimiter = testAwareLimiter({ windowMs: 60_000, max: 600 });

const PAGE_FRESH_CACHE = 'public, max-age=3600';
const PAGE_STALE_CACHE = 'public, max-age=300';

/** Marks a response as ours (not a Fly proxy error) for the browser client,
 *  which falls back to EDHREC directly only when this header is absent on a
 *  502/504 or the request fails outright. */
const CACHE_HEADER = 'X-Edhrec-Cache';

edhrecRouter.get('/page/*path', pageLimiter, async (req: Request, res: Response) => {
  const ref = parseEdhrecPagePath(req.path.slice('/page'.length));
  if (!ref) {
    res.status(400).json({ error: 'Not an EDHREC page we serve.' });
    return;
  }
  try {
    const page = await getPage(ref, Date.now(), req.ip ?? 'unknown');
    if (page.kind === 'absent') {
      // EDHREC has no such page. Same status it gave, so the client's
      // 403/404 handling (no combos, no color page) reads it as before.
      res.set(CACHE_HEADER, 'absent');
      res.set('Cache-Control', PAGE_STALE_CACHE);
      res.status(page.status).type('text/plain').send('No such page.');
      return;
    }
    res.set(CACHE_HEADER, page.state);
    res.set('X-Edhrec-Fetched-At', String(page.fetchedAt));
    res.set(
      'Cache-Control',
      page.state === 'hit' || page.state === 'miss' ? PAGE_FRESH_CACHE : PAGE_STALE_CACHE
    );
    res.set('Vary', 'Accept-Encoding');
    res.type('application/json');
    if (req.acceptsEncodings('gzip') === 'gzip') {
      res.set('Content-Encoding', 'gzip');
      res.send(page.gz);
    } else {
      res.send(gunzipPage(page.gz));
    }
  } catch (err) {
    if (err instanceof PageUnavailableError) {
      // 503 so edhrec/client.ts retries with its backoff, as it does for EDHREC itself.
      res.set(CACHE_HEADER, 'unavailable');
      res.set('Retry-After', '5');
      res.status(503).json({ error: "Couldn't reach EDHREC." });
      return;
    }
    logger.error('[edhrec] page failed:', err);
    res.status(500).json({ error: "Couldn't load that page." });
  }
});
