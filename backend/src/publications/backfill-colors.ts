import type { Pool } from 'pg';
import { logger } from '../logger';
import { extractListingFields } from './listing-fields';

const MIGRATION = 'publication_card_colors_v1';

/**
 * One-shot: recompute `color_identity` for every publication stored as `[]`.
 *
 * `extractListingFields` used to read a deck's colors off its commander only,
 * so every published Pauper / Modern / Standard deck was written as colorless.
 * It now falls back to the deck's cards, but the sync hook only rewrites a
 * publication when its deck is next edited, so without this pass an existing
 * deck would stay gray on Discover and /u/:username until its owner touched it.
 *
 * Only `color_identity` is written: `deck_rev` and `updated_at` stay put, so a
 * later sync still refreshes the row and "Recently updated" doesn't reshuffle.
 * A deck that really is colorless recomputes to `[]` and is left alone.
 * Idempotent, and gated by `app_migrations` so a boot doesn't rescan every
 * time. A failure logs and leaves the marker unset, so the next boot retries.
 */
export async function backfillPublicationColors(pool: Pool): Promise<number> {
  const done = await pool.query(`SELECT 1 FROM app_migrations WHERE name = $1`, [MIGRATION]);
  if ((done.rowCount ?? 0) > 0) return 0;
  try {
    const rows = await pool.query<{ user_id: string; deck_id: string; data: unknown }>(
      `SELECT dp.user_id, dp.deck_id, ud.data
         FROM deck_publications dp
         JOIN user_decks ud ON ud.user_id = dp.user_id AND ud.id = dp.deck_id
        WHERE dp.color_identity = '[]'::jsonb AND ud.deleted_at IS NULL`
    );
    let n = 0;
    for (const row of rows.rows) {
      const colors = extractListingFields(row.data)?.colorIdentity ?? [];
      if (colors.length === 0) continue;
      await pool.query(
        `UPDATE deck_publications SET color_identity = $3::jsonb
          WHERE user_id = $1 AND deck_id = $2`,
        [row.user_id, row.deck_id, JSON.stringify(colors)]
      );
      n++;
    }
    await pool.query(
      `INSERT INTO app_migrations (name, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [MIGRATION, Date.now()]
    );
    logger.info(`[publications] backfilled colors on ${n} publication(s)`);
    return n;
  } catch (err) {
    logger.error('[publications] color backfill failed; will retry next boot', err);
    return 0;
  }
}
