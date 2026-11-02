import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import {
  SpellbookUnavailableError,
  getSpellbookBracket,
  parseDeckList,
} from '../spellbook/bracket';
import { logger } from '../logger';

/**
 * Commander Spellbook's bracket verdict for a decklist (E1101), through our
 * cache. Public and anonymous: the answer depends only on the list.
 *
 *   POST /api/spellbook/bracket  { commanders?: string[], cards: [{ name, quantity }] }
 *   200 { tag, cached }          Spellbook's own tag (E C O P S R B), not mapped to B1-B5
 *   503 { error }  + Retry-After  no verdict to give right now
 */
export const spellbookRouter: Router = Router();

const limiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

spellbookRouter.post('/bracket', limiter, async (req: Request, res: Response) => {
  const list = parseDeckList(req.body);
  if (typeof list === 'string') {
    res.status(400).json({ error: list });
    return;
  }
  try {
    const { bracket, cached } = await getSpellbookBracket(list);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ tag: bracket.tag, cached });
  } catch (err) {
    if (err instanceof SpellbookUnavailableError) {
      res.set('Retry-After', String(err.retryAfterSeconds));
      res.status(503).json({ error: "Couldn't reach Commander Spellbook." });
      return;
    }
    logger.error('[spellbook] bracket failed:', err);
    res.status(500).json({ error: "Couldn't load that opinion." });
  }
});
