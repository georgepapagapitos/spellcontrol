import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../logger';

/**
 * Whether the boot has applied the schema (E1120).
 *
 * The server listens BEFORE this is true. It used to await `ensureSchema()`
 * first, so a restart or deploy while Postgres was unreachable took the whole
 * site down when only signed-in features were failing: a refused connection
 * exited the process (`[server] failed to start`, then a restart loop), and a
 * host that accepted the connection and never answered left the process alive
 * and never listening, with nothing in the logs. Now `/health`, the web app
 * and every route that does not touch Postgres serve from the first second,
 * and the routes that do answer 503 through {@link dbGate} until the schema is
 * in. They open on their own once it is, with no restart.
 *
 * This is boot readiness only. It never goes back to false: a database that
 * drops out later shows up as failing queries (bounded by the pool's connect
 * timeout, db/pool-config.ts) and as the uptime heartbeat's database probe, not
 * as a closed gate.
 */
let ready = false;
let resolveReady: () => void = () => {};
let readyPromise = new Promise<void>((resolve) => (resolveReady = resolve));

function markReady(): void {
  ready = true;
  resolveReady();
}

export function isDbReady(): boolean {
  return ready;
}

/** Resolves once the schema is in. Background jobs that need Postgres wait on it. */
export function whenDbReady(): Promise<void> {
  return readyPromise;
}

/** Test-only: back to "not ready". */
export function resetDbReadinessForTesting(): void {
  ready = false;
  readyPromise = new Promise<void>((resolve) => (resolveReady = resolve));
}

/** Test-only: a test's own database is ready by construction (test-helpers.ts). */
export function markDbReadyForTesting(): void {
  markReady();
}

/** Seconds a client is told to wait before retrying a route the gate closed. */
export const DB_RETRY_AFTER_S = 5;
/** True whether the database is unreachable or reachable with a failing schema statement. */
export const DB_UNAVAILABLE_ERROR = 'Saved data is unavailable right now. Try again in a moment.';

/**
 * What a browser NAVIGATION to a closed route gets instead of raw JSON: an OAuth
 * callback or an emailed `/api/auth/...` link opened in the window. It retries
 * the same URL on the same cadence as Retry-After, and points at the app, which
 * works signed out meanwhile. No dynamic content, so nothing to escape.
 */
export const NOT_READY_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${DB_RETRY_AFTER_S}">
<title>Not available yet · SpellControl</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
</head>
<body>
<h1>Not available yet</h1>
<p>SpellControl can't load saved data right now. This page tries again every ${DB_RETRY_AFTER_S} seconds.</p>
<p><a href="/">Open SpellControl</a></p>
</body>
</html>
`;

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export interface DbGateOptions {
  /** Paths under the mount that need no Postgres and pass while closed. */
  except?: string[];
  /** Gate only these paths under the mount; everything else passes. */
  only?: string[];
  /** Extra headers on the 503, for a client that reads its own signal. */
  headers?: Record<string, string>;
}

/**
 * Put in front of every router that needs Postgres (server.ts; the structural
 * guard is server-db-gate.test.ts). While the schema is not ready it answers
 * 503 with Retry-After: the app's JSON error shape (the one
 * `unhandledErrorHandler` sends) to API clients, {@link NOT_READY_PAGE} to a
 * browser navigation. Without it the request would wait out a connect timeout
 * and fail with a 500, or hit a table that does not exist yet.
 */
export function dbGate({ except = [], only, headers }: DbGateOptions = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (ready) return next();
    if (except.some((p) => under(req.path, p))) return next();
    if (only && !only.some((p) => under(req.path, p))) return next();
    if (headers) res.set(headers);
    res.set('Retry-After', String(DB_RETRY_AFTER_S));
    const navigation =
      (req.method === 'GET' || req.method === 'HEAD') && req.accepts(['json', 'html']) === 'html';
    if (navigation) {
      res.status(503).type('html').send(NOT_READY_PAGE);
      return;
    }
    res.status(503).json({
      error: DB_UNAVAILABLE_ERROR,
      requestId: (res.locals.requestId as string | undefined) ?? 'unknown',
    });
  };
}

export const requireDb: RequestHandler = dbGate();

/** First retry 1 s after a failed attempt, doubling to a 30 s ceiling. */
export const SCHEMA_RETRY_BASE_MS = 1_000;
export const SCHEMA_RETRY_MAX_MS = 30_000;

export interface RetryOptions {
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * Runs `step` until it resolves, waiting `baseMs` after the first failure and
 * doubling to `maxMs`. Never gives up: every boot step here is idempotent, and
 * a step that stops retrying stays undone until someone restarts the machine
 * by hand (Fly never restarts it for us). A failure that repeats logs an error
 * on every attempt; that line is the alarm.
 */
export async function retryWithBackoff(
  label: string,
  step: () => Promise<unknown>,
  {
    baseMs = SCHEMA_RETRY_BASE_MS,
    maxMs = SCHEMA_RETRY_MAX_MS,
    sleep = realSleep,
  }: RetryOptions = {}
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      await step();
      return attempt;
    } catch (err) {
      const waitMs = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      logger.error(`${label} (attempt ${attempt}), retrying in ${waitMs}ms:`, err);
      await sleep(waitMs);
    }
  }
}

/**
 * Applies the schema with {@link retryWithBackoff}, then opens the gate. Only
 * the schema gates: the boot backfills and admin promotion run after it with
 * their own retry (server.ts), so a lasting failure in one of them cannot hold
 * every signed-in route at 503. A schema statement that fails every time keeps
 * the gate closed and logs every attempt; the heartbeat reports it after its
 * grace period (heartbeat.ts) and the deploy workflow fails on it.
 */
export async function prepareDatabase(
  ensureSchema: () => Promise<void>,
  opts: RetryOptions = {}
): Promise<number> {
  // Logs `[db] schema not ready (attempt n), retrying in <ms>ms: <error>`.
  const attempts = await retryWithBackoff('[db] schema not ready', ensureSchema, opts);
  markReady();
  logger.info(`[db] schema ready after ${attempts} attempt(s), database routes open`);
  return attempts;
}
