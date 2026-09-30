import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { listFriendIds } from '../friends/relations';
import { computeStreak } from '../daily/streak';
import { testAwareLimiter } from '../route-utils';

/**
 * The daily card puzzle's results. One row per user per UTC day, first result
 * wins. The same POST records today's result and merges a guest's local
 * history on sign-in.
 */
export const dailyRouter: Router = Router();

const writeLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });
const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

const MAX_RESULTS = 400;
const MAX_GUESSES = 6;
const EARLIEST_DATE = '2026-01-01';
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Latest date accepted: tomorrow in UTC, for clock skew. */
function latestDate(): string {
  return new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
}

interface Entry {
  date: string;
  solved: boolean;
  guesses: number;
}

function parseEntries(body: unknown): Entry[] | string {
  const raw = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_RESULTS) {
    return `Send between 1 and ${MAX_RESULTS} results.`;
  }
  const latest = latestDate();
  const out: Entry[] = [];
  for (const item of raw) {
    const e = (item ?? {}) as { date?: unknown; solved?: unknown; guesses?: unknown };
    if (!isRealDate(e.date)) return 'Each result needs a valid date.';
    if (e.date > latest) return 'A result cannot be dated in the future.';
    if (e.date < EARLIEST_DATE) return 'A result date is too early.';
    if (typeof e.solved !== 'boolean') return 'Each result needs solved as true or false.';
    const g = e.guesses;
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 1 || g > MAX_GUESSES) {
      return `Guesses must be a whole number from 1 to ${MAX_GUESSES}.`;
    }
    if (!e.solved && g !== MAX_GUESSES) {
      return `An unsolved puzzle counts ${MAX_GUESSES} guesses.`;
    }
    out.push({ date: e.date, solved: e.solved, guesses: g });
  }
  return out;
}

dailyRouter.post('/results', requireAuth, writeLimiter, async (req: Request, res: Response) => {
  const entries = parseEntries(req.body);
  if (typeof entries === 'string') return res.status(400).json({ error: entries });
  // The first row for a date wins, including a duplicate date inside one batch.
  const result = await getPool().query(
    `INSERT INTO daily_results (user_id, puzzle_date, solved, guesses, created_at)
     SELECT $1, d, s, g, $5::bigint
       FROM unnest($2::text[], $3::boolean[], $4::int[]) AS t(d, s, g)
     ON CONFLICT (user_id, puzzle_date) DO NOTHING`,
    [
      req.user!.id,
      entries.map((e) => e.date),
      entries.map((e) => e.solved),
      entries.map((e) => e.guesses),
      Date.now(),
    ]
  );
  res.json({ saved: result.rowCount ?? 0 });
});

dailyRouter.get('/me', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const { rows } = await getPool().query<{
    puzzle_date: string;
    solved: boolean;
    guesses: number;
  }>(
    `SELECT puzzle_date, solved, guesses FROM daily_results
      WHERE user_id = $1 ORDER BY puzzle_date DESC LIMIT $2`,
    [req.user!.id, MAX_RESULTS]
  );
  res.json({
    results: rows.map((r) => ({ date: r.puzzle_date, solved: r.solved, guesses: r.guesses })),
  });
});

dailyRouter.get('/friends', requireAuth, readLimiter, async (req: Request, res: Response) => {
  const date = req.query.date;
  if (!isRealDate(date)) return res.status(400).json({ error: 'A valid date is required.' });
  const ids = await listFriendIds(req.user!.id);
  if (ids.length === 0) return res.json({ friends: [] });
  const pool = getPool();
  const [users, days] = await Promise.all([
    pool.query<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_image_url: string | null;
    }>(`SELECT id, username, display_name, avatar_image_url FROM users WHERE id = ANY($1)`, [ids]),
    pool.query<{ user_id: string; puzzle_date: string; solved: boolean; guesses: number }>(
      `SELECT user_id, puzzle_date, solved, guesses FROM daily_results
        WHERE user_id = ANY($1) AND puzzle_date <= $2
          AND puzzle_date > to_char($2::date - $3::int, 'YYYY-MM-DD')`,
      [ids, date, MAX_RESULTS]
    ),
  ]);
  const byUser = new Map<string, typeof days.rows>();
  for (const r of days.rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const friends = users.rows.map((u) => {
    const rows = byUser.get(u.id) ?? [];
    const today = rows.find((r) => r.puzzle_date === date);
    return {
      userId: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarImageUrl: u.avatar_image_url,
      result: today ? { solved: today.solved, guesses: today.guesses } : null,
      streak: computeStreak(
        rows.map((r) => ({ date: r.puzzle_date, solved: r.solved })),
        date
      ),
    };
  });
  friends.sort((a, b) => {
    if (!a.result !== !b.result) return a.result ? -1 : 1;
    if (a.result && b.result) {
      if (a.result.solved !== b.result.solved) return a.result.solved ? -1 : 1;
      if (a.result.guesses !== b.result.guesses) return a.result.guesses - b.result.guesses;
    }
    return a.username < b.username ? -1 : a.username > b.username ? 1 : 0;
  });
  res.json({ friends });
});
