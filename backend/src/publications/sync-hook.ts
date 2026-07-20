import { getPool } from '../db';
import { logger } from '../logger';
import { extractListingFields } from './listing-fields';
import { invalidateDeckPublicationCache, invalidatePublicUserCache } from './cache';
import type { AppliedRow } from '../routes/sync';

/**
 * Fire-and-forget consistency hook called after a `/api/sync` push commits
 * (see routes/sync.ts, which never awaits this). Keeps the denormalized
 * `deck_publications` listing columns fresh for an already-published deck
 * that was upserted, and fully removes (+ cache-invalidates) the publication
 * for one that was tombstoned. A deck that was never published is untouched
 * either way — publish stays explicit-only.
 *
 * Uses a fresh `getPool().query()`, never the sync route's transaction
 * `client` — by the point this runs, that transaction has already committed
 * and its connection been released back to the pool, so reusing it would
 * race the next request that checks it out.
 *
 * Every row is independently try/caught: one bad row is logged and skipped,
 * never taking down the rest of the batch's refresh.
 */
export async function refreshDeckPublications(
  userId: string,
  applied: AppliedRow[]
): Promise<void> {
  const pool = getPool();

  for (const row of applied) {
    if (row.kind !== 'deck') continue;
    try {
      if (row.deletedAt !== null) {
        // A deleted deck can never come back published under the same rev —
        // full deletion (not soft-unpublish) is correct.
        const deleted = await pool.query<{ slug: string }>(
          `DELETE FROM deck_publications WHERE user_id = $1 AND deck_id = $2 RETURNING slug`,
          [userId, row.id]
        );
        const slug = deleted.rows[0]?.slug;
        if (slug) {
          const user = await pool.query<{ username: string }>(
            `SELECT username FROM users WHERE id = $1`,
            [userId]
          );
          const username = user.rows[0]?.username;
          invalidateDeckPublicationCache(slug);
          if (username) invalidatePublicUserCache(username);
        }
        continue;
      }

      const deck = await pool.query<{ data: unknown }>(
        `SELECT data FROM user_decks WHERE user_id = $1 AND id = $2`,
        [userId, row.id]
      );
      const fields = extractListingFields(deck.rows[0]?.data);
      if (!fields) continue; // malformed, or nothing found — no-op

      // `deck_rev < $11` makes a redelivered/retried push with the same or
      // older rev a correct no-op, and this naturally no-ops (0 rows) for any
      // never-published deck — editing an unpublished deck never auto-publishes it.
      await pool.query(
        `UPDATE deck_publications
            SET deck_name = $3, format = $4, commander_name = $5,
                commander_image_normal = $6, og_art_crop = $7, color_identity = $8::jsonb,
                bracket = $9, card_count = $10, deck_rev = $11, updated_at = $12
          WHERE user_id = $1 AND deck_id = $2 AND deck_rev < $11`,
        [
          userId,
          row.id,
          fields.name,
          fields.format,
          fields.commanderName,
          fields.commanderImageNormal,
          fields.ogArtCrop,
          JSON.stringify(fields.colorIdentity),
          fields.bracket,
          fields.cardCount,
          row.rev,
          Date.now(),
        ]
      );
    } catch (err) {
      logger.warn(`[publications] sync-hook refresh failed user=${userId} deck=${row.id}`, err);
    }
  }
}
