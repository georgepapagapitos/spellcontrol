import { Router, type Request, type Response } from 'express';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import { testAwareLimiter } from '../route-utils';
import { getScryfallCache } from '../scryfall-cache';
import {
  MPC_MAX_SLOTS,
  MpcUnavailableError,
  buildOrderXml,
  parseMpcList,
  planOrder,
  queriesFor,
  searchImages,
} from '../mpc/order';

/**
 * POST /api/mpc/order  { list: "1x Sol Ring\n…" }
 *   → { xml, slots, missing: string[] }
 *
 * Turns the deck export's MPC list into an MPC Autofill order file, top-ranked
 * image per card (mpc/order.ts). Public: the shared deck view exports too.
 * Each call costs MPC Autofill a few searches, hence the tight limiter.
 */
export const mpcRouter: Router = Router();

const MAX_LIST_CHARS = 60_000;

mpcRouter.post(
  '/order',
  testAwareLimiter({ windowMs: 60_000, max: 6 }),
  async (req: Request, res: Response) => {
    const list = (req.body as { list?: unknown } | undefined)?.list;
    if (typeof list !== 'string' || list.length > MAX_LIST_CHARS) {
      res.status(400).json({ error: 'Body must be { list: string }.' });
      return;
    }
    const entries = parseMpcList(list);
    const slots = entries.reduce((n, e) => n + e.qty, 0);
    if (slots === 0) {
      res.status(400).json({ error: 'That list has no cards.' });
      return;
    }
    if (slots > MPC_MAX_SLOTS) {
      res.status(400).json({
        error: `An MPC order holds up to ${MPC_MAX_SLOTS} cards. This list has ${slots}.`,
      });
      return;
    }
    const planned = planOrder(entries, (names) => getScryfallCache().lookupCards(names, []).byName);
    try {
      const { hits, images, cardback } = await searchImages(planned.flatMap(queriesFor));
      res.json(buildOrderXml(planned, images, hits, cardback));
    } catch (err) {
      if (err instanceof MpcUnavailableError) {
        logger.warn(`[mpc] ${errorMessage(err)}`);
        res.status(502).json({ error: "Couldn't reach MPC Autofill. Try again in a minute." });
        return;
      }
      logger.error('[mpc] order failed:', err);
      res.status(500).json({ error: "Couldn't build the order file." });
    }
  }
);
