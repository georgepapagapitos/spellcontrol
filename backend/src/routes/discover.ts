import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { requireAuth, optionalAuth } from '../auth';
import { getPool } from '../db';
import { hydratePublicationRows, type PublicationListingRow } from '../discover/hydrate';

/**
 * Public, unauthenticated, filtered/sorted/paginated deck browse for
 * Discover. Pure read — no view/copy tracking here; `view_count`/
 * `copy_count` are reads of columns `routes/public.ts` (view beacon) and
 * `routes/publications.ts`/`w1-deck-primer-lineage`'s copy endpoint already
 * maintain correctly (#1237 and friends). Every filter/sort predicate hits
 * only `deck_publications`' own real, denormalized columns — never a
 * `user_decks` JSONB scan (the required fold). The only JSONB touched by a
 * WHERE/ORDER BY is `deck_publications.color_identity`, a small per-
 * publication array column, not `user_decks.data`.
 */
export const discoverRouter: Router = Router();

const discoverReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
// Tighter than the read limiter — mirrors publicRouter's own read/write split
// for the same reason: a like/bookmark toggle is a write, not a hot read.
const discoverWriteLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
// Cheap, slim-table safety cap on the budget-filter candidate set — hydrating
// is the expensive part, not this SELECT. hasMore is bounded to this window,
// not the true total in the band (amendment carried forward from the
// original bucket spec).
const BUDGET_CANDIDATE_CAP = 500;

type SortKey = 'newest' | 'most-copied' | 'most-viewed';
const SORT_COLUMNS: Record<SortKey, string> = {
  newest: 'dp.published_at',
  'most-copied': 'dp.copy_count',
  'most-viewed': 'dp.view_count',
};

type BudgetKey = 'under50' | '50to150' | '150to400' | '400plus';
const BUDGET_BANDS: Record<BudgetKey, (v: number) => boolean> = {
  under50: (v) => v < 50,
  '50to150': (v) => v >= 50 && v < 150,
  '150to400': (v) => v >= 150 && v < 400,
  '400plus': (v) => v >= 400,
};

const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

function parseString(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || null;
}

function parseSort(raw: unknown): SortKey {
  return typeof raw === 'string' && raw in SORT_COLUMNS ? (raw as SortKey) : 'newest';
}

function parseBudget(raw: unknown): BudgetKey | null {
  return typeof raw === 'string' && raw in BUDGET_BANDS ? (raw as BudgetKey) : null;
}

function parseColors(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const up = part.trim().toUpperCase();
    if (VALID_COLORS.has(up) && !out.includes(up)) out.push(up);
  }
  return out.length > 0 ? out : null;
}

function parseBrackets(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 5 && !out.includes(n)) out.push(n);
  }
  return out.length > 0 ? out : null;
}

