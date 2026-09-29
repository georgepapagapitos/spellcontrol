import { getPool } from '../db';
import { brewerRailsCache } from '../publications/cache';
import { loadBrewerCardMap, loadBrewerCards, type BrewerCard } from './cards';

/** Cards per rail. */
export const RAIL_MAX = 8;
/** A rail ranks people, so a brewer needs this many distinct people behind
 *  them to count (honest popularity: never clicks, never one fan). */
export const PEOPLE_FLOOR = 3;

export interface BrewerRails {
  newest: BrewerCard[];
  mostLiked: BrewerCard[];
  mostFollowed: BrewerCard[];
  /** Signed in only; [] otherwise. */
  sharedCommanders: BrewerCard[];
  spotlight: BrewerCard | null;
}

/** The viewer-agnostic part, cached 60 s. One extra card per rail is kept so
 *  dropping the viewer still leaves a full rail. */
export type BaseRails = Pick<BrewerRails, 'newest' | 'mostLiked' | 'mostFollowed' | 'spotlight'>;

/** A brewer: not hidden by a moderator, with at least one live published deck. */
const BREWER = `u.profile_hidden_at IS NULL AND EXISTS (
    SELECT 1 FROM deck_publications dp WHERE dp.user_id = u.id AND dp.unpublished_at IS NULL)`;
/** People rails leave the house account out: it publishes precons, it is not a person. */
const PERSON = `${BREWER} AND u.is_official = false`;

async function ids(sql: string, params: unknown[] = []): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(sql, params);
  return rows.map((r) => r.id);
}

/** Hashes the UTC day to an index, so everyone sees the same spotlight all day
 *  and it moves at UTC midnight. */
export function spotlightIndex(now: number, count: number): number {
  const day = String(Math.floor(now / 86_400_000));
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619) >>> 0;
  return h % count;
}

async function loadSpotlightId(now: number): Promise<string | null> {
  const pool = getPool();
  const from = `FROM users u WHERE u.profile_hidden_at IS NULL AND u.is_official = false
       AND (SELECT COUNT(*) FROM deck_publications dp
             WHERE dp.user_id = u.id AND dp.unpublished_at IS NULL) >= 2`;
  const count = Number((await pool.query<{ n: string }>(`SELECT COUNT(*) AS n ${from}`)).rows[0].n);
  if (count === 0) return null;
  // ponytail: COUNT then OFFSET over every brewer with 2+ decks; fine for
  // thousands, move to a precomputed daily pick if that count outgrows it.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT u.id ${from} ORDER BY u.id OFFSET $1 LIMIT 1`,
    [spotlightIndex(now, count)]
  );
  return rows[0]?.id ?? null;
}

async function loadBase(now: number): Promise<BaseRails> {
  const cap = RAIL_MAX + 1;
  const [newestIds, likedIds, followedIds, spotlightId] = await Promise.all([
    ids(`SELECT u.id FROM users u WHERE ${PERSON} ORDER BY u.created_at DESC, u.id LIMIT ${cap}`),
    // Distinct accounts other than the deck's own author, across all their live decks.
    ids(
      `SELECT dp.user_id AS id
         FROM deck_likes dl
         JOIN deck_publications dp ON dp.slug = dl.slug AND dp.unpublished_at IS NULL
         JOIN users u ON u.id = dp.user_id
        WHERE dl.user_id <> dp.user_id AND ${PERSON}
        GROUP BY dp.user_id
       HAVING COUNT(DISTINCT dl.user_id) >= ${PEOPLE_FLOOR}
        ORDER BY COUNT(DISTINCT dl.user_id) DESC, dp.user_id
        LIMIT ${cap}`
    ),
    ids(
      `SELECT f.followee_id AS id
         FROM user_follows f JOIN users u ON u.id = f.followee_id
        WHERE ${PERSON}
        GROUP BY f.followee_id
       HAVING COUNT(*) >= ${PEOPLE_FLOOR}
        ORDER BY COUNT(*) DESC, f.followee_id
        LIMIT ${cap}`
    ),
    loadSpotlightId(now),
  ]);
  const byId = await loadBrewerCardMap([
    ...new Set([...newestIds, ...likedIds, ...followedIds, ...(spotlightId ? [spotlightId] : [])]),
  ]);
  const pick = (list: string[]) =>
    list.map((id) => byId.get(id)).filter((c): c is BrewerCard => c !== undefined);
  return {
    newest: pick(newestIds),
    mostLiked: pick(likedIds),
    mostFollowed: pick(followedIds),
    spotlight: spotlightId ? (byId.get(spotlightId) ?? null) : null,
  };
}

/**
 * Other brewers with a live deck for a commander the viewer has a live deck of,
 * most shared commanders first. Per viewer, so never cached.
 */
async function loadSharedCommanders(viewerId: string): Promise<BrewerCard[]> {
  const matches = await ids(
    `SELECT dp.user_id AS id
       FROM deck_publications dp
       JOIN users u ON u.id = dp.user_id
      WHERE dp.unpublished_at IS NULL AND dp.commander_name IS NOT NULL
        AND dp.user_id <> $1 AND u.profile_hidden_at IS NULL AND u.is_official = false
        AND lower(dp.commander_name) IN (
              SELECT lower(commander_name) FROM deck_publications
               WHERE user_id = $1 AND unpublished_at IS NULL AND commander_name IS NOT NULL)
      GROUP BY dp.user_id
      ORDER BY COUNT(DISTINCT lower(dp.commander_name)) DESC, MAX(dp.published_at) DESC, dp.user_id
      LIMIT ${RAIL_MAX}`,
    [viewerId]
  );
  return loadBrewerCards(matches);
}

/**
 * The Brewers tab rails. Each people rail leaves out the viewer (and, in SQL,
 * hidden accounts and the house account); a rail under its floor is [] and the
 * UI renders nothing for it.
 */
export async function loadBrewerRails(viewerId: string | null): Promise<BrewerRails> {
  // The JWT's username can be stale after a rename; the card carries the live one.
  const viewerUsername = viewerId
    ? ((
        await getPool().query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [
          viewerId,
        ])
      ).rows[0]?.username ?? null)
    : null;
  let base = brewerRailsCache.get('base');
  if (!base) {
    base = await loadBase(Date.now());
    brewerRailsCache.set('base', base);
  }
  const others = (cards: BrewerCard[]) =>
    cards.filter((c) => c.username !== viewerUsername).slice(0, RAIL_MAX);
  return {
    newest: others(base.newest),
    mostLiked: others(base.mostLiked),
    mostFollowed: others(base.mostFollowed),
    sharedCommanders: viewerId ? await loadSharedCommanders(viewerId) : [],
    // Nobody is shown themselves as the day's pick.
    spotlight: base.spotlight && base.spotlight.username !== viewerUsername ? base.spotlight : null,
  };
}
