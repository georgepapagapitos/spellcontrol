import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { sql } from 'drizzle-orm';
import { createTestEnv } from '../test-helpers';
import { getDb } from '../db';
import { edhrecTopLists } from '../db/schema';
import { FRESH_MS } from '../edhrec/top-store';
import topAzorius from '../edhrec/__fixtures__/top-azorius.json';
import topSalt from '../edhrec/__fixtures__/top-salt.json';

let app: Server;
let cleanup: () => Promise<void>;

/** EDHREC stub: a path → body map; any other URL answers 403 like EDHREC
 *  does for a page it doesn't have. */
function stubEdhrec(pages: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const body = pages[url.replace('https://json.edhrec.com', '')];
    return body === undefined
      ? new Response('<Error>Access Denied</Error>', { status: 403 })
      : new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

beforeAll(async () => {
  ({ app, cleanup } = await createTestEnv());
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (cleanup) await cleanup();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await getDb().execute(sql`TRUNCATE edhrec_top_lists`);
});

describe('GET /api/edhrec/top', () => {
  it('answers the contract shape, normalising the key', async () => {
    const calls = stubEdhrec({ '/pages/top/azorius.json': topAzorius });
    const res = await request(app).get(
      '/api/edhrec/top?kind=cards&colors=uw&type=creatures&period=week'
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://json.edhrec.com/pages/top/azorius.json']);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.body).toMatchObject({
      kind: 'cards',
      period: 'year',
      colors: 'WU',
      type: 'creatures',
      stale: false,
      sourceUrl: 'https://edhrec.com/top/azorius',
    });
    expect(typeof res.body.fetchedAt).toBe('number');
    expect(res.body.entries).toHaveLength(2);
    expect(Object.keys(res.body.entries[0]).sort()).toEqual(
      ['name', 'numDecks', 'potentialDecks', 'rank', 'salt', 'scryfallId'].sort()
    );
  });

  it('gives salt null period, colour and type', async () => {
    stubEdhrec({ '/pages/top/salt.json': topSalt });
    const res = await request(app).get('/api/edhrec/top?kind=salt');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'salt', period: null, colors: null, type: null });
    expect(res.body.entries[0].salt).toBeGreaterThan(3);
  });

  it('marks a stale copy and shortens its browser cache', async () => {
    stubEdhrec({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const old = Date.now() - FRESH_MS - 1;
    await getDb().insert(edhrecTopLists).values({
      listKey: 'salt:-:-:-',
      entries: [],
      sourceUrl: 'https://edhrec.com/top/salt',
      fetchedAt: old,
      checkedAt: old,
    });
    const res = await request(app).get('/api/edhrec/top?kind=salt');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stale: true, fetchedAt: old });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it.each([
    ['no kind', ''],
    ['an unknown kind', '?kind=decks'],
    ['a bad period', '?kind=cards&period=day'],
    ['a bad colour', '?kind=cards&colors=WX'],
    ['a type on commanders', '?kind=commanders&type=lands'],
    ['a colour on salt', '?kind=salt&colors=W'],
  ])('answers 400 for %s, without calling EDHREC', async (_label, qs) => {
    const calls = stubEdhrec({});
    const res = await request(app).get(`/api/edhrec/top${qs}`);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(calls).toEqual([]);
  });

  it("answers 502 when there is no stored copy and EDHREC can't be reached", async () => {
    stubEdhrec({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app).get('/api/edhrec/top?kind=commanders');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Couldn't reach EDHREC." });
  });

  it('answers 500 when the store itself fails', async () => {
    stubEdhrec({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await getDb().execute(sql`ALTER TABLE edhrec_top_lists RENAME TO edhrec_top_lists_gone`);
    try {
      const res = await request(app).get('/api/edhrec/top?kind=commanders');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Couldn't load that list." });
    } finally {
      await getDb().execute(sql`ALTER TABLE edhrec_top_lists_gone RENAME TO edhrec_top_lists`);
    }
  });
});
