import { logger } from '../logger';
import { findRenamedOwner } from '../username/rename';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { normalizeUsername, optionalAuth } from '../auth';
import { getPool } from '../db';
import { ORIGIN, type ShareLandingMeta, type ShareLandingResult } from '../shares/og';
import { projectCollection, projectDeck, type PublicDeck } from '../shares/projections';
import { stampSharePrices } from '../shares/context';
import { areFriends } from '../friends/relations';
import { claimedCopyIds, summarizeCardUse } from '../friends/card-use';
import { cachedPrintingsForMissingRanks, edhrecRankOf } from '../shares/edhrec-rank';
import { sendGzippedJson } from '../gzip-json';
import { loadProfileExtras } from '../brewers/profile-stats';
import { canViewFullCollection, storedCollectionVisibility } from '../collections/visibility';
import {
  deckPublicationCache,
  publicUserCache,
  type PublicDeckPage,
  type PublicDeckSummary,
  type PublicUserProfile,
} from '../publications/cache';

/**
 * Anonymous, rate-limited, cached public reads for published decks and
 * profiles — the pages `w1-public-deck-page` / `w1-public-profile-page`
 * render against. No auth middleware *gates* the GETs (unlike
 * `/api/shares/public/:token`; a published deck has no audience gating
 * once live) — `optionalAuth` runs on the view beacon and on the profile
 * read, both to detect and exclude/include the owner (a deck's own owner
 * doesn't bump their own view count; a profile's own owner can always see
 * it, even hidden or empty — see the isOwner handling below).
 */
export const publicRouter: Router = Router();

const publicReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

// Tighter than the read limiter for the view beacon, the one write here.
const publicWriteLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

/**
 * One view per viewer per deck per day: the signed-in account, or the IP for
 * a guest. Without it a refresh, or a loop, counted again. Held in memory on
 * purpose: the backend is one Fly machine, and an IP kept here is never
 * written anywhere, so the privacy page's no-identifiers promise holds. A
 * restart forgets it, which costs at most one extra view per viewer.
 */
const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const VIEW_KEYS_MAX = 50_000;
const recentViews = new Map<string, number>();

export function isFirstViewToday(key: string, now: number): boolean {
  const seenAt = recentViews.get(key);
  if (seenAt !== undefined && now - seenAt < VIEW_WINDOW_MS) return false;
  // Re-inserting moves the key to the end, so the map stays oldest-first and
  // expired entries are always at the front.
  recentViews.delete(key);
  for (const [oldKey, at] of recentViews) {
    if (now - at < VIEW_WINDOW_MS && recentViews.size < VIEW_KEYS_MAX) break;
    recentViews.delete(oldKey);
  }
  recentViews.set(key, now);
  return true;
}

const MAX_PROFILE_DECKS = 200;

const DECK_NOT_FOUND = { error: 'Deck not found.' } as const;
const USER_NOT_FOUND = { error: 'User not found.' } as const;

/** Mirrors sharesRouter's readTokenParam — Express types req.params values as
 *  `string | string[]`; a single-segment `:slug` is always a string in
 *  practice, but callers that need a concrete `string` (not `unknown`) need
 *  the type narrowed. (`:username` doesn't need this — normalizeUsername
 *  already accepts `unknown` and safely null-checks a non-string.) */
function readSlugParam(req: Request): string {
  const raw = req.params.slug;
  return typeof raw === 'string' ? raw : raw[0];
}

interface DeckPublicationRow {
  deck_id: string;
  user_id: string;
  slug: string;
  published_at: string;
  updated_at: string;
  view_count: number;
  copy_count: number;
  username: string;
  display_name: string | null;
  is_official: boolean;
}

/**
 * Cached read of a published deck's public page. The GET route is a pure
 * read — it never increments `view_count` (that's the dedicated
 * `POST /decks/:slug/view` beacon below); a cache hit or miss here has no
 * side effect on the DB.
 */
