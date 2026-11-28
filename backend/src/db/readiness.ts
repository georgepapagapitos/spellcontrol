import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

/**
 * Whether the boot has reached Postgres and applied the schema (E1120).
 *
 * The server listens BEFORE this is true. It used to await `ensureSchema()`
 * first, so a restart or deploy while Postgres was unreachable took the whole
 * site down when only signed-in features were failing: a refused connection
 * exited the process (`[server] failed to start`, then a restart loop), and a
 * host that accepted the connection and never answered left the process alive
 * and never listening, with nothing in the logs. Now `/health`, the web app
 * and every route that does not touch Postgres serve from the first second,
 * and the routes that do answer 503 through {@link requireDb} until the schema
 * is in. They open on their own once it is, with no restart.
 *
 * This is boot readiness only. It never goes back to false: a database that
 * drops out later shows up as failing queries (bounded by the pool's connect
 * timeout in `db/index.ts`) and as the uptime heartbeat's database probe, not
 * as a closed gate.
 */
let ready = false;
let resolveReady: () => void = () => {};
let readyPromise = new Promise<void>((resolve) => (resolveReady = resolve));

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

/** Seconds a client is told to wait before retrying a route the gate closed. */
export const DB_RETRY_AFTER_S = 5;
export const DB_UNAVAILABLE_ERROR =
  "The server can't reach its database right now. Try again in a moment.";

/**
 * Put in front of every route that needs Postgres. While the schema is not
 * ready it answers 503 with Retry-After and the app's error shape (the one
 * `unhandledErrorHandler` sends), instead of letting the request wait out a
 * connect timeout and fail with a 500.
 */
export function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (ready) return next();
  res.set('Retry-After', String(DB_RETRY_AFTER_S));
  res.status(503).json({
    error: DB_UNAVAILABLE_ERROR,
    requestId: (res.locals.requestId as string | undefined) ?? 'unknown',
  });
}

/**
 * The pool's `connectionTimeoutMillis` (db/index.ts): how long one connection
 * attempt may take, TCP through the startup handshake (`pg` clears the timer on
 * ReadyForQuery). Without it `pg` waits forever, so a host that accepts the
 * connection and never answers hung the boot with nothing logged. 10 s leaves
 * room for a Neon compute waking from suspend, which takes a few seconds.
 * `pg-pool` applies the same ceiling to a request waiting for a free pool slot,
 * so a saturated pool now errors after 10 s instead of queueing without end.
 * `PG_CONNECT_TIMEOUT_MS` overrides it.
 */
export const DB_CONNECT_TIMEOUT_MS = Number(process.env.PG_CONNECT_TIMEOUT_MS) || 10_000;

/** First retry 1 s after a failed attempt, doubling to a 30 s ceiling. */
export const SCHEMA_RETRY_BASE_MS = 1_000;
export const SCHEMA_RETRY_MAX_MS = 30_000;

export interface PrepareOptions {
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * Runs `prepare` (the schema and the boot backfills) until it succeeds, then
 * opens the gate. Each attempt is bounded by the pool's connect timeout, and
 * the wait between attempts backs off to {@link SCHEMA_RETRY_MAX_MS}.
 *
 * It does not give up. Giving up would leave a process that serves the web app
 * with every database route closed until someone restarts it by hand, which is
 * the outcome this exists to remove (Fly never restarts a machine for a failing
 * check). A schema statement that fails every time therefore logs an error
 * every 30 s and keeps database routes at 503 rather than crash-looping the
 * whole site; the log line is the alarm, along with the heartbeat's probe.
 */
export async function prepareDatabase(
  prepare: () => Promise<void>,
  {
    baseMs = SCHEMA_RETRY_BASE_MS,
    maxMs = SCHEMA_RETRY_MAX_MS,
    sleep = realSleep,
  }: PrepareOptions = {}
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      await prepare();
      ready = true;
      resolveReady();
      logger.info(`[db] schema ready after ${attempt} attempt(s), database routes open`);
      return attempt;
    } catch (err) {
      const waitMs = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      logger.error(
        `[db] schema not ready (attempt ${attempt}), retrying in ${waitMs}ms. Database routes answer 503 until then:`,
        err
      );
      await sleep(waitMs);
    }
  }
}
