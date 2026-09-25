import { getPool } from '../db';
import { logger } from '../logger';
import { extractListingFields, type ListingFields } from './listing-fields';
import { invalidateDeckPublicationCache, invalidatePublicUserCache } from './cache';
import { insertPublication } from './insert';
import { invalidatePublicUserCacheById } from './purge';
import type { AppliedRow } from '../routes/sync';

/**
 * Fire-and-forget consistency hook called after a `/api/sync` push commits
 * (see routes/sync.ts, which never awaits this). Keeps the denormalized
 * `deck_publications` listing columns fresh for an already-published deck
 * that was upserted, and fully removes (+ cache-invalidates) the publication
 * for one that was tombstoned.
 *
 * It is also where a NEW deck becomes public by default. A deck created by a
 * current signed-in client carries `initialVisibility` ('public' or
 * 'private'), and the first time the server sees that deck with no
 * publication row, this records the choice: a live row, or an already
 * unpublished one. After that a row always exists, so the field is never
 * read again. That's what keeps it safe on a last-write-wins row: a stale
 * device re-sending the deck can't re-publish something its owner has since
 * made private. Decks from before this shipped carry no intent and stay
 * exactly as they were.
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
      // deck with no publication row.
      const refreshed = await pool.query(
        `UPDATE deck_publications
            SET deck_name = $3, format = $4, commander_name = $5,
                commander_image_normal = $6, og_art_crop = $7, color_identity = $8::jsonb,
                bracket = $9, estimated_bracket = $10, card_count = $11, deck_rev = $12,
                updated_at = $13
          WHERE user_id = $1 AND deck_id = $2 AND deck_rev < $12`,
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
          fields.estimatedBracket,
          fields.cardCount,
          row.rev,
          Date.now(),
        ]
      );
      if (refreshed.rowCount === 0)
        await publishByDefault(userId, row.id, row.rev, deck.rows[0]?.data, fields);
    } catch (err) {
      logger.warn(`[publications] sync-hook refresh failed user=${userId} deck=${row.id}`, err);
    }
  }
}

/**
 * First sight of a deck with a creation intent: record it. A no-op when the
 * deck carries no intent (created before public-by-default, or by a guest),
 * when a row already exists (the ON CONFLICT in insertPublication), and for a
 * public deck on an account a moderator hid.
 */
async function publishByDefault(
  userId: string,
  deckId: string,
  rev: number,
  data: unknown,
  fields: ListingFields
): Promise<void> {
  const intent = (data as { initialVisibility?: unknown } | null)?.initialVisibility;
  if (intent !== 'public' && intent !== 'private') return;

  const pool = getPool();
  const exists = await pool.query(
    `SELECT 1 FROM deck_publications WHERE user_id = $1 AND deck_id = $2`,
    [userId, deckId]
  );
  if (exists.rows.length > 0) return;
  if (intent === 'public') {
    const user = await pool.query<{ profile_hidden_at: string | null }>(
      `SELECT profile_hidden_at FROM users WHERE id = $1`,
      [userId]
    );
    if (user.rows[0]?.profile_hidden_at != null) return;
  }

  const inserted = await insertPublication(userId, deckId, fields, rev, Date.now(), {
    unpublished: intent === 'private',
  });
  if (inserted && intent === 'public') await invalidatePublicUserCacheById(userId);
}
