import { Router, type Request, type Response } from 'express';
import { optionalAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { loadBrewerCards } from '../brewers/cards';
import { loadBrewerRails } from '../brewers/rails';

/**
 * The Brewers directory behind Discover's Brewers tab (T175), mounted at
 * `/api/public/brewers`. A brewer is an account with at least one live
 * published deck that a moderator has not hidden. Anonymous reads;
 * `optionalAuth` only so the rails can leave the viewer out and add the
 * shared-commander rail.
 */
export const brewersRouter: Router = Router();

const brewersReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

const MIN_QUERY = 2;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

/** Escape LIKE wildcards so a typed `%` or `_` matches itself. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The tab's landing content: newest, most liked, most followed, shared commanders, spotlight. */
brewersRouter.get(
  '/rails',
  brewersReadLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    res.json(await loadBrewerRails(req.user?.id ?? null));
  }
);

/**
 * Search by username or display name, case-insensitive substring, two
 * characters minimum (shorter answers an empty list, not an error, so a
 * search box can call it on every keystroke). Prefix matches first, the house
 * account last.
 */
brewersRouter.get('/', brewersReadLimiter, async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < MIN_QUERY) return res.json({ brewers: [] });
  const asked = Number(req.query.limit);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;

  const escaped = likeEscape(q.toLowerCase());
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT u.id
       FROM users u
      WHERE u.profile_hidden_at IS NULL
        AND EXISTS (SELECT 1 FROM deck_publications dp
                     WHERE dp.user_id = u.id AND dp.unpublished_at IS NULL)
        AND (lower(u.username) LIKE $1 ESCAPE '\\' OR lower(u.display_name) LIKE $1 ESCAPE '\\')
      ORDER BY u.is_official ASC,
               (lower(u.username) LIKE $2 ESCAPE '\\' OR lower(u.display_name) LIKE $2 ESCAPE '\\') DESC NULLS LAST,
               u.username
      LIMIT $3`,
    [`%${escaped}%`, `${escaped}%`, limit]
  );
  res.json({ brewers: await loadBrewerCards(rows.map((r) => r.id)) });
});
