import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestEnv } from '../test-helpers';
import { getDb } from '../db';
import { edhrecTopLists } from '../db/schema';
import {
  EdhrecUnavailableError,
  FRESH_MS,
  RETRY_MS,
  getTopList,
  inflightRefresh,
} from './top-store';
import { listKeyString, parseTopListQuery, type TopListKey } from './top-lists';
import commandersWeek from './__fixtures__/commanders-week.json';
import topSalt from './__fixtures__/top-salt.json';
import redirect from './__fixtures__/redirect.json';

let cleanup: () => Promise<void>;

function key(q: Record<string, unknown>): TopListKey {
  const r = parseTopListQuery(q);
  if (!r.ok) throw new Error(r.error);
  return r.key;
}

const COMMANDERS = key({ kind: 'commanders' });
const SALT = key({ kind: 'salt' });

/** Stubs EDHREC: `pages` maps a JSON path to a body, or to a status to
 *  answer with. Every call is recorded; any other URL throws. */
function stubEdhrec(pages: Record<string, unknown>) {
  const calls: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const headers = new Headers(init?.headers);
    expect(headers.get('User-Agent')).toMatch(/^SpellControl\//);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const path = url.replace('https://json.edhrec.com', '');
    if (!(path in pages)) throw new Error(`Unexpected fetch in test: ${url}`);
    const page = pages[path];
    if (typeof page === 'number')
      return new Response('<Error>Access Denied</Error>', { status: page });
    if (page instanceof Error) throw page;
    return new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, spy };
}

async function storedRow(k: TopListKey) {
  const [row] = await getDb()
    .select()
    .from(edhrecTopLists)
    .where(eq(edhrecTopLists.listKey, listKeyString(k)));
  return row;
}

async function seed(k: TopListKey, fetchedAt: number, checkedAt = fetchedAt): Promise<void> {
  await getDb()
    .insert(edhrecTopLists)
    .values({
      listKey: listKeyString(k),
      entries: [
        {
          rank: 1,
          name: 'Old Entry',
          scryfallId: null,
          numDecks: 1,
          potentialDecks: null,
          salt: null,
        },
      ],
      sourceUrl: 'https://edhrec.com/commanders/week',
      fetchedAt,
      checkedAt,
    });
}

beforeAll(async () => {
  ({ cleanup } = await createTestEnv());
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (cleanup) await cleanup();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await getDb().execute(sql`TRUNCATE edhrec_top_lists`);
});

