import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { extractListingFields } from '../publications/listing-fields';
import { insertPublication, type PublicationRow } from '../publications/insert';
import { invalidateDeckPublicationCache } from '../publications/cache';
import { invalidatePublicUserCacheById } from '../publications/purge';
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

    // Moderation, fresh from the DB. A publish can't undo a takedown: not a
    // hidden account's, and not a deck a moderator took down. That matters
    // more now that decks publish by default and going public is one tap.
    const userResult = await pool.query<{ profile_hidden_at: string | null }>(
      `SELECT profile_hidden_at FROM users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows[0]?.profile_hidden_at != null) {
      return res.status(403).json({
        error: "A moderator hid this account, so its decks can't be made public.",
      });
    }
    const existing = await pool.query<{ moderated_at: string | null }>(
      `SELECT moderated_at FROM deck_publications WHERE user_id = $1 AND deck_id = $2`,
      [userId, deckId]
    );
    if (existing.rows[0]?.moderated_at != null) {
      return res.status(403).json({
        error: "A moderator took this deck down, so it can't be made public again.",
      });
    }

    const now = Date.now();
    if (existing.rows.length === 0) {
      // Brand-new publication. `null` means the sync hook's default publish
      // won the race to create the row; fall through and update it instead.
      let inserted;
      try {
        inserted = await insertPublication(userId, String(deckId), fields, Number(rev), now);
      } catch {
        return res.status(500).json({ error: 'Could not allocate a unique deck slug.' });
      }
      if (inserted) {
        await retireLesserRungs(userId, deckId);
        await invalidatePublicUserCacheById(userId);
        return res.status(201).json({ publication: toPublication(inserted) });
      }
    }

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
    invalidateDeckPublicationCache(updated.rows[0].slug);
    await invalidatePublicUserCacheById(userId);
    return res.status(200).json({ publication: toPublication(updated.rows[0]) });
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
    await invalidatePublicUserCacheById(req.user!.id);
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
