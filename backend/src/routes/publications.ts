import { logger } from '../logger';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { extractListingFields } from '../publications/listing-fields';
import { generateDeckSlug } from '../publications/slug';
import { invalidateDeckPublicationCache, invalidatePublicUserCache } from '../publications/cache';
import { invalidateShareContext } from '../shares/context';

/**
 * Owner-facing publish/unpublish/status endpoints for `deck_publications` —
 * the dedicated publish-model table (not a 4th `shares.audience` value; see
 * PLAN.md §A1). Anonymous public reads live in the sibling `routes/public.ts`
 * (`/api/public/decks/:slug`, `/api/public/users/:username`); nothing here is
 * reachable by an anonymous viewer, and nothing links to any of it from the
 * app yet (W1).
 */
export const publicationsRouter: Router = Router();

// An occasional authed action, not a hot read path — mirrors usersRouter's
// searchLimiter. Shared across all three routes below.
const publishLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

const PUBLIC_ORIGIN = 'https://spellcontrol.com';
const MAX_SLUG_ATTEMPTS = 3;

interface PublicationRow {
  slug: string;
  published_at: string;
  updated_at: string;
  unpublished_at: string | null;
  view_count: number;
  copy_count: number;
}

interface PublicationResponse {
  slug: string;
  url: string;
  publishedAt: number;
  updatedAt: number;
  unpublishedAt: number | null;
  viewCount: number;
  copyCount: number;
}

function toPublication(row: PublicationRow): PublicationResponse {
  return {
    slug: row.slug,
    url: `${PUBLIC_ORIGIN}/d/${row.slug}`,
    publishedAt: Number(row.published_at),
    updatedAt: Number(row.updated_at),
    unpublishedAt: row.unpublished_at === null ? null : Number(row.unpublished_at),
    viewCount: row.view_count,
    copyCount: row.copy_count,
  };
}

/**
 * Postgres unique-violation (23505) specifically on the slug index — narrower
 * than a bare code check since the table also has a (user_id, deck_id)
 * primary key that could theoretically raise the same code; only a genuine
 * slug collision should trigger a regenerate-and-retry.
 */
function isSlugCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e?.constraint === 'deck_publications_slug_idx';
}

/**
 * Retire the lesser visibility rungs once a deck goes public. The client
 * ladder (private → link → friends → public) reads as mutually exclusive, so
 * it has to *be* exclusive: a 'link' or 'friends' share minted earlier would
 * otherwise stay live underneath the publication — an unlisted /s/:token the
 * owner believes they've replaced, still granting access and still listed in
 * Settings → Share links.
 *
 * Lives here, in the publish endpoint, rather than in the client that happened
 * to surface the bug. There are three publish call sites (the ShareDialog
 * ladder, the decks-index visibility action, the creation-time fieldset), and
 * enforcing this in only one of them is exactly how the invariant broke in the
 * first place — so it's enforced where they all converge. Anything that
 * publishes gets it, including whatever publishes next year.
 *
 * 'direct' (send-to-a-friend) shares are deliberately spared: they're
 * recipient-targeted, not a visibility level — the same carve-out
 * resolveDeckVisibility makes on the client.
 */
async function retireLesserRungs(
  userId: string,
  // Same `req.params.deckId` type every other query in this file binds — the
  // deck lookup above has already 404'd anything that isn't a plain id, so no
  // coercion is needed here to be correct.
  deckId: string | string[]
): Promise<void> {
  const result = await getPool().query<{ token: string }>(
    `UPDATE shares SET revoked_at = $3
       WHERE user_id = $1 AND kind = 'deck' AND resource_id = $2
         AND audience IN ('link', 'friends') AND revoked_at IS NULL
     RETURNING token`,
    [userId, deckId, Date.now()]
  );
  // Drop each cached context so the next public read sees the revocation
  // immediately rather than waiting out the TTL — mirrors sharesRouter's own
  // DELETE /:token handling.
  for (const row of result.rows) invalidateShareContext(row.token);
}

