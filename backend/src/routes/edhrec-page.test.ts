import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { sql } from 'drizzle-orm';
import { createTestEnv } from '../test-helpers';
import { getDb } from '../db';
import { edhrecPages } from '../db/schema-edhrec-pages';
import { FRESH_MS, RETRY_MS, resetPageMemory, tuning, evictToBound } from '../edhrec/page-store';
import { parseEdhrecPagePath } from '../edhrec/page-paths';

let app: Server;
let cleanup: () => Promise<void>;

const S3_ABSENT =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';
const CMDR = '/pages/commanders/atraxa-praetors-voice.json';

/** A commander page shaped like EDHREC's: one cardlist of named, counted cards. */
function commanderPage(n = 12, extra: Record<string, unknown> = {}) {
  return {
    container: {
      json_dict: {
        cardlists: [
          {
            tag: 'creatures',
            cardviews: Array.from({ length: n }, (_, i) => ({
              name: `Card ${i}`,
              num_decks: 100 + i,
              potential_decks: 500,
              synergy: 0.1,
            })),
          },
        ],
      },
    },
    ...extra,
  };
}

type Reply = unknown | { status: number } | (() => Promise<Response>);

/** Stubs EDHREC: a path maps to a body (200), `{status}` or a function. */
function stubEdhrec(pages: Record<string, Reply>): {
  calls: string[];
  set: (p: string, r: Reply) => void;
} {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    expect(url.startsWith('https://json.edhrec.com/')).toBe(true);
    expect(new Headers(init?.headers).get('User-Agent')).toMatch(/^SpellControl\//);
    calls.push(url);
    const r = pages[url.replace('https://json.edhrec.com', '')];
    if (typeof r === 'function') return (r as () => Promise<Response>)();
    if (r === undefined) return new Response(S3_ABSENT, { status: 403 });
    if (r && typeof r === 'object' && 'status' in r && Object.keys(r).length === 1) {
      const st = (r as { status: number }).status;
      return new Response(st === 403 || st === 404 ? S3_ABSENT : 'x', { status: st });
    }
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, set: (p, r) => void (pages[p] = r) };
}

const get = (path: string) =>
  request(app).get(`/api/edhrec/page${path}`).set('Accept-Encoding', 'identity');

beforeAll(async () => {
  ({ app, cleanup } = await createTestEnv());
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (cleanup) await cleanup();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetPageMemory();
  tuning.upstreamGapMs = 0;
  tuning.backoffMs = 1;
  tuning.maxRetries = 2;
  tuning.maxTotalBytes = 96 * 1024 * 1024;
  tuning.maxQueue = 40;
  tuning.missesPerMinute = 1000;
  await getDb().execute(sql`TRUNCATE edhrec_pages`);
});

async function ageStored(path: string, ms: number) {
  await getDb().execute(
    sql`UPDATE edhrec_pages SET fetched_at = fetched_at - ${ms}, checked_at = checked_at - ${ms}, served_at = served_at - ${ms} WHERE path = ${path}`
  );
}