describe('getTopList', () => {
  it('fetches a list it has never stored, and stores it', async () => {
    const { calls } = stubEdhrec({ '/pages/commanders/week.json': commandersWeek });
    const now = 1_000_000;
    const list = await getTopList(COMMANDERS, now);
    expect(calls).toEqual(['https://json.edhrec.com/pages/commanders/week.json']);
    expect(list).toMatchObject({
      fetchedAt: now,
      stale: false,
      sourceUrl: 'https://edhrec.com/commanders/week',
    });
    expect(list.entries[0].name).toBe('Jace, Multiverse Architect');
    expect(await storedRow(COMMANDERS)).toMatchObject({ fetchedAt: now, checkedAt: now });
  });

  it('serves a fresh copy without calling EDHREC', async () => {
    await seed(COMMANDERS, 1_000);
    const { calls } = stubEdhrec({});
    const list = await getTopList(COMMANDERS, 1_000 + FRESH_MS - 1);
    expect(calls).toEqual([]);
    expect(list).toMatchObject({ stale: false, fetchedAt: 1_000 });
    expect(list.entries[0].name).toBe('Old Entry');
  });

  it('serves a stale copy at once and refreshes it once in the background', async () => {
    await seed(COMMANDERS, 1_000);
    const { calls } = stubEdhrec({ '/pages/commanders/week.json': commandersWeek });
    const now = 1_000 + FRESH_MS;

    const list = await getTopList(COMMANDERS, now);
    expect(list).toMatchObject({ stale: true, fetchedAt: 1_000 });
    expect(list.entries[0].name).toBe('Old Entry');

    // A second request while the refresh runs shares it.
    await getTopList(COMMANDERS, now);
    await inflightRefresh(COMMANDERS);
    expect(calls).toHaveLength(1);

    const after = await getTopList(COMMANDERS, now + 1);
    expect(after).toMatchObject({ stale: false, fetchedAt: now });
    expect(after.entries[0].name).toBe('Jace, Multiverse Architect');
  });

  it('keeps serving a stale copy when EDHREC is down, and retries at most every 15 minutes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seed(COMMANDERS, 1_000);
    const { calls } = stubEdhrec({ '/pages/commanders/week.json': 503 });
    const now = 1_000 + FRESH_MS;

    expect(await getTopList(COMMANDERS, now)).toMatchObject({ stale: true, fetchedAt: 1_000 });
    await inflightRefresh(COMMANDERS)?.catch(() => {});
    expect(calls).toHaveLength(1);
    expect(await storedRow(COMMANDERS)).toMatchObject({ fetchedAt: 1_000, checkedAt: now });

    // Inside the retry window: still the stale copy, no new request.
    expect(await getTopList(COMMANDERS, now + RETRY_MS - 1)).toMatchObject({ stale: true });
    expect(inflightRefresh(COMMANDERS)).toBeUndefined();
    expect(calls).toHaveLength(1);

    // Past it: one more try.
    await getTopList(COMMANDERS, now + RETRY_MS);
    await inflightRefresh(COMMANDERS)?.catch(() => {});
    expect(calls).toHaveLength(2);
    warn.mockRestore();
  });

  it('fails only when there is no stored copy and EDHREC is down', async () => {
    stubEdhrec({ '/pages/commanders/week.json': 403 });
    await expect(getTopList(COMMANDERS, 5)).rejects.toBeInstanceOf(EdhrecUnavailableError);
    expect(await storedRow(COMMANDERS)).toBeUndefined();
  });

  it('treats a network error and a redirect body as EDHREC being unavailable', async () => {
    stubEdhrec({
      '/pages/commanders/week.json': new TypeError('fetch failed'),
      '/pages/top/salt.json': redirect,
    });
    await expect(getTopList(COMMANDERS, 5)).rejects.toBeInstanceOf(EdhrecUnavailableError);
    await expect(getTopList(SALT, 5)).rejects.toBeInstanceOf(EdhrecUnavailableError);
  });

  it('shares one fetch between concurrent requests for a list it has never stored', async () => {
    const { calls } = stubEdhrec({ '/pages/top/salt.json': topSalt });
    const results = await Promise.all(Array.from({ length: 10 }, () => getTopList(SALT, 7)));
    expect(calls).toHaveLength(1);
    for (const r of results) expect(r.entries).toEqual(results[0].entries);
    expect(results[0].entries[0].salt).toBeGreaterThan(3);
  });

  // E523: this used to be timing-dependent. Each request read the table on
  // its own, so a second request whose read returned "no row" after the first
  // had fetched, stored and finished started a second fetch (it failed CI on
  // #2545 with 2 fetches). Joining the whole load, read included, closes it.
  it('hands a concurrent request the load already running, read included', async () => {
    const { calls } = stubEdhrec({
      '/pages/top/salt.json': topSalt,
      '/pages/commanders/week.json': commandersWeek,
    });
    const first = getTopList(SALT, 7);
    expect(getTopList(SALT, 7)).toBe(first);
    const other = getTopList(COMMANDERS, 7);
    expect(other).not.toBe(first);
    await Promise.all([first, other]);
    expect(calls).toHaveLength(2);
  });

  it('starts a new load once the last one settles, success or failure', async () => {
    const { calls } = stubEdhrec({ '/pages/commanders/week.json': 503 });
    await expect(getTopList(COMMANDERS, 5)).rejects.toBeInstanceOf(EdhrecUnavailableError);
    await expect(getTopList(COMMANDERS, 6)).rejects.toBeInstanceOf(EdhrecUnavailableError);
    expect(calls).toHaveLength(2);

    vi.restoreAllMocks();
    const ok = stubEdhrec({ '/pages/commanders/week.json': commandersWeek });
    await getTopList(COMMANDERS, 8);
    // Settled and stored: the next request reads the fresh copy, no fetch.
    expect(await getTopList(COMMANDERS, 9)).toMatchObject({ stale: false, fetchedAt: 8 });
    expect(ok.calls).toHaveLength(1);
  });
});
