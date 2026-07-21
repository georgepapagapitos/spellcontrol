import { logger } from '../logger';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { normalizeUsername, optionalAuth } from '../auth';
import { getPool } from '../db';
import { projectDeck, type PublicDeck } from '../shares/projections';
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

// Tighter than the read limiter — shared by the two write-ish beacons (copy,
// view) so one IP can't inflate `copy_count`/`view_count` at the 60/min read
// rate once a deck clears the ghost-town display threshold.
const publicWriteLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

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
              dp.view_count, dp.copy_count, u.username, u.display_name
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

publicRouter.post('/decks/:slug/copy', publicWriteLimiter, async (req: Request, res: Response) => {
  const result = await getPool().query(
    `UPDATE deck_publications SET copy_count = copy_count + 1
        WHERE slug = $1 AND unpublished_at IS NULL
      RETURNING copy_count`,
    [readSlugParam(req)]
  );
  if (result.rowCount === 0) return res.status(404).json(DECK_NOT_FOUND);
  res.status(204).end();
});

/**
 * View beacon. Always 204 — unknown slug, unpublished deck, and a successful
 * count all read identically to the caller (a view beacon must be
 * zero-information, unlike the copy route's 404). Owner-exclusion is
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
    await getPool()
      .query(
        `UPDATE deck_publications SET view_count = view_count + 1
          WHERE slug = $1 AND unpublished_at IS NULL
            AND ($2::text IS NULL OR user_id != $2)`,
        [readSlugParam(req), ownerId]
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
              created_at, profile_hidden_at
         FROM users WHERE username = $1`,
      [username]
    )
  ).rows[0];
  if (!user) return null;

  const [decksResult, countResult] = await Promise.all([
    pool.query<PublicDeckSummaryRow>(
      `SELECT slug, deck_name, format, commander_name, og_art_crop, color_identity,
              bracket, card_count, view_count, copy_count, published_at, updated_at
         FROM deck_publications
        WHERE user_id = $1 AND unpublished_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ${MAX_PROFILE_DECKS}`,
      [user.id]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM deck_publications WHERE user_id = $1 AND unpublished_at IS NULL`,
      [user.id]
    ),
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
    // True total, not decks.length — the 200 cap means those diverge for a
    // heavy publisher.
    deckCount: Number(countResult.rows[0].count),
    decks: decksResult.rows.map(toDeckSummary),
  };
  publicUserCache.set(username, profile);
  return profile;
}

/**
 * `optionalAuth` so the owner of a profile can always see it (even hidden by
 * moderation, or with zero live decks) while a stranger gets the same 404
 * either way — a stranger can't distinguish "never existed" from "hidden"
 * from "nothing published yet". Both owner-gating checks below short-circuit
 * for `isOwner`, so the loader/cache above stays completely viewer-agnostic.
 */
publicRouter.get(
  '/users/:username',
  publicReadLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const username = normalizeUsername(req.params.username);
    if (!username) return res.status(404).json(USER_NOT_FOUND);
    const profile = await loadPublicUserProfile(username);
    if (!profile) return res.status(404).json(USER_NOT_FOUND);

    const isOwner = req.user?.id === profile.id;
    if (!isOwner && (profile.profileHiddenAt !== null || profile.decks.length === 0)) {
      return res.status(404).json(USER_NOT_FOUND);
    }

    const moderationHidden = isOwner && profile.profileHiddenAt !== null;
    res.json({
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarCardName: profile.avatarCardName,
      avatarImageUrl: profile.avatarImageUrl,
      joinedAt: profile.memberSince,
      isOwner,
      moderationHidden,
      deckCount: profile.deckCount,
      decks: moderationHidden ? [] : profile.decks,
    });
  }
);
