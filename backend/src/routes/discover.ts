import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
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
  format: string;
  commander_name: string | null;
  commander_image_normal: string | null;
  color_identity: string[];
  bracket: number | null;
  card_count: number;
  view_count: number;
  copy_count: number;
  published_at: string;
}

function toListingRow(row: PublicationSqlRow): PublicationListingRow {
  return {
    userId: row.user_id,
    deckId: row.deck_id,
    slug: row.slug,
    name: row.deck_name,
    ownerUsername: row.owner_username,
    format: row.format,
    commanderName: row.commander_name,
    colorIdentity: row.color_identity,
    bracket: row.bracket,
    viewCount: row.view_count,
    copyCount: row.copy_count,
    publishedAt: Number(row.published_at),
  };
}

const LISTING_COLUMNS = `dp.user_id, dp.deck_id, dp.slug, dp.deck_name, u.username AS owner_username,
       dp.format, dp.commander_name, dp.commander_image_normal, dp.color_identity,
       dp.bracket, dp.card_count, dp.view_count, dp.copy_count, dp.published_at`;

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

discoverRouter.get('/decks', discoverReadLimiter, async (req: Request, res: Response) => {
  const filters = parseFilters(req.query);
  const pool = getPool();
  const whereParams = [filters.commander, filters.format, filters.brackets, filters.colors];
  const sortCol = SORT_COLUMNS[filters.sort];

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
    const decks = await hydratePublicationRows(pageRows.map(toListingRow));
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
  const hydrated = await hydratePublicationRows(rows.map(toListingRow));
  const inBand = BUDGET_BANDS[filters.budget];
  const filtered = hydrated.filter(
    (d) => d.estimatedValueUsd !== null && inBand(d.estimatedValueUsd)
  );
  const start = (filters.page - 1) * filters.pageSize;
  const decks = filtered.slice(start, start + filters.pageSize);
  const hasMore = start + filters.pageSize < filtered.length;
  return res.json({ decks, page: filters.page, hasMore });
});

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