describe('allowlist', () => {
  it.each([
    '/pages/commanders/atraxa-praetors-voice.json',
    '/pages/commanders/atraxa-praetors-voice/core/lifegain/budget.json',
    '/pages/commanders/tymna-the-weaver-kraum-ludevic-s-test-subject.json',
    '/pages/average-decks/atraxa-praetors-voice/lifegain.json',
    '/pages/partners/thrasios-triton-hero.json',
    '/pages/tags/lifegain.json',
    '/pages/tags/lifegain/wb.json',
    '/pages/top/salt.json',
    '/pages/combos/atraxa-praetors-voice.json',
    '/pages/combos/golgari/250-779.json',
    '/pages/cards/the-one-ring.json',
    '/static/typeahead/commanders',
  ])('accepts %s', (p) => {
    expect(parseEdhrecPagePath(p)?.path).toBe(p);
  });

  it.each([
    '',
    '/',
    '/pages/commanders/.json',
    '/pages/commanders/../../etc/passwd.json',
    '/pages/commanders/%2e%2e/x.json',
    '/pages/commanders/Atraxa.json',
    '/pages/commanders/a b.json',
    '/pages/commanders/a/b/c/d/e.json',
    '/pages/commanders/x.json?token=1',
    '/pages/other/x.json',
    '/pages/top/week.json',
    '/static/typeahead/cards',
    '/api/anything.json',
    'https://evil.example/pages/cards/x.json',
    '//evil.example/pages/cards/x.json',
    '/pages/cards/x.json/extra',
  ])('rejects %j', (p) => {
    expect(parseEdhrecPagePath(p)).toBeNull();
  });

  it('answers 400 for a path off the list and never calls EDHREC', async () => {
    const { calls } = stubEdhrec({});
    for (const p of [
      '/pages/other/x.json',
      '/pages/commanders/%2e%2e/x.json',
      '/static/typeahead/cards',
    ]) {
      const res = await get(p);
      expect(res.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('ignores a query string: it is neither forwarded nor part of the key', async () => {
    const { calls } = stubEdhrec({ [CMDR]: commanderPage() });
    const res = await get(`${CMDR}?host=evil.example`);
    expect(res.status).toBe(200);
    expect(calls).toEqual([`https://json.edhrec.com${CMDR}`]);
  });
});

describe('GET /api/edhrec/page', () => {
  it('serves the page byte-identical to what EDHREC sent, then from cache with no upstream call', async () => {
    const body = JSON.stringify(commanderPage(), null, 1); // odd whitespace must survive
    const { calls } = stubEdhrec({});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input));
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });
    const first = await get(CMDR);
    expect(first.status).toBe(200);
    expect(first.headers['x-edhrec-cache']).toBe('miss');
    expect(first.headers['content-type']).toMatch(/application\/json/);
    expect(first.text).toBe(body);

    const second = await get(CMDR);
    expect(second.headers['x-edhrec-cache']).toBe('hit');
    expect(second.text).toBe(body);
    expect(calls).toHaveLength(1);
  });

  it('sends the stored gzip as is to a client that accepts it', async () => {
    const body = JSON.stringify(commanderPage());
    stubEdhrec({ [CMDR]: JSON.parse(body) });
    await get(CMDR);
    // superagent inflates the body itself; the header proves what was on the wire.
    const res = await request(app).get(`/api/edhrec/page${CMDR}`).set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.text).toBe(body);
    expect(res.headers['vary']).toMatch(/Accept-Encoding/);
  });

  it('shares one upstream fetch between concurrent requests for a cold page', async () => {
    let release!: () => void;
    const gateOpen = new Promise<void>((r) => (release = r));
    const { calls } = stubEdhrec({
      [CMDR]: async () => {
        await gateOpen;
        return new Response(JSON.stringify(commanderPage()));
      },
    });
    const all = Promise.all([get(CMDR), get(CMDR), get(CMDR), get(CMDR)]);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    release();
    const replies = await all;
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(calls).toHaveLength(1);
  });

  it('passes EDHREC 403 and 404 through as "no page" and remembers it for an hour', async () => {
    const { calls } = stubEdhrec({
      '/pages/combos/new-commander.json': { status: 404 },
    });
    const a = await get('/pages/combos/new-commander.json');
    expect(a.status).toBe(404);
    expect(a.headers['x-edhrec-cache']).toBe('absent');
    const b = await get('/pages/combos/new-commander.json');
    expect(b.status).toBe(404);
    const c = await get('/pages/tags/lifegain/wb.json'); // stub answers 403 for unknown
    expect(c.status).toBe(403);
    expect(calls).toHaveLength(2);
  });

  it('passes an EDHREC redirect body through and stores it', async () => {
    stubEdhrec({ '/pages/cards/fire.json': { redirect: '/cards/fire-ice' } });
    const res = await get('/pages/cards/fire.json');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ redirect: '/cards/fire-ice' });
  });

  it('retries a 429 with backoff and succeeds', async () => {
    let n = 0;
    stubEdhrec({
      [CMDR]: async () =>
        ++n === 1
          ? new Response('slow down', { status: 429 })
          : new Response(JSON.stringify(commanderPage())),
    });
    const res = await get(CMDR);
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });

  it('answers 503 with Retry-After when EDHREC fails and nothing is stored, and does not re-fetch at once', async () => {
    const { calls } = stubEdhrec({ [CMDR]: { status: 500 } });
    const res = await get(CMDR);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.headers['x-edhrec-cache']).toBe('unavailable');
    const n = calls.length;
    expect(n).toBe(tuning.coldMaxRetries + 1); // cold: a user is waiting, so a short ladder
    const again = await get(CMDR);
    expect(again.status).toBe(503);
    expect(calls).toHaveLength(n);
  });

  it('refetches after the fresh window and replaces the copy', async () => {
    const { calls, set } = stubEdhrec({ [CMDR]: commanderPage(12) });
    await get(CMDR);
    await ageStored(CMDR, FRESH_MS + 1000);
    const next = commanderPage(15);
    set(CMDR, next);
    const res = await get(CMDR);
    expect(res.headers['x-edhrec-cache']).toBe('miss');
    expect(JSON.parse(res.text)).toEqual(next);
    expect(calls).toHaveLength(2);
  });

  it('serves the last good copy marked stale when the refetch fails, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const good = commanderPage(12);
    const { calls, set } = stubEdhrec({ [CMDR]: good });
    await get(CMDR);
    await ageStored(CMDR, FRESH_MS + 1000);
    set(CMDR, { status: 500 });
    const res = await get(CMDR);
    expect(res.status).toBe(200);
    expect(res.headers['x-edhrec-cache']).toBe('stale');
    expect(JSON.parse(res.text)).toEqual(good);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[edhrec-pages]'))).toBe(true);

    // The failed attempt is stamped: no new upstream call inside RETRY_MS.
    const n = calls.length;
    const again = await get(CMDR);
    expect(again.headers['x-edhrec-cache']).toBe('stale');
    expect(calls).toHaveLength(n);

    // After RETRY_MS it tries again and recovers.
    await getDb().execute(
      sql`UPDATE edhrec_pages SET checked_at = checked_at - ${RETRY_MS + 1000}`
    );
    set(CMDR, commanderPage(14));
    const healed = await get(CMDR);
    expect(healed.headers['x-edhrec-cache']).toBe('miss');
  });

  it('keeps the last good copy when the new body fails the shape check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const good = commanderPage(12);
    const { set } = stubEdhrec({ [CMDR]: good });
    await get(CMDR);
    await ageStored(CMDR, FRESH_MS + 1000);

    // Renamed count field, an emptied page, and HTML: all rejected.
    const renamed = commanderPage(12);
    for (const l of renamed.container.json_dict.cardlists) {
      for (const v of l.cardviews as Record<string, unknown>[]) {
        v.decks = v.num_decks;
        delete v.num_decks;
      }
    }
    for (const bad of [renamed, { container: { json_dict: { cardlists: [] } } }, { oops: true }]) {
      set(CMDR, bad);
      await getDb().execute(sql`UPDATE edhrec_pages SET checked_at = 0`);
      const res = await get(CMDR);
      expect(res.headers['x-edhrec-cache']).toBe('stale');
      expect(JSON.parse(res.text)).toEqual(good);
    }
    expect(warn.mock.calls.some((c) => String(c[0]).includes('shape check'))).toBe(true);
  });

  it('with no stored copy, passes a bad-shape body through unstored as "unvalidated"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubEdhrec({ [CMDR]: { oops: true } });
    const res = await get(CMDR);
    expect(res.status).toBe(200);
    expect(res.headers['x-edhrec-cache']).toBe('unvalidated');
    expect(JSON.parse(res.text)).toEqual({ oops: true });
    const rows = await getDb().select().from(edhrecPages);
    expect(rows).toHaveLength(0);
  });

  it('keeps serving a stored page EDHREC now says is gone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { set } = stubEdhrec({ [CMDR]: commanderPage() });
    await get(CMDR);
    await ageStored(CMDR, FRESH_MS + 1000);
    set(CMDR, { status: 404 });
    const res = await get(CMDR);
    expect(res.status).toBe(200);
    expect(res.headers['x-edhrec-cache']).toBe('stale');
  });

  it('spaces upstream requests by the global gap', async () => {
    tuning.upstreamGapMs = 60;
    const times: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      times.push(Date.now());
      return new Response(JSON.stringify(commanderPage()));
    });
    await Promise.all([
      get('/pages/commanders/a-one.json'),
      get('/pages/commanders/b-two.json'),
      get('/pages/commanders/c-three.json'),
    ]);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(50);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(50);
  });
});

