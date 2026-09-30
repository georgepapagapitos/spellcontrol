import { logger } from './logger';
import { getPool } from './db';
import { sweepStale as sweepStaleGameSessions } from './games/sessions';

const DAY_MS = 24 * 60 * 60 * 1000;

async function pruneCountTable(table: 'error_counts' | 'event_counts' | 'vital_counts') {
  // `day` is a DATE column; admin reads at most 365 days back (the `days`
  // cap in routes/admin.ts), so 400 leaves headroom past that read window.
  const { rowCount } = await getPool().query(`DELETE FROM ${table} WHERE day < CURRENT_DATE - 400`);
  return rowCount ?? 0;
}

/**
 * One row per retention rule: a label for the log line, and a prune that
 * deletes the expired rows and returns how many it removed.
 */
const RULES: ReadonlyArray<{ table: string; prune: () => Promise<number> }> = [
  {
    // ai_reviews is cache + quota ledger + per-deck review history
    // (routes/ai.ts) — the history is why this keeps a year rather than a
    // day; the daily quota meter only ever needs today's rows.
    table: 'ai_reviews',
    prune: async () => {
      const cutoff = Date.now() - 365 * DAY_MS;
      const { rowCount } = await getPool().query('DELETE FROM ai_reviews WHERE created_at < $1', [
        cutoff,
      ]);
      return rowCount ?? 0;
    },
  },
  { table: 'error_counts', prune: () => pruneCountTable('error_counts') },
  { table: 'event_counts', prune: () => pruneCountTable('event_counts') },
  { table: 'vital_counts', prune: () => pruneCountTable('vital_counts') },
  {
    // deck_feedback rows are denormalized off their share specifically so a
    // deck's feedback history survives token revocation (see the comment on
    // deck_feedback in db/index.ts) — its FK is ON DELETE CASCADE, so a
    // revoked share that still has feedback attached is left alone rather
    // than dragging that history out with it. Every other revoked share
    // (the common case — a plain binder/deck link) is fair game after 30d.
    table: 'shares',
    prune: async () => {
      const cutoff = Date.now() - 30 * DAY_MS;
      const { rowCount } = await getPool().query(
        `DELETE FROM shares
          WHERE revoked_at IS NOT NULL AND revoked_at < $1
            AND NOT EXISTS (SELECT 1 FROM deck_feedback WHERE deck_feedback.share_token = shares.token)`,
        [cutoff]
      );
      return rowCount ?? 0;
    },
  },
  {
    // game_sessions already gets an opportunistic 24h sweep inline on every
    // session create (routes/games.ts); this is the backstop for a session
    // created and then abandoned with no further create to trigger that.
    // Reuses sweepStale rather than duplicating its query + broadcast.
    table: 'game_sessions',
    prune: sweepStaleGameSessions,
  },
];

/** Runs every rule, each in its own try/catch so one failing table can't
 * stop the rest. Logs a line per table only when it actually pruned
 * something, plus a one-line summary. */
export async function runRetentionSweep(): Promise<void> {
  let totalPruned = 0;
  let failedTables = 0;
  for (const rule of RULES) {
    try {
      const n = await rule.prune();
      if (n > 0) {
        logger.info(`[retention] ${rule.table} pruned ${n}`);
        totalPruned += n;
      }
    } catch (err) {
      failedTables++;
      logger.error(`[retention] ${rule.table} prune failed:`, err);
    }
  }
  logger.info(
    `[retention] sweep done — ${totalPruned} row(s) pruned across ${RULES.length} table(s)` +
      (failedTables > 0 ? `, ${failedTables} table(s) failed` : '')
  );
}

/**
 * Daily sweep — mirrors scheduleComboIngest/scheduleAggregatesRollup in
 * server.ts: fire once shortly after boot, then every 24h. Gating on
 * RETENTION_DISABLED is the caller's job (server.ts), same as those.
 */
export function scheduleRetentionSweep(): void {
  const tick = () => {
    void runRetentionSweep().catch((err) => logger.error('[retention] sweep tick failed:', err));
  };
  tick();
  setInterval(tick, DAY_MS);
}