publicationsRouter.post(
  '/decks/:deckId',
  requireAuth,
  publishLimiter,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const deckId = req.params.deckId;
    const pool = getPool();

    const deckResult = await pool.query<{ data: unknown; rev: string }>(
      `SELECT data, rev FROM user_decks WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [userId, deckId]
    );
    if (deckResult.rows.length === 0) {
      return res.status(404).json({ error: 'Deck not found.' });
    }
    const { data, rev } = deckResult.rows[0];

    const fields = extractListingFields(data);
    if (!fields || !fields.name.trim()) {
      return res.status(400).json({ error: 'This deck needs a name before it can be published.' });
    }

    // Display name is a separate, fresh-from-the-DB check — never on the JWT
    // (see AuthedUser / users.displayName comments), since it can change
    // independently of the session.
    const userResult = await pool.query<{ display_name: string | null }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [userId]
    );
    const displayName = userResult.rows[0]?.display_name;
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({
        error: 'display_name_required',
        message: 'Set a display name before publishing.',
      });
    }

    const now = Date.now();
    const existing = await pool.query(
      `SELECT 1 FROM deck_publications WHERE user_id = $1 AND deck_id = $2`,
      [userId, deckId]
    );

    if (existing.rows.length > 0) {
      // Refresh listing fields + deck_rev/updated_at, and un-hide if the
      // publication was previously unpublished. Deliberately does NOT touch
      // slug/published_at/view_count/copy_count — this is where the
      // frozen-forever slug and preserved counters pay off, for both "refresh
      // a still-live publish" and "republish after unpublish".
      const updated = await pool.query<PublicationRow>(
        `UPDATE deck_publications
            SET deck_name = $3, format = $4, commander_name = $5,
                commander_image_normal = $6, og_art_crop = $7, color_identity = $8::jsonb,
                bracket = $9, card_count = $10, deck_rev = $11, updated_at = $12,
                unpublished_at = NULL
          WHERE user_id = $1 AND deck_id = $2
          RETURNING slug, published_at, updated_at, unpublished_at, view_count, copy_count`,
        [
          userId,
          deckId,
          fields.name,
          fields.format,
          fields.commanderName,
          fields.commanderImageNormal,
          fields.ogArtCrop,
          JSON.stringify(fields.colorIdentity),
          fields.bracket,
          fields.cardCount,
          Number(rev),
          now,
        ]
      );
      await retireLesserRungs(userId, deckId);
      return res.status(200).json({ publication: toPublication(updated.rows[0]) });
    }

    // Brand-new publication: mint a slug and insert. A unique-violation on
    // the slug index is astronomically unlikely at 32 bits of entropy but
    // real, so regenerate and retry a bounded number of times rather than
    // trusting a single roll.
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = generateDeckSlug(fields.name);
      try {
        const inserted = await pool.query<PublicationRow>(
          `INSERT INTO deck_publications
             (user_id, deck_id, slug, deck_name, format, commander_name, commander_image_normal,
              og_art_crop, color_identity, bracket, card_count, deck_rev, published_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $13)
           RETURNING slug, published_at, updated_at, unpublished_at, view_count, copy_count`,
          [
            userId,
            deckId,
            slug,
            fields.name,
            fields.format,
            fields.commanderName,
            fields.commanderImageNormal,
            fields.ogArtCrop,
            JSON.stringify(fields.colorIdentity),
            fields.bracket,
            fields.cardCount,
            Number(rev),
            now,
          ]
        );
        await retireLesserRungs(userId, deckId);
        return res.status(201).json({ publication: toPublication(inserted.rows[0]) });
      } catch (err) {
        if (!isSlugCollision(err)) throw err;
        logger.warn(`[publications] slug collision on attempt ${attempt + 1}, regenerating`, err);
      }
    }
    logger.error('[publications] exhausted slug retry attempts', { userId, deckId });
    return res.status(500).json({ error: 'Could not allocate a unique deck slug.' });
  }
);

/**
 * Unpublish. 0 rows (never published, or already unpublished) -> 404, safe to
 * retry — mirrors sharesRouter.delete('/:token')'s exact pattern. On success,
 * purges both public-read caches (publications/cache.ts) — mirrors
 * invalidateShareContext's exact treatment of revoke — so the just-
 * unpublished deck disappears from its own page and the owner's profile grid
 * immediately rather than after up to 60s.
 */
publicationsRouter.delete(
  '/decks/:deckId',
  requireAuth,
  publishLimiter,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const deckId = req.params.deckId;
    const result = await getPool().query<{ slug: string }>(
      `UPDATE deck_publications SET unpublished_at = $3
         WHERE user_id = $1 AND deck_id = $2 AND unpublished_at IS NULL
       RETURNING slug`,
      [userId, deckId, Date.now()]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'This deck is not published.' });
    }
    invalidateDeckPublicationCache(result.rows[0].slug);
    invalidatePublicUserCache(req.user!.username);
    res.status(204).end();
  }
);

/**
 * Publish status for the caller's own deck. Always 200 — `publication: null`
 * is a normal "not published yet" state. Already scoped to the caller's own
 * userId, so a foreign deckId just yields the same null response.
 */
publicationsRouter.get(
  '/decks/:deckId',
  requireAuth,
  publishLimiter,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const deckId = req.params.deckId;
    const result = await getPool().query<PublicationRow>(
      `SELECT slug, published_at, updated_at, unpublished_at, view_count, copy_count
         FROM deck_publications WHERE user_id = $1 AND deck_id = $2`,
      [userId, deckId]
    );
    if (result.rows.length === 0) {
      return res.json({ publication: null });
    }
    res.json({ publication: toPublication(result.rows[0]) });
  }
);

/**
 * All of the caller's own publications — live AND unpublished — so a caller
 * (the deck-editor visibility chip, the decks-index "Public" badge) can tell
 * "was public, now isn't" apart from "never published" without a per-deck
 * round-trip. Scoped to the caller's own userId only; another user's rows
 * never appear here (mirrors the single-deck GET above).
 */
publicationsRouter.get(
  '/decks',
  requireAuth,
  publishLimiter,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await getPool().query<{
      deck_id: string;
      slug: string;
      unpublished_at: string | null;
      view_count: number;
      copy_count: number;
    }>(
      `SELECT deck_id, slug, unpublished_at, view_count, copy_count
         FROM deck_publications WHERE user_id = $1`,
      [userId]
    );
    res.json({
      publications: result.rows.map((row) => ({
        deckId: row.deck_id,
        slug: row.slug,
        unpublishedAt: row.unpublished_at === null ? null : Number(row.unpublished_at),
        viewCount: row.view_count,
        copyCount: row.copy_count,
      })),
    });
  }
);