describe('size bound', () => {
  it('evicts the least recently served pages once the total exceeds the bound', async () => {
    stubEdhrec({
      '/pages/commanders/a-one.json': commanderPage(40),
      '/pages/commanders/b-two.json': commanderPage(40),
      '/pages/commanders/c-three.json': commanderPage(40),
    });
    await get('/pages/commanders/a-one.json');
    await get('/pages/commanders/b-two.json');
    const rows = await getDb().select().from(edhrecPages);
    const one = rows[0].bytes;
    // Make a-one the oldest served, then allow room for only two pages.
    await getDb().execute(
      sql`UPDATE edhrec_pages SET served_at = served_at - 100000 WHERE path = '/pages/commanders/a-one.json'`
    );
    tuning.maxTotalBytes = one * 2 + 10;
    await get('/pages/commanders/c-three.json');
    const left = (await getDb().select().from(edhrecPages)).map((r) => r.path).sort();
    expect(left).toEqual(['/pages/commanders/b-two.json', '/pages/commanders/c-three.json']);
  });

  it('never evicts the page it just wrote, even when it alone exceeds the bound', async () => {
    stubEdhrec({ '/pages/commanders/a-one.json': commanderPage(40) });
    tuning.maxTotalBytes = 10;
    await get('/pages/commanders/a-one.json');
    const left = await getDb().select().from(edhrecPages);
    expect(left.map((r) => r.path)).toEqual(['/pages/commanders/a-one.json']);
    expect(await evictToBound()).toBe(0);
  });
});