async function loadPublicDeckPage(slug: string): Promise<PublicDeckPage | null> {
  const cached = deckPublicationCache.get(slug);
  if (cached) return cached;

  const pool = getPool();
  const pub = (
    await pool.query<DeckPublicationRow>(
      `SELECT dp.deck_id, dp.user_id, dp.slug, dp.published_at, dp.updated_at,
              dp.view_count, dp.copy_count, u.username, u.display_name, u.is_official
         FROM deck_publications dp
         JOIN users u ON u.id = dp.user_id
        WHERE dp.slug = $1 AND dp.unpublished_at IS NULL
        LIMIT 1`,
      [slug]
    )
  ).rows[0];
  if (!pub) return null;

  // Defensive: a publication row surviving a race past its own deck's
  // tombstone. Same 404 as unknown/unpublished — stealth.
  const deckData = (
    await pool.query<{ data: unknown }>(
      `SELECT data FROM user_decks WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [pub.user_id, pub.deck_id]
    )
  ).rows[0]?.data;
  if (deckData == null) return null;

  const deck: PublicDeck | null = projectDeck(
    { username: pub.username, displayName: pub.display_name },
    deckData
  );
  if (!deck) return null;

  const page: PublicDeckPage = {
    slug: pub.slug,
    publishedAt: Number(pub.published_at),
    updatedAt: Number(pub.updated_at),
    viewCount: pub.view_count,
    copyCount: pub.copy_count,
    official: pub.is_official,
    deck,
  };
  deckPublicationCache.set(slug, page);
  return page;
}

publicRouter.get('/decks/:slug', publicReadLimiter, async (req: Request, res: Response) => {
  const page = await loadPublicDeckPage(readSlugParam(req));
  if (!page) return res.status(404).json(DECK_NOT_FOUND);
  res.json(page);
});

/**
 * View beacon. Always 204 — unknown slug, unpublished deck, a repeat view and
 * a successful count all read identically to the caller (a view beacon must
 * be zero-information). A repeat within the day is dropped before the query
 * (isFirstViewToday). Owner-exclusion is
 * authoritative server-side via the `user_id != $2` guard below rather than
 * trusting the client's own skip-for-owner check. Anonymous callers pass
 * `ownerId = null`, which the `$2::text IS NULL OR …` clause always
 * satisfies, so one UPDATE handles anonymous / owner / non-owner / unknown
 * slug uniformly. Failure is swallowed — it must never surface to the page.
 */
publicRouter.post(
  '/decks/:slug/view',
  publicWriteLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const ownerId = req.user?.id ?? null;
    const slug = readSlugParam(req);
    if (!isFirstViewToday(`${slug}\n${ownerId ?? req.ip}`, Date.now())) {
      return res.status(204).end();
    }
    await getPool()
      .query(
        `UPDATE deck_publications SET view_count = view_count + 1
          WHERE slug = $1 AND unpublished_at IS NULL
            AND ($2::text IS NULL OR user_id != $2)`,
        [slug, ownerId]
      )
      .catch((err) => logger.warn('[public] view beacon update failed', err));
    res.status(204).end();
  }
);

interface PublicDeckSummaryRow {
  slug: string;
  deck_name: string;
  format: string;
  commander_name: string | null;
  og_art_crop: string | null;
  color_identity: string[];
  bracket: number | null;
  estimated_bracket: number | null;
  card_count: number;
  view_count: number;
  copy_count: number;
  published_at: string;
  updated_at: string;
}

function toDeckSummary(row: PublicDeckSummaryRow): PublicDeckSummary {
  return {
    slug: row.slug,
    name: row.deck_name,
    format: row.format,
    commanderName: row.commander_name,
    // Direct column read — resolved via cardArtUrl at publish/refresh time
    // (see publications/listing-fields.ts). No deriveArtCrop helper, no
    // /normal/ -> /art_crop/ string-replace here.
    commanderImage: row.og_art_crop,
    colorIdentity: row.color_identity,
    cardCount: row.card_count,
    bracket: row.bracket,
    estimatedBracket: row.estimated_bracket,
    viewCount: row.view_count,
    copyCount: row.copy_count,
    publishedAt: Number(row.published_at),
    updatedAt: Number(row.updated_at),
  };
}

interface PublicUserRow {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_card_name: string | null;
  avatar_image_url: string | null;
  created_at: string;
  profile_hidden_at: string | null;
  collection_visibility: string | null;
  is_official: boolean;
  pinned_deck_slug: string | null;
  show_game_record: boolean;
}

/**
 * Cached, viewer-agnostic read of a user's profile row + their live deck
 * list. Deliberately does NOT decide isOwner/moderationHidden/404 here —
 * those depend on who's asking, and this result is shared across every
 * viewer via `publicUserCache`. The route handler below derives the
 * per-request response from this same cached shape.
 */
async function loadPublicUserProfile(username: string): Promise<PublicUserProfile | null> {
  const cached = publicUserCache.get(username);
  if (cached) return cached;

  const pool = getPool();
  const user = (
    await pool.query<PublicUserRow>(
      `SELECT id, username, display_name, bio, avatar_card_name, avatar_image_url,
              created_at, profile_hidden_at, collection_visibility, is_official,
              pinned_deck_slug, show_game_record
         FROM users WHERE username = $1`,
      [username]
    )
  ).rows[0];
  if (!user) return null;

  // The house account lists newest precon first. Its updated_at moves with
  // every price refresh, which would shuffle the page for no reason.
  const [decksResult, countResult, extras] = await Promise.all([
    pool.query<PublicDeckSummaryRow>(
      `SELECT slug, deck_name, format, commander_name, og_art_crop, color_identity,
              bracket, estimated_bracket, card_count, view_count, copy_count, published_at,
              updated_at
         FROM deck_publications
        WHERE user_id = $1 AND unpublished_at IS NULL
        ORDER BY ${user.is_official ? 'published_at' : 'updated_at'} DESC
        LIMIT ${MAX_PROFILE_DECKS}`,
      [user.id]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM deck_publications WHERE user_id = $1 AND unpublished_at IS NULL`,
      [user.id]
    ),
    loadProfileExtras({
      id: user.id,
      pinnedDeckSlug: user.pinned_deck_slug,
      showGameRecord: user.show_game_record,
    }),
  ]);

  const profile: PublicUserProfile = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarCardName: user.avatar_card_name,
    avatarImageUrl: user.avatar_image_url,
    memberSince: Number(user.created_at),
    profileHiddenAt: user.profile_hidden_at === null ? null : Number(user.profile_hidden_at),
    collectionVisibility: storedCollectionVisibility(user.collection_visibility),
    isOfficial: user.is_official,
    // True total, not decks.length — the 200 cap means those diverge for a
    // heavy publisher.
    deckCount: Number(countResult.rows[0].count),
    decks: decksResult.rows.map(toDeckSummary),
    ...extras,
  };
  publicUserCache.set(username, profile);
  return profile;
}

