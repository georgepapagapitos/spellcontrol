import { getPool } from '../db';

/**
 * The house account: the one account the app itself publishes as. It holds
 * every Commander precon (see ./seed.ts) and nothing else.
 *
 * It is a real `users` row so its decks go through the same publication,
 * page, like and copy paths as anyone's. What makes it different is
 * `is_official`: its decks stay out of every surface that counts people
 * (trending, commander stats, the community grid, user search, friend
 * requests). Seeded content must never pass for community activity.
 *
 * Nobody can sign in as it: no password hash, no email, no linked identity.
 * `spellcontrol` is in RESERVED_IDENTIFIERS, so no one can register the
 * handle either. Its collection is private because it has none.
 */
export const OFFICIAL_USER_ID = 'official-spellcontrol';
export const OFFICIAL_USERNAME = 'spellcontrol';
const OFFICIAL_DISPLAY_NAME = 'SpellControl';
const OFFICIAL_BIO =
  'Every Commander precon Wizards has printed, kept current as new ones release.';

/**
 * Creates the house account if it isn't there yet, and re-asserts the flag if
 * it is. Idempotent, so the seed job calls it on every run. Throws when some
 * other account already holds the username (only possible for an account
 * registered before the handle was reserved); the seed job logs and stops
 * rather than publishing under someone else's name.
 */
export async function ensureOfficialAccount(now = Date.now()): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO users (id, username, display_name, bio, is_official, collection_visibility, created_at)
     VALUES ($1, $2, $3, $4, true, 'private', $5)
     ON CONFLICT (id) DO UPDATE SET is_official = true
     RETURNING id`,
    [OFFICIAL_USER_ID, OFFICIAL_USERNAME, OFFICIAL_DISPLAY_NAME, OFFICIAL_BIO, now]
  );
  return rows[0].id;
}
