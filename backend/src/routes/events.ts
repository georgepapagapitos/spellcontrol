import { Router, type Request, type Response } from 'express';
import { getPool } from '../db';
import { logger } from '../logger';
import { testAwareLimiter } from '../route-utils';
import { countSuggestion, parseSuggestion } from './suggestion-labels';

/**
 * First-party, cookieless beacon. Four shapes, one contract: every row the
 * server keeps is an aggregate count keyed by a day and a few low-cardinality
 * strings — never an IP, user agent, user id, or session — so none of it can
 * identify anyone and none of it needs a consent banner. Always 204: a beacon
 * is zero-information to its caller (mirrors the public view beacon).
 *
 *  - `{ name: <usage event>, path }`         → event_counts(day, name, path)
 *  - `{ name: 'error', path, kind, message, frame }`
 *                                             → error_counts(day, path, kind, message, frame)
 *  - `{ name: 'vital', path, metric, value }` → vital_counts(day, path, metric, rating)
 *  - `{ name: 'suggestion', surface, action, ... }` → suggestion_counts (suggestion-labels.ts):
 *    which suggestion a player accepted, dismissed or undid, for which commander. Same
 *    contract: no user, deck or session id, and an event with an unknown field is dropped.
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
  'deck_power_viewed',
  'deck_coach_viewed',
  'deck_stats_viewed',
  'test_hand_opened',
  'walkthrough_finished',
  'import_completed',
  'post_import_shown',
  'post_import_tapped',
]);

/**
 * `reload` is a tab opened before a deploy that asked for a chunk the new build
 * replaced and reloaded itself onto the new build (frontend
 * lib/util/chunk-reload.ts). Stored so the admin view can say how often a deploy
 * strands a tab, but it is not a defect: the burst alert leaves it out.
 */
export const ERROR_KINDS = new Set(['error', 'rejection', 'render', 'reload']);

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
    .replace(/[\w.+-]{1,64}@[\w-]{1,255}\.[\w.-]{1,255}/g, '[email]')
    .replace(/([?#])[^\s"')]*/g, '$1…')
    .replace(/\b\d{7,}\b/g, '[n]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Distinct (name, path) / (path, metric, rating) rows a single day may hold in event_counts and vital_counts. */
export const COUNT_ROWS_PER_DAY = 500;
const OVERFLOW_PATH = '[overflow]';
/** A route-shaped path: URL path characters only, so a beacon cannot smuggle free text into a row. */
const PATH_SHAPE = /^\/[A-Za-z0-9/_\-.~%@:+=,*]*$/;

const beaconLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

eventsRouter.post('/', beaconLimiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = str(body.name, 40);
  const path = str(body.path, 200);
  if (!path.startsWith('/') || !PATH_SHAPE.test(path)) {
    res.status(204).end();
    return;
  }
  try {
    if (EVENT_NAMES.has(name)) await countEvent(name, path);
    else if (name === 'error') await countError(path, body, req.ip ?? '');
    else if (name === 'vital') await countVital(path, body);
    else if (name === 'suggestion') {
      const label = parseSuggestion(body);
      if (label) await countSuggestion(label);
    }
  } catch (err) {
    logger.warn('[events] beacon insert failed', err);
  }
  res.status(204).end();
});

async function countEvent(name: string, path: string): Promise<void> {
  const pool = getPool();
  const existing = await pool.query(
    `SELECT 1 FROM event_counts WHERE day = CURRENT_DATE AND name = $1 AND path = $2`,
    [name, path]
  );
  if (existing.rowCount === 0) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM event_counts WHERE day = CURRENT_DATE`
    );
    if (Number(rows[0]?.n ?? 0) >= COUNT_ROWS_PER_DAY) path = OVERFLOW_PATH;
  }
  await pool.query(
    `INSERT INTO event_counts (day, name, path, count)
       VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (day, name, path) DO UPDATE SET count = event_counts.count + 1`,
    [name, path]
  );
}

async function countError(path: string, body: Record<string, unknown>, ip: string): Promise<void> {
  const kind = str(body.kind, 20);
  if (!ERROR_KINDS.has(kind)) return;
  if (kind !== 'reload') noteErrorHit(ip);
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
  const pool = getPool();
  const existing = await pool.query(
    `SELECT 1 FROM vital_counts WHERE day = CURRENT_DATE AND path = $1 AND metric = $2 AND rating = $3`,
    [path, metric, rating]
  );
  if (existing.rowCount === 0) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM vital_counts WHERE day = CURRENT_DATE`
    );
    if (Number(rows[0]?.n ?? 0) >= COUNT_ROWS_PER_DAY) path = OVERFLOW_PATH;
  }
  await pool.query(
    `INSERT INTO vital_counts (day, path, metric, rating, count)
       VALUES (CURRENT_DATE, $1, $2, $3, 1)
       ON CONFLICT (day, path, metric, rating) DO UPDATE SET count = vital_counts.count + 1`,
    [path, metric, rating]
  );
}

/**
 * Burst-alert window state. The error_counts `count` is cumulative for the
 * whole day, so summing it over "rows touched in the window" credits a day's
 * history to one new hit; and the beacon is unauthenticated, so one caller can
 * send identical beacons and page the owner. The alert therefore reads hits
 * seen by this process, each caller (IP) contributing at most
 * ERROR_HITS_PER_IP_CAP per window: a real regression reaches enough distinct
 * callers to pass the threshold, one noisy or hostile caller cannot. The cap
 * is per caller across every message, so one IP cannot buy weight with
 * varied text either. With the default threshold of 25 a cap of 9 means three
 * clients that each loop on an error page (27), two do not (18), and a lone
 * caller never gets past 9 however many beacons it sends. (The old cap of 5
 * needed six distinct callers, which a user base of about seven almost never
 * supplies.) Hits live
 * in memory only (never stored with an IP, per the beacon contract), so a
 * restart starts the window empty, which also keeps a deploy quiet.
 */
export const ERROR_BURST_DEFAULT_THRESHOLD = 25;
export const ERROR_HITS_PER_IP_CAP = 9;
const ERROR_HIT_IPS_MAX = 5000;
const errorHits = new Map<string, number[]>();

export function noteErrorHit(ip: string, now = Date.now()): void {
  let hits = errorHits.get(ip);
  if (!hits) {
    if (errorHits.size >= ERROR_HIT_IPS_MAX) {
      const oldest = errorHits.keys().next().value;
      if (oldest !== undefined) errorHits.delete(oldest);
    }
    hits = [];
    errorHits.set(ip, hits);
  }
  hits.push(now);
  // Keep the newest few: older ones can only matter inside a window the cap already fills.
  if (hits.length > ERROR_HITS_PER_IP_CAP) hits.splice(0, hits.length - ERROR_HITS_PER_IP_CAP);
}

/** Test seam: forget every recorded hit. */
export function resetErrorHits(): void {
  errorHits.clear();
}

/**
 * Client errors seen in the last `minutes`, for the heartbeat's burst check
 * (see heartbeat.ts): the sum over callers of min(hits in window, cap). A
 * `reload` is never recorded: every deploy produces a wave of them from tabs
 * that were open, and each one already recovered.
 */
export async function recentErrorCount(minutes: number, now = Date.now()): Promise<number> {
  const since = now - minutes * 60_000;
  let total = 0;
  for (const [ip, hits] of errorHits) {
    const live = hits.filter((t) => t > since);
    if (live.length === 0) errorHits.delete(ip);
    else total += Math.min(live.length, ERROR_HITS_PER_IP_CAP);
  }
  return total;
}
