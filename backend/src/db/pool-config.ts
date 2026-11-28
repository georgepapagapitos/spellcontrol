/**
 * Settings for the pg Pool in `db/index.ts`, kept here because that file is at
 * its line ceiling (file-size-ratchet.test.ts).
 *
 * `DB_CONNECT_TIMEOUT_MS` is the Pool's `connectionTimeoutMillis`. It bounds
 * two different waits:
 *
 * - One connection attempt, TCP through the startup handshake (`pg` clears the
 *   timer on ReadyForQuery). Without it `pg` waits forever, so a host that
 *   accepts the connection and never answers hung the boot with nothing logged
 *   (E1120). 10 s leaves room for a Neon compute waking from suspend, which
 *   takes a few seconds.
 * - A request waiting for a free slot when all `DB_POOL_MAX` connections are
 *   checked out (pg-pool applies the same option there). Before this a request
 *   queued until a slot freed; now it fails after 10 s. That matters while a
 *   long transaction holds a lock other requests block on: the combo ingest's
 *   TRUNCATE is held while it streams the Spellbook feed (combos/ingest.ts), so
 *   readers of `combos` pile up holding slots, and once all ten are taken an
 *   unrelated request fails at 10 s instead of waiting for the commit.
 *
 * `PG_CONNECT_TIMEOUT_MS` overrides the timeout (the boot test uses 3 s).
 */
export const DB_CONNECT_TIMEOUT_MS = Number(process.env.PG_CONNECT_TIMEOUT_MS) || 10_000;

export const DB_POOL_MAX = 10;
