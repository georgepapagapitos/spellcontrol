/**
 * Worker-thread entry for the nightly Scryfall bulk ingest.
 *
 * ## Why this file exists
 *
 * `ingestScryfallBulk` writes ~107k rows through `better-sqlite3`, which is
 * **synchronous**: every write blocks the thread it runs on. Run in the web
 * process, that thread is the event loop — so while the ingest works, nothing
 * else is served. Not requests, and critically not `/health`.
 *
 * That is the last unfixed fault of the 2026-08-17 outage, and on 2026-08-18 it
 * was finally measured in isolation (crash faults fixed, 2 cores, nothing else
 * competing):
 *
 *   - ingest started 01:42:52 -> health check critical 01:43:37 (45s later)
 *   - external `/health`: 125ms -> 12.2s -> timeout >25s, and stayed there
 *   - 3000 of 107383 rows written, then no row progress for ~9 minutes
 *   - the site was effectively DOWN for ~10 minutes; recovery was immediate on
 *     disabling the ingest
 *
 * ⛔ **Adding CPU does not fix this, by construction.** During that run
 * `loadavg` was 1.08 on `nproc` 2 — one core busy, one **idle**. A
 * single-threaded event loop cannot use the second core, and `/health` is
 * served by that same loop. This is exactly why scaling to 2 cores only ever
 * made the outage "flap instead of flatline". It also is not memory (RSS was
 * 139MB of 2GB) and not disk; the process sat in R state getting only ~19% of
 * one core, i.e. throttled by the platform.
 *
 * ## What moving it here does and does not buy
 *
 * It does **not** make the ingest faster — same machine, same CPU quota. It
 * makes the ingest's slowness *cost latency instead of availability*: the main
 * thread stays free to answer the health check, so Fly stops evicting a machine
 * that is alive and working. "This app is slow during a nightly batch job" is a
 * true and acceptable statement; "this app is evicted during a nightly batch
 * job" is an outage.
 *
 * `better-sqlite3` supports worker threads and opens its own connection here.
 * The cache DB is in WAL mode, so the main thread keeps reading while this
 * writes.
 */
import { workerData } from 'node:worker_threads';
import { logger } from './logger';
import { ScryfallCache } from './cache';
import { runScryfallBulkIngest } from './scryfall-bulk';

const { dbPath } = workerData as { dbPath: string };

// Its own connection — a better-sqlite3 Database cannot cross the thread
// boundary. The recency guard still lives in runScryfallBulkIngest, so a
// worker spawned within 20h of a successful run exits almost immediately.
const cache = new ScryfallCache(dbPath);

runScryfallBulkIngest(cache, dbPath)
  .catch((err) => {
    // A failed ingest is a failed JOB. The worker exits non-zero, the parent
    // logs it, and the server carries on with the cache it already had.
    logger.error('[scryfall-bulk] worker run failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    cache.close();
  });
