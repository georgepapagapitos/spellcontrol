import { getPool } from '../db';
import { logger } from '../logger';
import type { ListingFields } from './listing-fields';
import { generateDeckSlug } from './slug';

const MAX_SLUG_ATTEMPTS = 3;

export interface PublicationRow {
  slug: string;
  published_at: string;
  updated_at: string;
  unpublished_at: string | null;
  view_count: number;
  copy_count: number;
}

/**
 * Insert a deck's first `deck_publications` row, minting its frozen slug.
 *
 * Two writers can race to create the row for the same deck: the publish
 * route, and the sync hook publishing a new deck by default. So the insert is
 * `ON CONFLICT (user_id, deck_id) DO NOTHING`, and a `null` return means
 * another writer got there first. The caller decides what that means
 * (the publish route updates the existing row; the hook does nothing).
 *
 * `unpublished` inserts a row that is already private. The sync hook records
 * a deck created as private this way, so it never re-considers the deck.
 * A slug collision (32 bits of entropy, rare but real) regenerates, a bounded
 * number of times. Throws when every attempt collides.
 */
export async function insertPublication(
  userId: string,
  deckId: string,
  fields: ListingFields,
  rev: number,
  now: number,
  { unpublished = false }: { unpublished?: boolean } = {}
): Promise<PublicationRow | null> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = generateDeckSlug(fields.name);
    try {
      const inserted = await getPool().query<PublicationRow>(
        `INSERT INTO deck_publications
           (user_id, deck_id, slug, deck_name, format, commander_name, commander_image_normal,
            og_art_crop, color_identity, bracket, estimated_bracket, card_count, deck_rev,
            published_at, updated_at, unpublished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $14, $15)
         ON CONFLICT (user_id, deck_id) DO NOTHING
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
          fields.estimatedBracket,
          fields.cardCount,
          rev,
          now,
          unpublished ? now : null,
        ]
      );
      return inserted.rows[0] ?? null;
    } catch (err) {
      if (!isSlugCollision(err)) throw err;
      logger.warn(`[publications] slug collision on attempt ${attempt + 1}, regenerating`, err);
    }
  }
  logger.error('[publications] exhausted slug retry attempts', { userId, deckId });
  throw new Error('Could not allocate a unique deck slug.');
}

/**
 * Postgres unique-violation (23505) specifically on the slug index. The
 * (user_id, deck_id) key is absorbed by ON CONFLICT above, so only a genuine
 * slug collision reaches here, but the constraint check keeps it exact.
 */
function isSlugCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e?.constraint === 'deck_publications_slug_idx';
}