describe('blocked is not absent', () => {
  const waf =
    (status: number, type = 'text/html') =>
    async () =>
      new Response('<html><body>Request blocked. We can not connect to the server.</body></html>', {
        status,
        headers: { 'Content-Type': type },
      });

  it('treats a non-S3 403/404 as a failure: 503 with nothing stored, and never remembered as absent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const status of [403, 404]) {
      resetPageMemory();
      const { calls } = stubEdhrec({ '/pages/combos/some-commander.json': waf(status) });
      const a = await get('/pages/combos/some-commander.json');
      expect(a.status).toBe(503);
      expect(a.headers['x-edhrec-cache']).toBe('unavailable');
      // The failure window ends; the page is asked for again, not served as "absent".
      resetPageMemory();
      const n = calls.length;
      const b = await get('/pages/combos/some-commander.json');
      expect(b.status).toBe(503);
      expect(calls.length).toBeGreaterThan(n);
    }
  });

  it('serves the stored copy stale when EDHREC starts blocking us', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { set } = stubEdhrec({ [CMDR]: commanderPage() });
    await get(CMDR);
    await ageStored(CMDR, FRESH_MS + 1000);
    set(CMDR, waf(403));
    const res = await get(CMDR);
    expect(res.status).toBe(200);
    expect(res.headers['x-edhrec-cache']).toBe('stale');
  });

  it('accepts NoSuchKey as absent too', async () => {
    stubEdhrec({
      '/pages/cards/ghost.json': async () =>
        new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
    });
    const res = await get('/pages/cards/ghost.json');
    expect(res.status).toBe(404);
    expect(res.headers['x-edhrec-cache']).toBe('absent');
  });
});

describe('abuse bounds', () => {
  it('refuses with 503 once too many upstream fetches are waiting', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    tuning.maxQueue = 2;
    tuning.upstreamGapMs = 40;
    const { calls } = stubEdhrec({});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(commanderPage()));
    });
    const replies = await Promise.all(
      ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'].map((n) => get(`/pages/commanders/${n}.json`))
    );
    const statuses = replies.map((r) => r.status);
    expect(statuses.filter((s) => s === 503).length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(6);
  });

  it('caps cache misses per client, but still serves cached pages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    tuning.missesPerMinute = 2;
    const { calls } = stubEdhrec({
      '/pages/commanders/b-1.json': commanderPage(),
      '/pages/commanders/b-2.json': commanderPage(),
      '/pages/commanders/b-3.json': commanderPage(),
    });
    expect((await get('/pages/commanders/b-1.json')).status).toBe(200);
    expect((await get('/pages/commanders/b-2.json')).status).toBe(200);
    const over = await get('/pages/commanders/b-3.json');
    expect(over.status).toBe(503);
    expect(calls).toHaveLength(2);
    // A hit costs no budget.
    expect((await get('/pages/commanders/b-1.json')).headers['x-edhrec-cache']).toBe('hit');
  });

  it('a cold page waits for at most one retry', async () => {
    const { calls } = stubEdhrec({ [CMDR]: { status: 500 } });
    tuning.maxRetries = 3;
    await get(CMDR);
    expect(calls).toHaveLength(2);
  });
});
