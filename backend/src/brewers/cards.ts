import { getPool } from '../db';

/**
 * A brewer as one tile: who they are, a banner, and the few numbers that say
 * what they build. The ONE projection every brewer surface serves (directory,
 * rails, the following list), so the tiles can never disagree about a person.
 */
export interface BrewerCard {
  username: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  /** og_art_crop of the pinned deck, else the most-liked, else the newest
   *  live deck that has art. Null when they have none. */
  bannerImage: string | null;
  /** Live published decks. */
  deckCount: number;
  followerCount: number;
  /** Color letters (W U B R G, C for colorless) by how many live decks
   *  carry them, most first, at most five. */
  topColors: string[];
  /** The commander they have the most live decks of. */
  topCommander: string | null;
  joinedAt: number;
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'];

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_image_url: string | null;
  created_at: string;
  pinned_deck_slug: string | null;
  follower_count: string;
}

interface DeckRow {
  user_id: string;
  slug: string;
  commander_name: string | null;
  og_art_crop: string | null;
  color_identity: unknown;
  like_count: number;
  published_at: string;
}

/** Color letters of one deck; a deck with none is colorless ('C'). */
export function deckColors(identity: unknown): string[] {
  const letters = Array.isArray(identity)
    ? identity.filter((c): c is string => typeof c === 'string' && COLOR_ORDER.includes(c))
    : [];
  return letters.length > 0 ? letters : ['C'];
}

/**
 * Cards for `ids`, in the order given. An id that is unknown or whose account
 * a moderator hid is dropped: a hidden account appears on no public surface.
 * Two queries however many ids there are.
 */
export async function loadBrewerCards(ids: string[]): Promise<BrewerCard[]> {
  const byId = await loadBrewerCardMap(ids);
  return ids.map((id) => byId.get(id)).filter((c): c is BrewerCard => c !== undefined);
}

/** The same cards keyed by user id, for callers that assemble several lists. */
export async function loadBrewerCardMap(ids: string[]): Promise<Map<string, BrewerCard>> {
  const cards = new Map<string, BrewerCard>();
  if (ids.length === 0) return cards;
  const pool = getPool();
  const [users, decks] = await Promise.all([
    pool.query<UserRow>(
      `SELECT u.id, u.username, u.display_name, u.avatar_image_url, u.created_at,
              u.pinned_deck_slug,
              (SELECT COUNT(*) FROM user_follows f WHERE f.followee_id = u.id) AS follower_count
         FROM users u
        WHERE u.id = ANY($1::text[]) AND u.profile_hidden_at IS NULL`,
      [ids]
    ),
    pool.query<DeckRow>(
      `SELECT user_id, slug, commander_name, og_art_crop, color_identity, like_count, published_at
         FROM deck_publications
        WHERE user_id = ANY($1::text[]) AND unpublished_at IS NULL`,
      [ids]
    ),
  ]);

  const decksByUser = new Map<string, DeckRow[]>();
  for (const d of decks.rows) {
    const list = decksByUser.get(d.user_id) ?? [];
    list.push(d);
    decksByUser.set(d.user_id, list);
  }
  const userById = new Map(users.rows.map((u) => [u.id, u]));

  for (const id of ids) {
    const u = userById.get(id);
    if (!u) continue;
    const mine = decksByUser.get(id) ?? [];
    cards.set(id, {
      username: u.username,
      displayName: u.display_name,
      avatarImageUrl: u.avatar_image_url,
      bannerImage: pickBanner(mine, u.pinned_deck_slug),
      deckCount: mine.length,
      followerCount: Number(u.follower_count),
      topColors: topColors(mine),
      topCommander: topCommander(mine),
      joinedAt: Number(u.created_at),
    });
  }
  return cards;
}

function pickBanner(decks: DeckRow[], pinnedSlug: string | null): string | null {
  const withArt = decks.filter((d) => d.og_art_crop);
  const pinned = pinnedSlug ? withArt.find((d) => d.slug === pinnedSlug) : undefined;
  if (pinned) return pinned.og_art_crop;
  // Most liked, ties to the newest, so with no likes at all this IS the newest.
  const sorted = [...withArt].sort(
    (a, b) => b.like_count - a.like_count || Number(b.published_at) - Number(a.published_at)
  );
  return sorted[0]?.og_art_crop ?? null;
}

function topColors(decks: DeckRow[]): string[] {
  const counts = new Map<string, number>();
  for (const d of decks) {
    for (const c of deckColors(d.color_identity)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || COLOR_ORDER.indexOf(a[0]) - COLOR_ORDER.indexOf(b[0]))
    .slice(0, 5)
    .map(([c]) => c);
}

function topCommander(decks: DeckRow[]): string | null {
  const stats = new Map<string, { n: number; latest: number }>();
  for (const d of decks) {
    if (!d.commander_name) continue;
    const s = stats.get(d.commander_name) ?? { n: 0, latest: 0 };
    s.n += 1;
    s.latest = Math.max(s.latest, Number(d.published_at));
    stats.set(d.commander_name, s);
  }
  const best = [...stats.entries()].sort((a, b) => b[1].n - a[1].n || b[1].latest - a[1].latest)[0];
  return best?.[0] ?? null;
}
