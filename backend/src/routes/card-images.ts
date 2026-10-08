import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { buildImageVersions, getScryfallCache } from '../scryfall-cache';

/**
 * `POST /api/cards/image-versions`: current image stamps for a batch of
 * printings (`{ scryfallIds }` → `{ imageVersions }`, see `imageVersionOf`).
 *
 * A deck stores a frozen copy of each card, image URL included, so a card added
 * before Scryfall replaced its preview photo keeps the photo. The client asks
 * this for its deck cards and moves their URLs onto the new stamp
 * (`frontend/src/lib/cards/card-image-versions.ts`). The collection gets the
 * same map from `/api/refresh-prices`. Cache only, stale rows included: a
 * missing or old stamp just leaves the stored URL as it is, so this never calls
 * Scryfall.
 */
export const cardImagesRouter: Router = Router();

const MAX_IDS = 1000;
const limiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

cardImagesRouter.post('/image-versions', limiter, (req: Request, res: Response) => {
  const raw = (req.body as { scryfallIds?: unknown } | undefined)?.scryfallIds;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: 'Body must be { scryfallIds: string[] }.' });
  }
  const ids = Array.from(
    new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))
  ).slice(0, MAX_IDS);
  const cards = getScryfallCache().getMany(ids, true);
  res.json({ imageVersions: buildImageVersions([...cards.values()]) });
});
