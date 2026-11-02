import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv } from '../test-helpers';
import {
  SPELLBOOK_ESTIMATE_URL,
  SPELLBOOK_USER_AGENT,
  deckListKey,
  parseDeckList,
  resetSpellbookState,
} from '../spellbook/bracket';

let app: Server;
let cleanup: () => Promise<void>;

const body = {
  commanders: ["Atraxa, Praetors' Voice"],
  cards: [
    { name: 'Sol Ring', quantity: 1 },
    { name: 'Rhystic Study', quantity: 1 },
  ],
};

/** Spellbook answers `tag`, echoing back one classified card per name sent. */
function stubSpellbook(
  tag: string,
  opts: { status?: number; headers?: Record<string, string>; matched?: number } = {}
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init });
    if (opts.status && opts.status !== 200) {
      return new Response('nope', { status: opts.status, headers: opts.headers });
    }
    const sent = JSON.parse(String(init?.body)) as { main: unknown[]; commanders: unknown[] };
    const n = opts.matched ?? sent.main.length + sent.commanders.length;
    return new Response(
      JSON.stringify({ bracketTag: tag, cards: Array.from({ length: n }, () => ({})), combos: [] }),
      { headers: { 'Content-Type': 'application/json' } }
    );
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
beforeEach(() => {
  vi.restoreAllMocks();
  resetSpellbookState();
});

describe('POST /api/spellbook/bracket', () => {
  it("passes Spellbook's own tag through, naming the service in the User-Agent", async () => {
    const calls = stubSpellbook('P');
    const res = await request(app).post('/api/spellbook/bracket').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tag: 'P', cached: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPELLBOOK_ESTIMATE_URL);
    expect((calls[0].init?.headers as Record<string, string>)['user-agent']).toBe(
      SPELLBOOK_USER_AGENT
    );
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('serves the same list from cache whatever its order', async () => {
    const calls = stubSpellbook('C');
    await request(app).post('/api/spellbook/bracket').send(body);
    const res = await request(app)
      .post('/api/spellbook/bracket')
      .send({ ...body, cards: [...body.cards].reverse() });
    expect(res.body).toEqual({ tag: 'C', cached: true });
    expect(calls).toHaveLength(1);
  });

  it('answers 503 with Retry-After on a 429 and does not hammer upstream afterwards', async () => {
    const calls = stubSpellbook('P', { status: 429, headers: { 'retry-after': '42' } });
    const first = await request(app).post('/api/spellbook/bracket').send(body);
    expect(first.status).toBe(503);
    expect(first.headers['retry-after']).toBe('42');
    const second = await request(app)
      .post('/api/spellbook/bracket')
      .send({ cards: [{ name: 'Island', quantity: 1 }] });
    expect(second.status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  it('answers 503 when upstream is down or unreadable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    expect((await request(app).post('/api/spellbook/bracket').send(body)).status).toBe(503);
    resetSpellbookState();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ bracketTag: 'Z', cards: [] }))
    );
    expect((await request(app).post('/api/spellbook/bracket').send(body)).status).toBe(503);
  });

  it('gives no verdict when Spellbook recognized under half the list', async () => {
    stubSpellbook('E', { matched: 0 });
    const res = await request(app).post('/api/spellbook/bracket').send(body);
    expect(res.status).toBe(503);
  });

  it('rejects malformed lists with 400 before calling upstream', async () => {
    const calls = stubSpellbook('C');
    for (const bad of [
      {},
      { cards: [] },
      { cards: [{ name: 'Sol Ring', quantity: 0 }] },
      { cards: [{ name: '', quantity: 1 }] },
      { commanders: ['a', 'b', 'c'], cards: [{ name: 'Sol Ring', quantity: 1 }] },
    ]) {
      const res = await request(app).post('/api/spellbook/bracket').send(bad);
      expect(res.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('deckListKey', () => {
  it('merges repeats and ignores order and case', () => {
    const a = parseDeckList({
      cards: [
        { name: 'Island', quantity: 1 },
        { name: 'Island', quantity: 2 },
        { name: 'Sol Ring', quantity: 1 },
      ],
    });
    const b = parseDeckList({
      cards: [
        { name: 'sol ring', quantity: 1 },
        { name: 'Island', quantity: 3 },
      ],
    });
    expect(typeof a).toBe('object');
    expect(deckListKey(a as never)).toBe(deckListKey(b as never));
  });
});