/**
 * The per-viewer half of a profile: follower and following counts (two indexed
 * COUNTs) and whether the signed-in viewer follows / is friends with them.
 * Kept out of the cached profile so a follow reflects immediately.
 */
async function loadSocialCounts(profileId: string, viewerId: string | null) {
  const pool = getPool();
  const other = viewerId && viewerId !== profileId ? viewerId : null;
  const [followers, following, viewer] = await Promise.all([
    pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM user_follows WHERE followee_id = $1`, [
      profileId,
    ]),
    pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = $1`, [
      profileId,
    ]),
    other
      ? pool.query<{ follows: boolean; friend: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2) AS follows,
                  EXISTS(SELECT 1 FROM friendships
                          WHERE status = 'accepted'
                            AND ((requester_id = $1 AND addressee_id = $2)
                              OR (requester_id = $2 AND addressee_id = $1))) AS friend`,
          [other, profileId]
        )
      : null,
  ]);
  return {
    followerCount: Number(followers.rows[0].n),
    followingCount: Number(following.rows[0].n),
    viewerFollows: viewer?.rows[0].follows ?? false,
    viewerIsFriend: viewer?.rows[0].friend ?? false,
  };
}

/**
 * `optionalAuth` so the owner of a profile can always see it (even hidden by
 * moderation) while a stranger gets the same 404 for "never existed" and
 * "hidden". Every other account resolves, decks or not (board T136: click an
 * author, see their stuff): an empty profile is a page with nothing on it
 * yet, not a missing one. Whether it is INDEXED is a separate rule, still
 * keyed on having a live deck (lookupPublicUserLandingMeta, sitemap.ts).
 * The owner and collection checks happen per request, so the loader/cache
 * above stays viewer-agnostic.
 */
publicRouter.get(
  '/users/:username',
  publicReadLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const username = normalizeUsername(req.params.username);
    if (!username) return res.status(404).json(USER_NOT_FOUND);
    const profile = await loadPublicUserProfile(username);
    if (!profile) {
      // Same rename case as the SSR landing above, answered in a form a
      // fetch() can act on: a 3xx here would be followed transparently and
      // the SPA would never learn to correct its own URL.
      const renamedTo = await findRenamedOwner(username);
      if (renamedTo) return res.status(404).json({ ...USER_NOT_FOUND, renamedTo });
      return res.status(404).json(USER_NOT_FOUND);
    }

    const isOwner = req.user?.id === profile.id;
    if (!isOwner && profile.profileHiddenAt !== null) {
      return res.status(404).json(USER_NOT_FOUND);
    }

    const moderationHidden = isOwner && profile.profileHiddenAt !== null;
    // Per request, never cached: a follow or unfollow shows at once.
    const social = await loadSocialCounts(profile.id, req.user?.id ?? null);
    res.json({
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarCardName: profile.avatarCardName,
      avatarImageUrl: profile.avatarImageUrl,
      joinedAt: profile.memberSince,
      isOfficial: profile.isOfficial,
      isOwner,
      moderationHidden,
      deckCount: profile.deckCount,
      ...social,
      stats: profile.stats,
      topCommanders: profile.topCommanders,
      colorSpread: profile.colorSpread,
      pinnedDeckSlug: profile.pinnedDeckSlug,
      gameRecord: profile.gameRecord,
      decks: moderationHidden ? [] : profile.decks,
      collection: {
        // The setting in force, for the owner's "who can see this" note
        // (never chose reads as friends; storedCollectionVisibility).
        visibility: profile.collectionVisibility,
        canView:
          !moderationHidden &&
          (await canViewFullCollection(profile.id, profile.collectionVisibility, req.user?.id)),
      },
    });
  }
);

/**
 * The full collection on a profile's Collection tab: one entry per physical
 * copy with its printing, finish, condition and market price, the same
 * projection a collection share link serves. Gated per request by
 * `canViewFullCollection` (public / friends-only / private; NULL = never
 * chose reads as friends-only since #2580, see `storedCollectionVisibility`), and answered with the same 404 as a missing profile so a
 * stranger can't tell "private" from "no such user".
 *
 * No response cache. A share token's collection is cached 60 s
 * (shares/cache.ts); add the same here, keyed by username and purged in
 * purgeUserPublicCaches, if profile traffic ever makes big collections hot.
 */
publicRouter.get(
  '/users/:username/collection',
  publicReadLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const username = normalizeUsername(req.params.username);
    if (!username) return res.status(404).json(USER_NOT_FOUND);
    const profile = await loadPublicUserProfile(username);
    if (!profile) return res.status(404).json(USER_NOT_FOUND);
    const isOwner = req.user?.id === profile.id;
    if (!isOwner && profile.profileHiddenAt !== null) {
      return res.status(404).json(USER_NOT_FOUND);
    }
    if (!(await canViewFullCollection(profile.id, profile.collectionVisibility, req.user?.id))) {
      return res.status(404).json(USER_NOT_FOUND);
    }

    const pool = getPool();
    // Trade signals (is this copy sleeved in a deck, does the owner have one to
    // spare) are for the owner and accepted friends only. A stranger reading a
    // public collection gets neither key, so a public profile never says what
    // the owner is building. Booleans only: no deck id or name leaves here.
    const withSignals = isOwner || (!!req.user && (await areFriends(profile.id, req.user.id)));
    const [rows, deckRows, cubeRows] = await Promise.all([
      pool.query<{ id: string; data: unknown }>(
        `SELECT id, data FROM user_cards WHERE user_id = $1 AND deleted_at IS NULL`,
        [profile.id]
      ),
      withSignals
        ? pool.query<{ id: string; data: unknown }>(
            `SELECT id, data FROM user_decks WHERE user_id = $1 AND deleted_at IS NULL`,
            [profile.id]
          )
        : null,
      withSignals
        ? pool.query<{ id: string; data: unknown }>(
            `SELECT id, data FROM user_cubes WHERE user_id = $1 AND deleted_at IS NULL`,
            [profile.id]
          )
        : null,
    ]);
    const live = rows.rows.filter((r) => r.data != null);
    const cards = live.map((r) => r.data);
    stampSharePrices(cards);
    const printings = cachedPrintingsForMissingRanks(cards as Array<Record<string, unknown>>);

    const claimed = withSignals ? claimedCopyIds(deckRows!.rows, cubeRows!.rows) : null;
    const use = withSignals
      ? summarizeCardUse(live, deckRows!.rows, cubeRows!.rows, new Set())
      : null;
    // Row id by data object, so the per-copy decorator can look its copy up.
    const idOf = new Map<unknown, string>(live.map((r) => [r.data, r.id]));

    const body = projectCollection(
      { username: profile.username, displayName: profile.displayName },
      { cards },
      (raw, card) => {
        const rank = edhrecRankOf(
          raw.edhrecRank,
          typeof raw.scryfallId === 'string' ? printings.get(raw.scryfallId) : undefined
        );
        if (rank !== undefined) card.edhrecRank = rank;
        if (!claimed || !use) return;
        card.inDeck = claimed.has(idOf.get(raw) ?? '');
        card.spare = use.get(card.oracleId ?? '')?.spare ?? false;
      }
    );
    sendGzippedJson(req, res, body, 'public/collection');
  }
);

/**
 * Cheap OG/Twitter metadata lookup for the `/d/:slug` server-rendered
 * landing page (w1-public-routes-linkability) — used by
 * `createShareLandingHandler`, not by the JSON API above. Deliberately a
 * standalone query rather than a reuse of `loadPublicDeckPage`/its cache:
 * a crawler/unfurl-bot hit is exactly the traffic this makes newly
 * possible at scale, so this stays a small constant-time read decoupled
 * from the heavier deck-detail cache. `og_art_crop` is read directly — it
 * was already resolved via `cardArtUrl` at publish time
 * (publications/listing-fields.ts) — so there is no `/normal/`→`/art_crop/`
 * derivation here.
 */
export async function lookupPublicDeckLandingMeta(slug: string): Promise<ShareLandingMeta | null> {
  const { rows } = await getPool().query<{
    deck_name: string;
    format: string;
    commander_name: string | null;
    og_art_crop: string | null;
    card_count: number;
  }>(
    `SELECT deck_name, format, commander_name, og_art_crop, card_count
       FROM deck_publications WHERE slug = $1 AND unpublished_at IS NULL LIMIT 1`,
    [slug]
  );
  const row = rows[0];
  if (!row) return null; // unknown or unpublished slug — same stealth as GET /decks/:slug's 404
  return {
    title: `${row.deck_name} — ${row.format} deck`,
    description: `${row.card_count} card${row.card_count === 1 ? '' : 's'}${
      row.commander_name ? `, led by ${row.commander_name}` : ''
    } — view the collection-aware breakdown on SpellControl.`,
    url: `${ORIGIN}/d/${slug}`,
    indexable: true,
    image: row.og_art_crop ?? undefined,
  };
}

/**
 * Cheap OG/Twitter metadata lookup for the `/u/:username` server-rendered
 * landing page. Indexable ONLY for a user with at least one live
 * publication and no moderation hold — a zero-publication or hidden
 * profile returns null (→ noindex), mirroring this router's own
 * `GET /users/:username` 404-stealth semantics for the same two cases so a
 * crawler and an anonymous browser see functionally the same signal
 * (Folded blocking fix #2 — otherwise every registered username would be
 * an indexable, crawlable stub the instant they sign up).
 */
export async function lookupPublicUserLandingMeta(
  username: string
): Promise<ShareLandingResult | null> {
  // The URL segment is whatever the visitor typed; the canonical must be the
  // one normalized handle, or /u/TradePal and /u/tradepal each claim to be
  // the canonical page of the same profile (playtest batch 11).
  const handle = username.toLowerCase();
  const { rows } = await getPool().query<{
    display_name: string | null;
    profile_hidden_at: string | null;
    has_live: boolean;
  }>(
    `SELECT u.display_name, u.profile_hidden_at,
            EXISTS(SELECT 1 FROM deck_publications dp
                   WHERE dp.user_id = u.id AND dp.unpublished_at IS NULL) AS has_live
       FROM users u WHERE u.username = $1`,
    [handle]
  );
  const row = rows[0];
  // Nobody holds this handle. If an account released it and it is still
  // unclaimed, this URL is somebody's old profile link — send the crawler
  // (and the person) to where that account lives now, rather than 404ing a
  // link that may be years old and still in the index.
  if (!row) {
    const current = await findRenamedOwner(handle);
    return current ? { redirectTo: `/u/${current}` } : null;
  }
  if (row.profile_hidden_at !== null || !row.has_live) return null;
  return {
    title: `${row.display_name ?? handle} on SpellControl`,
    description: `View ${row.display_name ?? handle}'s public decks on SpellControl.`,
    url: `${ORIGIN}/u/${handle}`,
    indexable: true,
  };
}
