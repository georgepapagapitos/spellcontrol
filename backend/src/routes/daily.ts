import { Router, type Request, type Response } from 'express';
import { optionalAuth, requireAuth } from '../auth';
import { getPool } from '../db';
import { listFriendIds } from '../friends/relations';
import { blurredArt, BLUR_SIGMA } from '../daily/art';
import {
  addGuess,
  buildResponse,
  MAX_GUESSES,
  PlayError,
  statusOf,
  type PlayState,
} from '../daily/play';
import { getPuzzle, todayUtc } from '../daily/puzzle';
import { computeStreak } from '../daily/streak';
import { testAwareLimiter } from '../route-utils';

/**
 * The daily card puzzle. The server picks each day's answer, scores guesses and
 * serves the art blurred, so the answer only leaves once the player finishes.
 * Results are one row per user per UTC day, first result wins; a signed-in
 * player's plays are recorded as they happen, and POST /results only merges a
 * guest's past days on sign-in.
 */
export const dailyRouter: Router = Router();

const writeLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });
const readLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
const playLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
const artLimiter = testAwareLimiter({ windowMs: 60_000, max: 120 });

const MAX_RESULTS = 400;
const EARLIEST_DATE = '2026-01-01';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
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
  const today = todayUtc();
  const out: Entry[] = [];
  for (const item of raw) {
    const e = (item ?? {}) as { date?: unknown; solved?: unknown; guesses?: unknown };
    if (!isRealDate(e.date)) return 'Each result needs a valid date.';
    if (e.date >= today) return "Today's result is recorded as you play.";
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

interface ProgressRow {
  guesses: string[];
  gave_up: boolean;
}

function playError(res: Response, err: unknown): Response {
  if (err instanceof PlayError) return res.status(400).json({ error: err.message });
  throw err;
}

dailyRouter.post('/play', optionalAuth, playLimiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { guesses?: unknown; guess?: unknown; giveUp?: unknown };
  const hasGuess = body.guess !== undefined && body.guess !== null;
  const giveUp = body.giveUp === true;
  const puzzle = await getPuzzle(todayUtc());

  if (!req.user) {
    // A guest's state lives in the browser and is replayed from body.guesses;
    // nothing is stored.
    try {
      const list = body.guesses ?? [];
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: 'Send guesses as a list of card names.' });
      }
      if (list.length > MAX_GUESSES) {
        return res.status(400).json({ error: "That's more than six guesses." });
      }
      let state: PlayState = { guesses: [], gaveUp: false };
      for (const g of list) state = addGuess(state, g, puzzle.name);
      if (hasGuess) state = addGuess(state, body.guess, puzzle.name);
      if (giveUp) state = { ...state, gaveUp: true };
      return res.json(buildResponse(puzzle, state));
    } catch (err) {
      return playError(res, err);
    }
  }

  // Signed in: the stored row is the state and body.guesses is ignored.
  const userId = req.user.id;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const now = Date.now();
    await client.query(
      `INSERT INTO daily_progress (user_id, puzzle_date, guesses, gave_up, updated_at)
       VALUES ($1, $2, '[]'::jsonb, false, $3)
       ON CONFLICT (user_id, puzzle_date) DO NOTHING`,
      [userId, puzzle.date, now]
    );
    const { rows } = await client.query<ProgressRow>(
      `SELECT guesses, gave_up FROM daily_progress
        WHERE user_id = $1 AND puzzle_date = $2 FOR UPDATE`,
      [userId, puzzle.date]
    );
    let state: PlayState = { guesses: rows[0]!.guesses, gaveUp: rows[0]!.gave_up };
    if (hasGuess || giveUp) {
      if (hasGuess) state = addGuess(state, body.guess, puzzle.name);
      if (giveUp) state = { ...state, gaveUp: true };
      await client.query(
        `UPDATE daily_progress SET guesses = $3::jsonb, gave_up = $4, updated_at = $5
          WHERE user_id = $1 AND puzzle_date = $2`,
        [userId, puzzle.date, JSON.stringify(state.guesses), state.gaveUp, now]
      );
      const status = statusOf(state, puzzle.name);
      if (status !== 'playing') {
        await client.query(
          `INSERT INTO daily_results (user_id, puzzle_date, solved, guesses, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, puzzle_date) DO NOTHING`,
          [
            userId,
            puzzle.date,
            status === 'solved',
            status === 'solved' ? state.guesses.length : MAX_GUESSES,
            now,
          ]
        );
      }
    }
    await client.query('COMMIT');
    return res.json(buildResponse(puzzle, state));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return playError(res, err);
  } finally {
    client.release();
  }
});

dailyRouter.get('/art', optionalAuth, artLimiter, async (req: Request, res: Response) => {
  const date = todayUtc();
  if (req.query.date !== date) return res.status(404).json({ error: 'No art for that day.' });
  const raw = req.query.level;
  const requested = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(requested) || requested >= BLUR_SIGMA.length) {
    return res.status(400).json({ error: 'Level must be a whole number from 0 to 5.' });
  }
  const puzzle = await getPuzzle(date);
  let level = requested;
  if (req.user) {
    const { rows } = await getPool().query<ProgressRow>(
      `SELECT guesses, gave_up FROM daily_progress WHERE user_id = $1 AND puzzle_date = $2`,
      [req.user.id, date]
    );
    const state: PlayState = {
      guesses: rows[0]?.guesses ?? [],
      gaveUp: rows[0]?.gave_up ?? false,
    };
    // While the puzzle is open, the art can't be clearer than the misses allow.
    if (statusOf(state, puzzle.name) === 'playing') level = Math.min(level, state.guesses.length);
  }
  try {
    const jpeg = await blurredArt(date, puzzle.payload.art, level);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(jpeg);
  } catch {
    return res.status(502).json({ error: "Couldn't load today's art." });
  }
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