function parsePage(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function parsePageSize(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

interface PublicationSqlRow {
  user_id: string;
  deck_id: string;
  slug: string;
  deck_name: string;
  owner_username: string;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
  format: string;
  commander_name: string | null;
  commander_image_normal: string | null;
  color_identity: string[];
  bracket: number | null;
  card_count: number;
  view_count: number;
  copy_count: number;
  like_count: number;
  published_at: string;
}

function toListingRow(row: PublicationSqlRow): PublicationListingRow {
  return {
    userId: row.user_id,
    deckId: row.deck_id,
    slug: row.slug,
    name: row.deck_name,
    ownerUsername: row.owner_username,
    ownerDisplayName: row.owner_display_name,
    ownerAvatarUrl: row.owner_avatar_url,
    format: row.format,
    commanderName: row.commander_name,
    colorIdentity: row.color_identity,
    bracket: row.bracket,
    viewCount: row.view_count,
    copyCount: row.copy_count,
    likeCount: row.like_count,
    publishedAt: Number(row.published_at),
  };
}

// Shared by the main listing query below AND GET /bookmarks — the folded
// blocking fix, by construction: there is only one place a listing row's
// column set is ever defined, so a bookmarks read can never drift narrower.
const LISTING_COLUMNS = `dp.user_id, dp.deck_id, dp.slug, dp.deck_name, u.username AS owner_username,
       u.display_name AS owner_display_name, u.avatar_image_url AS owner_avatar_url,
       dp.format, dp.commander_name, dp.commander_image_normal, dp.color_identity,
       dp.bracket, dp.card_count, dp.view_count, dp.copy_count, dp.like_count, dp.published_at`;

// Real deck_publications columns only — the required fold. $4 (colorIdentity)
// is the one JSONB predicate, over deck_publications' own small denormalized
// array column, not user_decks.data.
const LISTING_WHERE = `dp.unpublished_at IS NULL
      AND ($1::text IS NULL OR dp.commander_name = $1)
      AND ($2::text IS NULL OR dp.format = $2)
      AND ($3::int[] IS NULL OR dp.bracket = ANY($3))
      AND ($4::text[] IS NULL OR dp.color_identity <@ to_jsonb($4::text[]))`;

interface ParsedFilters {
  commander: string | null;
  format: string | null;
  brackets: number[] | null;
  colors: string[] | null;
  sort: SortKey;
  budget: BudgetKey | null;
  page: number;
  pageSize: number;
}

function parseFilters(query: Request['query']): ParsedFilters {
  return {
    commander: parseString(query.commander),
    format: parseString(query.format)?.toLowerCase() ?? null,
    brackets: parseBrackets(query.bracket),
    colors: parseColors(query.colors),
    sort: parseSort(query.sort),
    budget: parseBudget(query.budget),
    page: parsePage(query.page),
    pageSize: parsePageSize(query.pageSize),
  };
}

discoverRouter.get(
  '/decks',
  discoverReadLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const filters = parseFilters(req.query);
    const pool = getPool();
    const whereParams = [filters.commander, filters.format, filters.brackets, filters.colors];
    const sortCol = SORT_COLUMNS[filters.sort];
    const viewerId = req.user?.id;

    if (!filters.budget) {
      // Fetch pageSize+1 to detect hasMore without a second COUNT query
      // (mirrors routes/sync.ts's delta-pull pagination).
      const offset = (filters.page - 1) * filters.pageSize;
      const { rows } = await pool.query<PublicationSqlRow>(
        `SELECT ${LISTING_COLUMNS}
         FROM deck_publications dp JOIN users u ON u.id = dp.user_id
        WHERE ${LISTING_WHERE}
        ORDER BY ${sortCol} DESC
        LIMIT $5 OFFSET $6`,
        [...whereParams, filters.pageSize + 1, offset]
      );
      const hasMore = rows.length > filters.pageSize;
      const pageRows = hasMore ? rows.slice(0, filters.pageSize) : rows;
      const decks = await hydratePublicationRows(pageRows.map(toListingRow), viewerId);
      return res.json({ decks, page: filters.page, hasMore });
    }

    // Budget path: candidate window first, hydrate all of it (cache-only price
    // is only known post-hydration), drop unpriced decks, filter to the band,
    // then paginate the remainder in Node.
    const { rows } = await pool.query<PublicationSqlRow>(
      `SELECT ${LISTING_COLUMNS}
       FROM deck_publications dp JOIN users u ON u.id = dp.user_id
      WHERE ${LISTING_WHERE}
      ORDER BY ${sortCol} DESC
      LIMIT ${BUDGET_CANDIDATE_CAP}`,
      whereParams
    );
    const hydrated = await hydratePublicationRows(rows.map(toListingRow), viewerId);
    const inBand = BUDGET_BANDS[filters.budget];
    const filtered = hydrated.filter(
      (d) => d.estimatedValueUsd !== null && inBand(d.estimatedValueUsd)
    );
    const start = (filters.page - 1) * filters.pageSize;
    const decks = filtered.slice(start, start + filters.pageSize);
    const hasMore = start + filters.pageSize < filtered.length;
    return res.json({ decks, page: filters.page, hasMore });
  }
);

const DECK_NOT_FOUND = { error: 'Deck not found.' } as const;

/** Mirrors publicRouter's readSlugParam — Express types a single-segment
 *  `:slug` as `string | string[]`; it's always a string in practice. */
function readSlugParam(req: Request): string {
  const raw = req.params.slug;
  return typeof raw === 'string' ? raw : raw[0];
}

/**
 * Live (published) owner lookup — the shared 404 gate for both toggle-on
 * routes below (also prevents probing unpublished-slug existence), and the
 * source of `deck_owner_id` for the insert, resolved once here rather than
 * joined through slug on every future "likes on decks I own" read.
 */
async function resolveLiveOwnerId(slug: string): Promise<string | null> {
  const { rows } = await getPool().query<{ user_id: string }>(
    `SELECT user_id FROM deck_publications WHERE slug = $1 AND unpublished_at IS NULL`,
    [slug]
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Like/unlike. No self-like guard (decided, not left open) — a user liking
 * their own public deck is harmless, same as anyone else's engagement.
 * A repeat like is a 201 no-op (ON CONFLICT DO NOTHING); an unlike is always
 * 204, whether or not a like existed — both idempotent by construction.
 */
discoverRouter.post(
  '/decks/:slug/like',
  requireAuth,
  discoverWriteLimiter,
  async (req: Request, res: Response) => {
    const slug = readSlugParam(req);
    const ownerId = await resolveLiveOwnerId(slug);
    if (!ownerId) return res.status(404).json(DECK_NOT_FOUND);

    const pool = getPool();
    const inserted = await pool.query(
      `INSERT INTO deck_likes (user_id, slug, deck_owner_id, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, slug) DO NOTHING`,
      [req.user!.id, slug, ownerId, Date.now()]
    );

    let likeCount: number;
    if ((inserted.rowCount ?? 0) > 0) {
      const updated = await pool.query<{ like_count: number }>(
        `UPDATE deck_publications SET like_count = like_count + 1 WHERE slug = $1 RETURNING like_count`,
        [slug]
      );
      likeCount = updated.rows[0].like_count;
    } else {
      const current = await pool.query<{ like_count: number }>(
        `SELECT like_count FROM deck_publications WHERE slug = $1`,
        [slug]
      );
      likeCount = current.rows[0]?.like_count ?? 0;
    }
    res.status(201).json({ likeCount });
  }
);

discoverRouter.delete(
  '/decks/:slug/like',
  requireAuth,
  discoverWriteLimiter,
  async (req: Request, res: Response) => {
    const slug = readSlugParam(req);
    const pool = getPool();
    const deleted = await pool.query(`DELETE FROM deck_likes WHERE user_id = $1 AND slug = $2`, [
      req.user!.id,
      slug,
    ]);
    if ((deleted.rowCount ?? 0) > 0) {
      await pool.query(
        `UPDATE deck_publications SET like_count = GREATEST(like_count - 1, 0) WHERE slug = $1`,
        [slug]
      );
    }
    res.status(204).end();
  }
);

/** Bookmark/unbookmark — identical shape to like/unlike, minus a counter
 *  (bookmarks are private, never publicly aggregated). */
discoverRouter.post(
  '/decks/:slug/bookmark',
  requireAuth,
  discoverWriteLimiter,
  async (req: Request, res: Response) => {
    const slug = readSlugParam(req);
    const ownerId = await resolveLiveOwnerId(slug);
    if (!ownerId) return res.status(404).json(DECK_NOT_FOUND);

    await getPool().query(
      `INSERT INTO deck_bookmarks (user_id, slug, deck_owner_id, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, slug) DO NOTHING`,
      [req.user!.id, slug, ownerId, Date.now()]
    );
    res.status(201).end();
  }
);

discoverRouter.delete(
  '/decks/:slug/bookmark',
  requireAuth,
  discoverWriteLimiter,
  async (req: Request, res: Response) => {
    const slug = readSlugParam(req);
    await getPool().query(`DELETE FROM deck_bookmarks WHERE user_id = $1 AND slug = $2`, [
      req.user!.id,
      slug,
    ]);
    res.status(204).end();
  }
);

/**
 * Private "Saved" list (SavedDecksPage). No pagination — personal lists are
 * realistically small. Reuses LISTING_COLUMNS + hydratePublicationRows() —
 * the exact same row shape the main listing route returns, never a bespoke
 * narrower SELECT (the folded, both-lenses-flagged blocking fix). A bookmark
 * whose target later goes private/unpublished is never deleted — the
 * `dp.unpublished_at IS NULL` filter just omits it from this read, so a
 * re-publish makes it reappear with no cleanup job.
 */
discoverRouter.get(
  '/bookmarks',
  requireAuth,
  discoverReadLimiter,
  async (req: Request, res: Response) => {
    const { rows } = await getPool().query<PublicationSqlRow>(
      `SELECT ${LISTING_COLUMNS}
         FROM deck_bookmarks db
         JOIN deck_publications dp ON dp.slug = db.slug
         JOIN users u ON u.id = dp.user_id
        WHERE db.user_id = $1 AND dp.unpublished_at IS NULL
        ORDER BY db.created_at DESC`,
      [req.user!.id]
    );
    const decks = await hydratePublicationRows(rows.map(toListingRow), req.user!.id);
    res.json({ decks });
  }
);

interface CommanderRow {
  commander_name: string;
}

discoverRouter.get(
  '/decks/commanders',
  discoverReadLimiter,
  async (req: Request, res: Response) => {
    const q = parseString(req.query.q);
    if (!q) return res.status(400).json({ error: 'q is required.' });
    if (q.length > 40) return res.status(400).json({ error: 'q must be 40 characters or fewer.' });

    const { rows } = await getPool().query<CommanderRow>(
      `SELECT DISTINCT commander_name FROM deck_publications
        WHERE unpublished_at IS NULL AND lower(commander_name) LIKE lower($1) || '%'
        ORDER BY commander_name LIMIT 10`,
      [q]
    );
    res.json({ commanders: rows.map((r) => r.commander_name) });
  }
);
