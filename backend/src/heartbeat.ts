import { logger } from './logger';

/**
 * Prod uptime heartbeat for a passive monitor (healthchecks.io): alerts fire
 * when the pings STOP, so a dead machine needs no code path at all.
 *
 * What it must not be is a naive "I'm alive" ping. On 2026-08-17 this process
 * was alive and looping while the Fly proxy served 503 for hours — an
 * in-process heartbeat would have stayed green the whole time. So every tick
 * probes the PUBLIC origin the way a user would, and reports what it saw:
 * pass → GET the ping URL; fail → GET <ping>/fail, which alerts immediately
 * instead of waiting out the grace period.
 *
 * A second failure condition rides the same channel: a burst of client
 * errors. The first-party beacon counts uncaught exceptions per (message,
 * frame) — see routes/events.ts — and when more than `errorBurst.threshold`
 * of them land inside `errorBurst.minutes`, the tick reports a failure with
 * the count in the body, so a broken deploy that still answers /health
 * (the SPA shell is static; a crashing bundle never touches it) pages the
 * same way an outage does.
 *
 * A third: the database. See `DbProbe`.
 *
 * `uptime.yml` is the GitHub-cron backstop this replaces — its 5-minute
 * schedule measured ~8 firings a day with multi-hour gaps.
 */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export interface ErrorBurstCheck {
  /** Client errors counted in the last `minutes` (routes/events.ts recentErrorCount). */
  count: (minutes: number) => Promise<number>;
  minutes: number;
  threshold: number;
}

/**
 * `/health` never touches Postgres on purpose (Fly's check must not depend on
 * it: 2026-08-17), so a database outage would ping green. This probe is the
 * heartbeat's own: one cheap query, a 5 s ceiling, retried once so a single
 * slow query does not page.
 */
export type DbProbe = () => Promise<unknown>;
export const DB_PROBE_TIMEOUT_MS = 5_000;

async function dbDown(probe: DbProbe): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('db probe timed out')), DB_PROBE_TIMEOUT_MS);
        }),
      ]);
      return false;
    } catch {
      // retry once
    } finally {
      clearTimeout(timer);
    }
  }
  return true;
}

/**
 * A fourth: the boot's schema step (db/readiness.ts, E1120). The server
 * listens before the schema is in and answers 503 on every database route
 * until it is, so a release whose schema statement fails every time serves a
 * 200 `/health` against a database that answers `SELECT 1`: green on every
 * check above while every signed-in feature is down. Reported once the boot is
 * older than SCHEMA_READY_GRACE_MS. Five minutes is far past a healthy boot
 * (seconds, a Neon wake included) and past the deploy workflow's 3-minute
 * wait; the first tick lands 90 s after boot, so the earliest page is the
 * tick at about 6.5 minutes.
 */
export interface SchemaCheck {
  isReady: () => boolean;
  bootAt: number;
}
export const SCHEMA_READY_GRACE_MS = 5 * 60_000;

export async function probeAndPing(
  pingUrl: string,
  origin: string,
  errorBurst?: ErrorBurstCheck,
  dbProbe?: DbProbe,
  schema?: SchemaCheck,
  now = Date.now()
): Promise<boolean> {
  const ok = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(20_000) })
    .then(async (res) => res.ok && ((await res.json()) as { ok?: unknown }).ok === true)
    .catch(() => false);
  let failure = ok ? '' : `${origin}/health did not answer ok`;
  if (ok && schema && !schema.isReady() && now - schema.bootAt > SCHEMA_READY_GRACE_MS) {
    const min = Math.floor((now - schema.bootAt) / 60_000);
    failure = `database schema not ready ${min} min after boot (signed-in routes answer 503)`;
  }
  if (ok && !failure && dbProbe && (await dbDown(dbProbe))) {
    failure = 'database probe failed (SELECT 1 did not answer)';
  }
  if (ok && !failure && errorBurst) {
    const n = await errorBurst.count(errorBurst.minutes).catch(() => 0);
    if (n > errorBurst.threshold) {
      failure = `${n} client errors in the last ${errorBurst.minutes} min (threshold ${errorBurst.threshold})`;
    }
  }
  if (failure) logger.error(`[heartbeat] ${failure} — reporting failure`);
  try {
    await fetch(failure ? `${pingUrl}/fail` : pingUrl, {
      method: 'POST',
      body: failure,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error('[heartbeat] ping delivery failed:', err);
  }
  return !failure;
}

export function scheduleHeartbeat(
  pingUrl: string,
  origin: string,
  errorBurst?: ErrorBurstCheck,
  dbProbe?: DbProbe,
  schema?: SchemaCheck
): void {
  const tick = () => void probeAndPing(pingUrl, origin, errorBurst, dbProbe, schema);
  tick();
  setInterval(tick, HEARTBEAT_INTERVAL_MS).unref();
}
