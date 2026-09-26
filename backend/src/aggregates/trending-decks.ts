import { getPool } from '../db';

/**
 * "Popular this week": public decks ranked by what other players actually did
 * with them, read straight from the rows that record it. A like, a save, and
 * a copy the player still holds (a live fork, see publications/copies.ts)
 * each need a signed-in account, and one account can do each once per deck.
 * The owner's own actions never count. Views are not an input at all: they
 * are anonymous, so they can't tell ten players from one refresh loop.
 *
 * A deck needs MIN_PLAYERS different accounts in the window before it can
 * appear. Until the community is big enough for that, the list is empty and
 * the rail hides, which beats a list of one person's decks.
 */

export const TRENDING_WINDOW_DAYS = 7;
/** Per day of age; recent actions count for more. */
export const DECAY_RATE = 0.7;
/** Distinct non-owner accounts a deck needs inside the window to qualify. */
export const MIN_PLAYERS = 3;
export const TRENDING_DECKS_LIMIT = 10;
/** A like is a nod, a save is intent, a copy is taking the list home. */
export const ACTION_WEIGHTS = { like: 1, save: 2, copy: 3 } as const;
/** Extra weight for a copy its player has taken into a logged game. */
export const PLAYED_COPY_BONUS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type EngagementKind = keyof typeof ACTION_WEIGHTS;

/** One action by one account on one public deck, owner already excluded. */
export interface EngagementEvent {
  slug: string;
  ownerId: string;
  deckName: string;
  commanderName: string | null;
  actorId: string;
  kind: EngagementKind;
  at: number;
  /** Copies only: the copy has been played in a logged game. */
  played: boolean;
}

export interface TrendingDeck {
  slug: string;
  deckName: string;
  commanderName: string | null;
  /** Distinct accounts that liked, saved or copied it inside the window. */
  players: number;
  score: number;
}

interface DeckTally {
  ownerId: string;
  deckName: string;
  commanderName: string | null;
  actors: Set<string>;
  score: number;
}

/**
 * Pure. Scores each deck by its weighted, decayed actions, drops any deck
 * with fewer than MIN_PLAYERS distinct accounts behind it, and keeps only
 * the best deck per author so one prolific account can't fill the list.
 */
export function rankTrendingDecks(events: EngagementEvent[], now: number): TrendingDeck[] {
  const byDeck = new Map<string, DeckTally>();
  for (const e of events) {
    const ageDays = Math.floor((now - e.at) / DAY_MS);
    if (ageDays < 0 || ageDays >= TRENDING_WINDOW_DAYS) continue;
    const deck = byDeck.get(e.slug) ?? {
      ownerId: e.ownerId,
      deckName: e.deckName,
      commanderName: e.commanderName,
      actors: new Set<string>(),
      score: 0,
    };
    const weight = ACTION_WEIGHTS[e.kind] + (e.kind === 'copy' && e.played ? PLAYED_COPY_BONUS : 0);
    deck.score += weight * DECAY_RATE ** ageDays;
    deck.actors.add(e.actorId);
    byDeck.set(e.slug, deck);
  }

  const ranked = [...byDeck]
    .filter(([, d]) => d.actors.size >= MIN_PLAYERS)
    .sort(
      ([slugA, a], [slugB, b]) =>
        b.score - a.score || b.actors.size - a.actors.size || (slugA < slugB ? -1 : 1)
    );

  const authors = new Set<string>();
  const out: TrendingDeck[] = [];
  for (const [slug, d] of ranked) {
    if (authors.has(d.ownerId)) continue;
    authors.add(d.ownerId);
    out.push({
      slug,
      deckName: d.deckName,
      commanderName: d.commanderName,
      players: d.actors.size,
      score: d.score,
    });
    if (out.length === TRENDING_DECKS_LIMIT) break;
  }
  return out;
}

/**
 * Every like, save and live copy of a live public deck inside the window, by
 * anyone but its owner. A copy's time is the copied deck's own `createdAt`
 * (the CASE keeps a malformed value from failing the whole read). "Played"
 * means the copy's id sits in one of its player's logged games.
 */
export async function loadEngagementEvents(now: number): Promise<EngagementEvent[]> {
  const since = now - TRENDING_WINDOW_DAYS * DAY_MS;
  const { rows } = await getPool().query<{
    slug: string;
    owner_id: string;
    deck_name: string;
    commander_name: string | null;
    actor_id: string;
    kind: EngagementKind;
    at: string;
    played: boolean;
  }>(
    `SELECT p.slug, p.user_id AS owner_id, p.deck_name, p.commander_name,
            e.actor_id, e.kind, e.at, e.played
       FROM deck_publications p
       JOIN (
         SELECT slug, user_id AS actor_id, 'like' AS kind, created_at AS at, false AS played
           FROM deck_likes WHERE created_at > $1
         UNION ALL
         SELECT slug, user_id, 'save', created_at, false
           FROM deck_bookmarks WHERE created_at > $1
         UNION ALL
         SELECT copies.slug, copies.actor_id, 'copy', copies.at,
                EXISTS (
                  SELECT 1 FROM user_games g
                   WHERE g.user_id = copies.actor_id AND g.deleted_at IS NULL
                     AND g.data->'players' @> jsonb_build_array(jsonb_build_object('deckId', copies.deck_id))
                )
           FROM (
             SELECT ud.data->'forkedFrom'->>'slug' AS slug, ud.user_id AS actor_id, ud.id AS deck_id,
                    CASE WHEN ud.data->>'createdAt' ~ '^[0-9]{1,15}$'
                         THEN (ud.data->>'createdAt')::bigint END AS at
               FROM user_decks ud
              WHERE ud.deleted_at IS NULL AND (ud.data->'forkedFrom'->>'slug') IS NOT NULL
           ) copies
          WHERE copies.at > $1
       ) e ON e.slug = p.slug
      WHERE p.unpublished_at IS NULL AND e.actor_id <> p.user_id`,
    [since]
  );
  return rows.map((r) => ({
    slug: r.slug,
    ownerId: r.owner_id,
    deckName: r.deck_name,
    commanderName: r.commander_name,
    actorId: r.actor_id,
    kind: r.kind,
    at: Number(r.at),
    played: r.played,
  }));
}

export async function loadTrendingDecks(now: number): Promise<TrendingDeck[]> {
  return rankTrendingDecks(await loadEngagementEvents(now), now);
}
