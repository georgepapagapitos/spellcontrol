import { getPool } from '../db';
import { deckColors } from './cards';

export interface ProfileStats {
  /** DISTINCT accounts other than the owner that liked any of their live decks. */
  likesReceived: number;
  /** Sum of copy_count over live decks; that column is already derived from
   *  other accounts' live forks (publications/copies.ts), never a click count. */
  copiesReceived: number;
}

export interface TopCommander {
  name: string;
  image: string | null;
  deckCount: number;
}

export type ColorSpread = Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>;

export interface GameRecord {
  games: number;
  wins: number;
  mostPlayed: { name: string; slug: string | null } | null;
}

export interface ProfileExtras {
  stats: ProfileStats;
  topCommanders: TopCommander[];
  colorSpread: ColorSpread;
  pinnedDeckSlug: string | null;
  gameRecord: GameRecord | null;
}

/** The pin, only if it is still a live publication of theirs. */
export async function resolveLivePin(userId: string, slug: string | null): Promise<string | null> {
  if (!slug) return null;
  const { rows } = await getPool().query(
    `SELECT 1 FROM deck_publications WHERE slug = $1 AND user_id = $2 AND unpublished_at IS NULL`,
    [slug, userId]
  );
  return rows.length > 0 ? slug : null;
}

/**
 * The viewer-agnostic half of a profile's numbers (the route caches it with
 * the rest of the profile). Follower counts are NOT here: they are per request
 * so a follow shows at once.
 */
export async function loadProfileExtras(user: {
  id: string;
  pinnedDeckSlug: string | null;
  showGameRecord: boolean;
}): Promise<ProfileExtras> {
  const pool = getPool();
  const [likes, decks, commanders, pinnedDeckSlug, gameRecord] = await Promise.all([
    pool.query<{ n: string }>(
      `SELECT COUNT(DISTINCT dl.user_id) AS n
         FROM deck_likes dl
         JOIN deck_publications dp ON dp.slug = dl.slug
        WHERE dp.user_id = $1 AND dp.unpublished_at IS NULL AND dl.user_id <> $1`,
      [user.id]
    ),
    pool.query<{ color_identity: unknown; copy_count: number }>(
      `SELECT color_identity, copy_count FROM deck_publications
        WHERE user_id = $1 AND unpublished_at IS NULL`,
      [user.id]
    ),
    pool.query<{ name: string; image: string | null; deck_count: string }>(
      `SELECT commander_name AS name,
              (array_agg(og_art_crop ORDER BY published_at DESC)
                 FILTER (WHERE og_art_crop IS NOT NULL))[1] AS image,
              COUNT(*) AS deck_count
         FROM deck_publications
        WHERE user_id = $1 AND unpublished_at IS NULL AND commander_name IS NOT NULL
        GROUP BY commander_name
        ORDER BY COUNT(*) DESC, MAX(published_at) DESC
        LIMIT 3`,
      [user.id]
    ),
    resolveLivePin(user.id, user.pinnedDeckSlug),
    user.showGameRecord ? loadGameRecord(user.id) : Promise.resolve(null),
  ]);

  const colorSpread: ColorSpread = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let copiesReceived = 0;
  for (const d of decks.rows) {
    copiesReceived += d.copy_count;
    for (const c of deckColors(d.color_identity)) colorSpread[c as keyof ColorSpread] += 1;
  }

  return {
    stats: { likesReceived: Number(likes.rows[0].n), copiesReceived },
    topCommanders: commanders.rows.map((r) => ({
      name: r.name,
      image: r.image,
      deckCount: Number(r.deck_count),
    })),
    colorSpread,
    pinnedDeckSlug,
    gameRecord,
  };
}

/** How many recent games the most-played deck is read from. */
const MOST_PLAYED_WINDOW = 500;

/**
 * A finished-game record from `game_results`, the canonical record of every
 * finished game (online rows written when a session finishes, local rows
 * posted by the device that tracked the table; `user_games` is no longer
 * written). A game counts when the account held a seat (`participants @>`, the
 * GIN-indexed idiom game-results.ts uses); a seat's userId is only ever a
 * credited friend or the recorder, never a free-text claim. Co-op (horde)
 * games are excluded: they have no winning seat, so they would only dilute a
 * win rate. A win is `winner_user_id` being this account.
 *
 * mostPlayed reads the deck from the account's own seat over its last
 * MOST_PLAYED_WINDOW games; `slug` is set only while that deck is still one of
 * their live publications.
 */
export async function loadGameRecord(userId: string): Promise<GameRecord> {
  const pool = getPool();
  const seat = JSON.stringify([{ userId }]);
  const [totals, seats] = await Promise.all([
    pool.query<{ games: string; wins: string }>(
      `SELECT COUNT(*) AS games, COUNT(*) FILTER (WHERE winner_user_id = $2) AS wins
         FROM game_results
        WHERE participants @> $1::jsonb AND format <> 'horde'`,
      [seat, userId]
    ),
    pool.query<{ deck_id: string | null; deck_name: string | null; commander: string | null }>(
      `SELECT p->>'deckId' AS deck_id, p->>'deckName' AS deck_name, p->>'commander' AS commander
         FROM (SELECT participants FROM game_results
                WHERE participants @> $1::jsonb AND format <> 'horde'
                ORDER BY ended_at DESC LIMIT ${MOST_PLAYED_WINDOW}) g
        CROSS JOIN LATERAL jsonb_array_elements(g.participants) p
        WHERE p->>'userId' = $2`,
      [seat, userId]
    ),
  ]);

  const tally = new Map<string, { name: string; deckId: string | null; n: number }>();
  for (const s of seats.rows) {
    const name = s.deck_name ?? s.commander;
    if (!name) continue;
    const key = s.deck_id ?? `name:${name}`;
    const t = tally.get(key) ?? { name, deckId: s.deck_id, n: 0 };
    t.n += 1;
    tally.set(key, t);
  }
  const top = [...tally.values()].sort((a, b) => b.n - a.n)[0];
  let mostPlayed: GameRecord['mostPlayed'] = null;
  if (top) {
    const slug = top.deckId
      ? (
          await pool.query<{ slug: string }>(
            `SELECT slug FROM deck_publications
              WHERE user_id = $1 AND deck_id = $2 AND unpublished_at IS NULL`,
            [userId, top.deckId]
          )
        ).rows[0]?.slug
      : undefined;
    mostPlayed = { name: top.name, slug: slug ?? null };
  }

  return {
    games: Number(totals.rows[0].games),
    wins: Number(totals.rows[0].wins),
    mostPlayed,
  };
}
