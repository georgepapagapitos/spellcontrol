import { Router, type Request, type Response } from 'express';
import { getPool } from '../db';
import { logger } from '../logger';
import { testAwareLimiter } from '../route-utils';

/**
 * First-party, cookieless beacon. Three shapes, one contract: every row the
 * server keeps is an aggregate count keyed by a day and a few low-cardinality
 * strings — never an IP, user agent, user id, or session — so none of it can
 * identify anyone and none of it needs a consent banner. Always 204: a beacon
 * is zero-information to its caller (mirrors the public view beacon).
 *
 *  - `{ name: <usage event>, path }`         → event_counts(day, name, path)
 *  - `{ name: 'error', path, kind, message, frame }`
 *                                             → error_counts(day, path, kind, message, frame)
 *  - `{ name: 'vital', path, metric, value }` → vital_counts(day, path, metric, rating)
 *
 * The error row holds the exception's own message and the script location it
 * came from (an `/assets/<chunk>.js:line:col` frame), both scrubbed and
 * length-capped here regardless of what the client sent. A vital's raw
 * millisecond value is never stored — only which Core Web Vitals band it
 * landed in, which is all the admin view needs to say "p75 is good" (a metric
 * is good at p75 when at least three quarters of its samples are good).
 */
export const eventsRouter: Router = Router();

/**
 * Every usage event the client may send. A name that is not in here is
 * dropped silently by the handler below, so this set has to hold the whole of
 * the frontend's `EventName` union — `lib/analytics-parity.test.ts` fails when
 * the two drift.
 *
 * The four past-the-landing events were added to the client by #1911 and to
 * this set by nobody, so `play_started`, `register_completed`, `deck_created`
 * and `binder_created` beaconed into a 204 from the day they shipped: the
 * funnel that PR exists to measure recorded no rows at all. `play_started` is
 * the sharpest loss — a local game needs no account and writes nothing else
 * server-side, so anonymous play was exactly what it was added to make
 * visible.
 */
export const EVENT_NAMES = new Set([
  'pageview',
  'import_started',
  'sample_loaded',
  'browse_decks',
  'sign_in',
  'guide_cta',
  'play_started',
  'register_completed',
  'deck_created',
  'binder_created',
  'skipped_welcome',
]);

export const ERROR_KINDS = new Set(['error', 'rejection', 'render']);

/** Core Web Vitals bands (web.dev thresholds): [good ≤, needs-improvement ≤]. */
export const VITAL_BANDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
};

export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export function rateVital(metric: string, value: number): VitalRating | null {
  const band = VITAL_BANDS[metric];
  if (!band || !Number.isFinite(value) || value < 0) return null;
  return value <= band[0] ? 'good' : value <= band[1] ? 'needs-improvement' : 'poor';
}

export const ERROR_MESSAGE_MAX = 200;
export const ERROR_FRAME_MAX = 160;
/** Distinct error rows a single day may hold; the rest fold into one overflow row. */
export const ERROR_ROWS_PER_DAY = 500;

/**
 * Strip anything in free text that could carry identity: emails, URL query
 * strings and fragments, long digit runs (ids, phone numbers), and the
 * `token=`-style pairs an exception message can echo from a failed request.
 */
export function scrubText(text: string, max: number): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/([?#])[^\s"')]*/g, '$1…')
    .replace(/\b\d{7,}\b/g, '[n]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const beaconLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

eventsRouter.post('/', beaconLimiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = str(body.name, 40);
  const path = str(body.path, 200);
  if (!path.startsWith('/')) {
    res.status(204).end();
    return;
  }
  try {
    if (EVENT_NAMES.has(name)) await countEvent(name, path);
    else if (name === 'error') await countError(path, body);
    else if (name === 'vital') await countVital(path, body);
  } catch (err) {
    logger.warn('[events] beacon insert failed', err);
  }
  res.status(204).end();
});

async function countEvent(name: string, path: string): Promise<void> {
  await getPool().query(
    `INSERT INTO event_counts (day, name, path, count)
       VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (day, name, path) DO UPDATE SET count = event_counts.count + 1`,
    [name, path]
  );
}

async function countError(path: string, body: Record<string, unknown>): Promise<void> {
  const kind = str(body.kind, 20);
  if (!ERROR_KINDS.has(kind)) return;
  let message = scrubText(str(body.message, 1000), ERROR_MESSAGE_MAX) || '[no message]';
  let frame = scrubText(str(body.frame, 1000), ERROR_FRAME_MAX);
  const pool = getPool();
  const existing = await pool.query(
    `SELECT 1 FROM error_counts
      WHERE day = CURRENT_DATE AND path = $1 AND kind = $2 AND message = $3 AND frame = $4`,
    [path, kind, message, frame]
  );
  if (existing.rowCount === 0) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM error_counts WHERE day = CURRENT_DATE`
    );
    if (Number(rows[0]?.n ?? 0) >= ERROR_ROWS_PER_DAY) {
      message = '[overflow] distinct error cap reached for the day';
      frame = '';
    }
  }
  await pool.query(
    `INSERT INTO error_counts (day, path, kind, message, frame, count, last_seen)
       VALUES (CURRENT_DATE, $1, $2, $3, $4, 1, now())
       ON CONFLICT (day, path, kind, message, frame)
       DO UPDATE SET count = error_counts.count + 1, last_seen = now()`,
    [path, kind, message, frame]
  );
}

async function countVital(path: string, body: Record<string, unknown>): Promise<void> {
  const metric = str(body.metric, 10);
  const rating = rateVital(metric, Number(body.value));
  if (!rating) return;
  await getPool().query(
    `INSERT INTO vital_counts (day, path, metric, rating, count)
       VALUES (CURRENT_DATE, $1, $2, $3, 1)
       ON CONFLICT (day, path, metric, rating) DO UPDATE SET count = vital_counts.count + 1`,
    [path, metric, rating]
  );
}

/**
 * Client errors counted in the last `minutes` — the heartbeat's burst check
 * (see heartbeat.ts). Sums `count`, so one error looping in one tab counts
 * every time it fires, which is what a burst alert should see.
 */
export async function recentErrorCount(minutes: number): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT COALESCE(SUM(count), 0)::text AS n FROM error_counts
      WHERE last_seen > now() - ($1::int * interval '1 minute')`,
    [minutes]
  );
  return Number(rows[0]?.n ?? 0);
}
