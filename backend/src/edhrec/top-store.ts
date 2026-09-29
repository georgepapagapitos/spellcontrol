import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { edhrecTopLists, type EdhrecTopListRow } from '../db/schema';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import {
  edhrecPathFor,
  listKeyString,
  parseTopList,
  sourceUrlFor,
  type TopListEntry,
  type TopListKey,
} from './top-lists';

/**
 * Serves EDHREC's top lists from our own Postgres copy, stale-while-revalidate:
 *
 * - fresh (fetched within FRESH_MS): served as stored, no EDHREC call;
 * - stale: served as stored with `stale: true`, and one background refresh is
 *   started, at most once per RETRY_MS per list (checked_at), so an EDHREC
 *   outage costs one request per list every 15 minutes, not one per visitor;
 * - missing: fetched synchronously; a failure here is the only case a
 *   request fails (EdhrecUnavailableError, the route's 502).
 *
 * No scheduler warms these: a list is only ever refreshed because someone
 * asked for it, and the stored copy survives restarts, so a cold list costs
 * one request once. Concurrent requests for the same list share one fetch.
 */

export const FRESH_MS = 24 * 60 * 60 * 1000;
export const RETRY_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const EDHREC_BASE = 'https://json.edhrec.com';
// The default undici UA was bot-blocked on another host (rules/ingest.ts).
const USER_AGENT = 'SpellControl/1.0 (+https://spellcontrol.com)';

export class EdhrecUnavailableError extends Error {}

export interface TopListResult {
  entries: TopListEntry[];
  fetchedAt: number;
  stale: boolean;
  sourceUrl: string;
}

const inflight = new Map<string, Promise<EdhrecTopListRow>>();

/** The refresh in flight for a list, if any. Tests await it to observe a
 *  background refresh finishing. */
export function inflightRefresh(key: TopListKey): Promise<EdhrecTopListRow> | undefined {
  return inflight.get(listKeyString(key));
}

async function fetchEntries(key: TopListKey): Promise<TopListEntry[]> {
  const res = await fetch(`${EDHREC_BASE}${edhrecPathFor(key)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`EDHREC answered ${res.status}`);
  }
  return parseTopList(await res.json(), key);
}

/** Fetches one list and stores it. Shared by concurrent callers; on failure
 *  stamps checked_at on any stored copy so the next retry waits RETRY_MS. */
function refresh(key: TopListKey, now: number): Promise<EdhrecTopListRow> {
  const listKey = listKeyString(key);
  const running = inflight.get(listKey);
  if (running) return running;

  const run = (async () => {
    const db = getDb();
    let entries: TopListEntry[];
    try {
      entries = await fetchEntries(key);
    } catch (err) {
      await db
        .update(edhrecTopLists)
        .set({ checkedAt: now })
        .where(eq(edhrecTopLists.listKey, listKey));
      throw new EdhrecUnavailableError(`${listKey}: ${errorMessage(err)}`);
    }
    const row: EdhrecTopListRow = {
      listKey,
      entries,
      sourceUrl: sourceUrlFor(key),
      fetchedAt: now,
      checkedAt: now,
    };
    await db
      .insert(edhrecTopLists)
      .values(row)
      .onConflictDoUpdate({
        target: edhrecTopLists.listKey,
        set: {
          entries: row.entries,
          sourceUrl: row.sourceUrl,
          fetchedAt: row.fetchedAt,
          checkedAt: row.checkedAt,
        },
      });
    return row;
  })();
  inflight.set(listKey, run);
  void run.then(
    () => inflight.delete(listKey),
    () => inflight.delete(listKey)
  );
  return run;
}

function toResult(row: EdhrecTopListRow, stale: boolean): TopListResult {
  return { entries: row.entries, fetchedAt: row.fetchedAt, stale, sourceUrl: row.sourceUrl };
}

/** One load per list at a time: the stored-copy read AND any fetch it starts.
 *  refresh()'s own `inflight` map is not enough for a cold list (E523): two
 *  requests could both read "no row", the first fetch, store and clear its
 *  inflight entry, and only then the second reach refresh() and fetch again.
 *  A joiner shares the first caller's result, including its `now`. */
const loading = new Map<string, Promise<TopListResult>>();

export function getTopList(key: TopListKey, now = Date.now()): Promise<TopListResult> {
  const listKey = listKeyString(key);
  const running = loading.get(listKey);
  if (running) return running;
  const run = load(key, now);
  loading.set(listKey, run);
  void run.then(
    () => loading.delete(listKey),
    () => loading.delete(listKey)
  );
  return run;
}

async function load(key: TopListKey, now: number): Promise<TopListResult> {
  const [row] = await getDb()
    .select()
    .from(edhrecTopLists)
    .where(eq(edhrecTopLists.listKey, listKeyString(key)))
    .limit(1);

  if (!row) return toResult(await refresh(key, now), false);
  if (now - row.fetchedAt < FRESH_MS) return toResult(row, false);

  if (now - row.checkedAt >= RETRY_MS) {
    refresh(key, now).catch((err: unknown) => {
      logger.warn(
        `[edhrec] background refresh failed, serving the stored copy: ${errorMessage(err)}`
      );
    });
  }
  return toResult(row, true);
}
