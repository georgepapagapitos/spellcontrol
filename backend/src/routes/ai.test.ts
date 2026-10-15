import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';

// Mock the thin Anthropic client so no test ever touches the network. The
// route reads `aiEnabled()` per request, so the flag can flip mid-suite.
const mockState = {
  enabled: true,
  generate: vi.fn(),
};
vi.mock('../ai/client', async (importOriginal) => ({
  AI_MODEL: 'test-model',
  REFINE_MODEL: 'test-refine-model',
  REVIEW_GENERATION: { model: 'test-model', thinking: 'off' },
  // Real pricing math: the global spend cap reads it.
  estimateUsd: (await importOriginal<typeof import('../ai/client')>()).estimateUsd,
  aiEnabled: () => mockState.enabled,
  generateReview: (
    system: string,
    user: string,
    onDelta?: (t: string) => void,
    signal?: AbortSignal,
    options?: unknown
  ) => mockState.generate(system, user, onDelta, signal, options),
}));

// The route imports this class by name from the real SDK to distinguish an
// abort from a genuine failure — that import is untouched by the mock above,
// so tests can throw the real class to simulate a client disconnect.
import { APIUserAbortError } from '@anthropic-ai/sdk';

import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getScryfallCache } from '../scryfall-cache';

let app: Server;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  delete process.env.AI_PUBLIC;
  if (cleanup) await cleanup();
});

const REVIEW_TEXT = 'Your deck is a fine deck.';

beforeEach(() => {
  mockState.enabled = true;
  // The suite below exercises consent/quota/streaming, which apply to every
  // account once the feature is public — run it with the admin-only flag off.
  // The 'admin-only flag' describe covers the gate itself.
  process.env.AI_PUBLIC = '1';
  mockState.generate.mockReset();
  // Emit the text in two chunks, the way a real stream arrives, so the route's
  // delta forwarding is exercised rather than assumed.
  // The review is TWO calls: a research pass (tools, no streaming, prose
  // discarded) then a writing pass (no tools, streams). The mock has to tell
  // them apart or every count in this file doubles.
  mockState.generate.mockImplementation(
    async (
      _system: string,
      _user: string,
      onDelta?: (t: string) => void,
      _signal?: AbortSignal,
      options?: { tools?: unknown[] }
    ) => {
      if (options?.tools?.length) {
        return { content: '', inputTokens: 500, outputTokens: 100, fetched: [] };
      }
      onDelta?.('Your deck is ');
      onDelta?.('a fine deck.');
      return {
        content: REVIEW_TEXT,
        inputTokens: 1000,
        outputTokens: 200,
        cacheWriteTokens: 40,
        cacheReadTokens: 60,
        fetched: [],
      };
    }
  );
});

/**
 * The deck-review response is NDJSON, so supertest leaves it in `res.text`.
 * Collapse it back into the pieces a test cares about.
 */
function parseStream(text: string): {
  deltas: string[];
  streamed: string;
  done?: Record<string, unknown>;
  error?: string;
} {
  const deltas: string[] = [];
  let done: Record<string, unknown> | undefined;
  let error: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line) as Record<string, unknown>;
    if (typeof msg.delta === 'string') deltas.push(msg.delta);
    else if (typeof msg.error === 'string') error = msg.error;
    else if (msg.done) done = msg.done as Record<string, unknown>;
  }
  return { deltas, streamed: deltas.join(''), done, error };
}

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function optIn(cookie: string): Promise<void> {
  const res = await request(app)
    .post('/api/ai/opt-in')
    .set('Cookie', cookie)
    .send({ enabled: true });
  expect(res.status).toBe(200);
}

function reviewBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deckId: 'deck-1',
    commander: 'Meren of Clan Nel Toth',
    cards: [
      { name: 'Sol Ring', oracleId: 'o-1', qty: 1 },
      { name: 'Swamp', oracleId: 'o-2', qty: 12 },
    ],
    analysis: { totalNonCommander: 13, types: { lands: 12 } },
    ...overrides,
  };
}

function refineBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...reviewBody(),
    pool: [
      { name: 'Eternal Witness', oracleId: 'p-1', qty: 1 },
      { name: 'Viscera Seer', oracleId: 'p-2', qty: 1 },
    ],
    ...overrides,
  };
}

/** A model reply in the shape the refine prompt asks for. */
function refineReply(prose: string, tweaks: unknown[]): string {
  return `${prose}\n\n---TWEAKS---\n${JSON.stringify(tweaks)}`;
}

describe('feature flag', () => {
  it('404s every /api/ai route when the key is absent', async () => {
    const cookie = await makeUser('ai-flag-off');
    mockState.enabled = false;
    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.status).toBe(404);
    const review = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(review.status).toBe(404);
  });
});

describe('admin-only flag', () => {
  beforeEach(() => {
    delete process.env.AI_PUBLIC;
  });

  it('404s every /api/ai route for non-admins, opted in or not', async () => {
    const cookie = await makeUser('ai-gate-regular');
    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.status).toBe(404);
    const review = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(review.status).toBe(404);
    const optInRes = await request(app)
      .post('/api/ai/opt-in')
      .set('Cookie', cookie)
      .send({ enabled: true });
    expect(optInRes.status).toBe(404);
    expect(mockState.generate).not.toHaveBeenCalled();
  });

  it('404s unauthenticated callers instead of 401 — the gate does not advertise', async () => {
    const res = await request(app).get('/api/ai/status');
    expect(res.status).toBe(404);
  });

  it('lets a user through once an admin grants ai_access, and revokes cleanly (T114)', async () => {
    const { getPool } = await import('../db');
    const cookie = await makeUser('ai-gate-granted');
    expect((await request(app).get('/api/ai/status').set('Cookie', cookie)).status).toBe(404);

    await getPool().query('UPDATE users SET ai_access = true WHERE username = $1', [
      'ai-gate-granted',
    ]);
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(res.status).toBe(200);
    expect(parseStream(res.text).done).toMatchObject({ content: REVIEW_TEXT });
    // The stored row carries the cache-priced token counts (T116 spend readout).
    const stored = await getPool().query<{ cache_write_tokens: number; cache_read_tokens: number }>(
      `SELECT r.cache_write_tokens, r.cache_read_tokens FROM ai_reviews r
         JOIN users u ON u.id = r.user_id WHERE u.username = $1`,
      ['ai-gate-granted']
    );
    expect(stored.rows[0]).toEqual({ cache_write_tokens: 40, cache_read_tokens: 60 });

    await getPool().query('UPDATE users SET ai_access = false WHERE username = $1', [
      'ai-gate-granted',
    ]);
    expect((await request(app).get('/api/ai/status').set('Cookie', cookie)).status).toBe(404);
  });

  it('lets an admin through end to end', async () => {
    const { getPool } = await import('../db');
    const cookie = await makeUser('ai-gate-admin');
    // Registration never mints an admin any more (admin is seeded from
    // verified emails, granted by id thereafter), so the seat is set
    // directly — the same shape as the ai_access cases above.
    await getPool().query('UPDATE users SET role = $1 WHERE username = $2', [
      'admin',
      'ai-gate-admin',
    ]);
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(res.status).toBe(200);
    expect(parseStream(res.text).done).toMatchObject({ content: REVIEW_TEXT });
  });
});

describe('GET /api/ai/status', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).get('/api/ai/status');
    expect(res.status).toBe(401);
  });

  it('reports opt-out with the default limit', async () => {
    const cookie = await makeUser('ai-status-fresh');
    const res = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ optIn: false, used: 0, limit: 10 });
  });
});

describe('POST /api/ai/opt-in', () => {
  it('validates the body', async () => {
    const cookie = await makeUser('ai-optin-bad');
    const res = await request(app)
      .post('/api/ai/opt-in')
      .set('Cookie', cookie)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('round-trips through status', async () => {
    const cookie = await makeUser('ai-optin-roundtrip');
    await optIn(cookie);
    const on = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(on.body.optIn).toBe(true);
    const off = await request(app)
      .post('/api/ai/opt-in')
      .set('Cookie', cookie)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    const after = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(after.body.optIn).toBe(false);
  });
});

describe('POST /api/ai/deck-review', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).post('/api/ai/deck-review').send(reviewBody());
    expect(res.status).toBe(401);
  });

  it('rejects an invalid body (400)', async () => {
    const cookie = await makeUser('ai-review-badbody');
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send({ deckId: 'x' });
    expect(res.status).toBe(400);
  });

  it('403s without server-side opt-in — a hidden button is not consent', async () => {
    const cookie = await makeUser('ai-review-noconsent');
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(res.status).toBe(403);
    expect(mockState.generate).not.toHaveBeenCalled();
  });

  it('generates, stores, and then serves the identical payload from cache', async () => {
    const cookie = await makeUser('ai-review-cache');
    await optIn(cookie);

    const first = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toContain('application/x-ndjson');
    const firstStream = parseStream(first.text);
    // Prose arrives in chunks, and the terminator repeats it in full.
    expect(firstStream.deltas).toEqual(['Your deck is ', 'a fine deck.']);
    expect(firstStream.streamed).toBe(REVIEW_TEXT);
    expect(firstStream.done).toEqual({
      content: REVIEW_TEXT,
      cached: false,
      model: 'test-model',
      // Both passes are billed: research 500/100 + writing 1000/200. The user
      // pays for the lookups whether or not their prose is shown.
      usage: { inputTokens: 1500, outputTokens: 300 },
      createdAt: expect.any(Number),
    });

    const second = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(second.status).toBe(200);
    const secondStream = parseStream(second.text);
    // A cache hit uses the same wire format — one delta plus the terminator.
    expect(secondStream.deltas).toEqual([REVIEW_TEXT]);
    expect(secondStream.done).toMatchObject({ cached: true, content: REVIEW_TEXT });
    // The cache hit never touched the model. Two calls, not one: research
    // then write.
    expect(mockState.generate).toHaveBeenCalledTimes(2);

    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.body.used).toBe(1);
  });

  it('sends the cards it looked up, and still sends them on a cache hit', async () => {
    const cookie = await makeUser('ai-review-fetched');
    await optIn(cookie);
    // Two lookups returning the same card: the wire carries DISTINCT names, so
    // the client's chip set doesn't grow with the model's search count.
    mockState.generate.mockImplementation(async () => ({
      content: REVIEW_TEXT,
      inputTokens: 1000,
      outputTokens: 200,
      fetched: [
        { name: 'Bojuka Bog' },
        { name: 'Gray Merchant of Asphodel' },
        { name: 'Bojuka Bog' },
      ],
    }));

    const fresh = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(parseStream(fresh.text).done).toMatchObject({
      cached: false,
      fetched: ['Bojuka Bog', 'Gray Merchant of Asphodel'],
    });

    // The replay is the path that matters: an unchanged deck re-reads from the
    // row, and a suggested card must stay tappable there too.
    const replay = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(parseStream(replay.text).done).toMatchObject({
      cached: true,
      fetched: ['Bojuka Bog', 'Gray Merchant of Asphodel'],
    });
    expect(mockState.generate).toHaveBeenCalledTimes(2);

    const history = await request(app).get('/api/ai/history?deckId=deck-1').set('Cookie', cookie);
    expect(history.body.readings[0].fetched).toEqual(['Bojuka Bog', 'Gray Merchant of Asphodel']);
  });

  it('omits the looked-up list rather than sending an empty one', async () => {
    const cookie = await makeUser('ai-review-nofetch');
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    // Absent, not `[]` — the client tells "looked nothing up" apart from "this
    // row predates the column" by the key being missing either way, so the two
    // must serialize identically.
    expect(parseStream(res.text).done).not.toHaveProperty('fetched');
  });

  it('records the reading in per-deck history, scoped to the deck and the user', async () => {
    const cookie = await makeUser('ai-review-history');
    await optIn(cookie);

    const missing = await request(app).get('/api/ai/history').set('Cookie', cookie);
    expect(missing.status).toBe(400);

    const empty = await request(app).get('/api/ai/history?deckId=deck-1').set('Cookie', cookie);
    expect(empty.status).toBe(200);
    expect(empty.body.readings).toEqual([]);

    await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(reviewBody());

    const after = await request(app).get('/api/ai/history?deckId=deck-1').set('Cookie', cookie);
    expect(after.body.readings).toHaveLength(1);
    expect(after.body.readings[0]).toMatchObject({ content: REVIEW_TEXT, model: 'test-model' });
    expect(typeof after.body.readings[0].createdAt).toBe('number');

    // Scoped to the deck it was written for…
    const otherDeck = await request(app).get('/api/ai/history?deckId=deck-2').set('Cookie', cookie);
    expect(otherDeck.body.readings).toEqual([]);

    // …and to the user who wrote it.
    const stranger = await makeUser('ai-review-history-2');
    await optIn(stranger);
    const cross = await request(app).get('/api/ai/history?deckId=deck-1').set('Cookie', stranger);
    expect(cross.body.readings).toEqual([]);
  });

  it('an edited deck misses the cache and spends quota again', async () => {
    const cookie = await makeUser('ai-review-edit');
    await optIn(cookie);
    await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(reviewBody());
    const edited = reviewBody({
      cards: [
        { name: 'Sol Ring', oracleId: 'o-1', qty: 1 },
        { name: 'Swamp', oracleId: 'o-2', qty: 11 },
        { name: 'Command Tower', oracleId: 'o-3', qty: 1 },
      ],
    });
    const res = await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(edited);
    expect(res.status).toBe(200);
    expect(parseStream(res.text).done).toMatchObject({ cached: false });
    expect(mockState.generate).toHaveBeenCalledTimes(4);
  });

  describe('forced re-read of an unchanged deck (E254)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const refreshBody = (overrides: Record<string, unknown> = {}) =>
      reviewBody({ refresh: true, ...overrides });
    const post = (cookie: string, body: Record<string, unknown>) =>
      request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(body);
    const age = async (username: string, ms: number) => {
      const { getPool } = await import('../db');
      await getPool().query(
        `UPDATE ai_reviews SET created_at = created_at - $2
          WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
        [username, ms]
      );
    };

    it('409s inside the window, names when it frees up, and never calls the model', async () => {
      const cookie = await makeUser('ai-reread-window');
      await optIn(cookie);
      const first = parseStream((await post(cookie, reviewBody())).text).done as {
        createdAt: number;
      };
      expect(mockState.generate).toHaveBeenCalledTimes(2);

      const res = await post(cookie, refreshBody());
      expect(res.status).toBe(409);
      expect(res.body.availableAt).toBe(first.createdAt + DAY);
      expect(mockState.generate).toHaveBeenCalledTimes(2);
      const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
      expect(status.body.used).toBe(1);
    });

    it('regenerates once the window has passed, replaces the row and spends one quota', async () => {
      const cookie = await makeUser('ai-reread-open');
      await optIn(cookie);
      await post(cookie, reviewBody());
      await age('ai-reread-open', DAY + 1000);
      mockState.generate.mockClear();

      const res = await post(cookie, refreshBody());
      expect(res.status).toBe(200);
      expect(parseStream(res.text).done).toMatchObject({ cached: false });
      expect(mockState.generate).toHaveBeenCalledTimes(2);

      const { getPool } = await import('../db');
      const rows = await getPool().query<{ created_at: string }>(
        `SELECT created_at FROM ai_reviews
          WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
        ['ai-reread-open']
      );
      expect(rows.rows).toHaveLength(1);
      expect(Date.now() - Number(rows.rows[0].created_at)).toBeLessThan(60_000);
      const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
      expect(status.body.used).toBe(1);

      // The window restarts from the new reading.
      expect((await post(cookie, refreshBody())).status).toBe(409);
    });

    it('a plain (non-forced) request still replays inside and outside the window', async () => {
      const cookie = await makeUser('ai-reread-plain');
      await optIn(cookie);
      await post(cookie, reviewBody());
      await age('ai-reread-plain', DAY + 1000);
      const res = await post(cookie, reviewBody());
      expect(parseStream(res.text).done).toMatchObject({ cached: true });
      expect(mockState.generate).toHaveBeenCalledTimes(2);
    });

    it('a changed deck re-reads even with refresh set and a reading inside the window', async () => {
      const cookie = await makeUser('ai-reread-changed');
      await optIn(cookie);
      await post(cookie, reviewBody());
      const res = await post(
        cookie,
        refreshBody({ cards: [{ name: 'Sol Ring', oracleId: 'o-1', qty: 1 }] })
      );
      expect(res.status).toBe(200);
      expect(parseStream(res.text).done).toMatchObject({ cached: false });
      expect(mockState.generate).toHaveBeenCalledTimes(4);
    });

    it('keeps the old reading when the forced re-read fails', async () => {
      const cookie = await makeUser('ai-reread-fail');
      await optIn(cookie);
      await post(cookie, reviewBody());
      await age('ai-reread-fail', DAY + 1000);
      const { getPool } = await import('../db');
      const before = await getPool().query<{ content: string; created_at: string }>(
        `SELECT content, created_at FROM ai_reviews
          WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
        ['ai-reread-fail']
      );
      mockState.generate.mockReset();
      mockState.generate.mockRejectedValue(new Error('boom'));

      const res = await post(cookie, refreshBody());
      expect(res.status).toBe(502);
      const after = await getPool().query<{ content: string; created_at: string }>(
        `SELECT content, created_at FROM ai_reviews
          WHERE user_id = (SELECT id FROM users WHERE username = $1)`,
        ['ai-reread-fail']
      );
      expect(after.rows).toEqual(before.rows);
    });

    it('a forced re-read counts against the daily limit', async () => {
      const cookie = await makeUser('ai-reread-quota');
      await optIn(cookie);
      const { getPool } = await import('../db');
      await getPool().query('UPDATE users SET ai_daily_limit = 1 WHERE username = $1', [
        'ai-reread-quota',
      ]);
      await post(cookie, reviewBody());
      await age('ai-reread-quota', DAY + 1000);
      // The aged row is from a prior day, so today's quota is open once.
      expect((await post(cookie, refreshBody())).status).toBe(200);
      const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
      expect(status.body.used).toBe(1);
    });
  });

  it('429s at the daily limit; cache hits still work past it', async () => {
    const cookie = await makeUser('ai-review-quota');
    await optIn(cookie);
    // Tighten this user's limit to 1 so the test spends one real generation.
    const { getPool } = await import('../db');
    await getPool().query('UPDATE users SET ai_daily_limit = 1 WHERE username = $1', [
      'ai-review-quota',
    ]);

    const first = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(first.status).toBe(200);

    const over = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody({ commander: 'Different Commander' }));
    expect(over.status).toBe(429);

    // Re-reading the already-reviewed deck is free and unaffected by the cap.
    const rehit = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(rehit.status).toBe(200);
    expect(parseStream(rehit.text).done).toMatchObject({ cached: true });
  });

  it('429s every account once the global daily spend cap is reached; cache hits still work', async () => {
    const cookie = await makeUser('ai-review-global-cap');
    await optIn(cookie);
    const first = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody({ commander: 'Global Cap Commander' }));
    expect(first.status).toBe(200);

    // Whatever has been spent today is now over the cap.
    process.env.AI_DAILY_USD_CAP = '0';
    try {
      mockState.generate.mockClear();
      const other = await makeUser('ai-review-global-cap-2');
      await optIn(other);
      const refused = await request(app)
        .post('/api/ai/deck-review')
        .set('Cookie', other)
        .send(reviewBody({ commander: 'Another Commander' }));
      expect(refused.status).toBe(429);
      expect(refused.body.error).toMatch(/limit for today/);
      expect(mockState.generate).not.toHaveBeenCalled();

      const rehit = await request(app)
        .post('/api/ai/deck-review')
        .set('Cookie', cookie)
        .send(reviewBody({ commander: 'Global Cap Commander' }));
      expect(rehit.status).toBe(200);
      expect(parseStream(rehit.text).done).toMatchObject({ cached: true });
    } finally {
      delete process.env.AI_DAILY_USD_CAP;
    }
  });

  it('502s when generation fails before a single byte is streamed', async () => {
    const cookie = await makeUser('ai-review-fail');
    await optIn(cookie);
    mockState.generate.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(res.status).toBe(502);
    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.body.used).toBe(0);
  });

  it('streams only the prose half, never the machine-readable tail', async () => {
    // Shared with deck-refine: makeProseGate must hold back the delimiter even
    // when the model splits it across chunks.
    const cookie = await makeUser('ai-review-prosegate');
    await optIn(cookie);
    mockState.generate.mockImplementation(
      async (_s: string, _u: string, onDelta?: (t: string) => void) => {
        onDelta?.('Prose here.\n\n---TWE');
        onDelta?.('AKS---\n[]');
        return {
          content: 'Prose here.\n\n---TWEAKS---\n[]',
          inputTokens: 1,
          outputTokens: 1,
          fetched: [],
        };
      }
    );
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());
    const stream = parseStream(res.text);
    expect(stream.streamed).not.toContain('TWEAKS');
    expect(stream.streamed.trim()).toBe('Prose here.');
  });

  it('never streams the answer marker to the reader', async () => {
    // The tool loop's gate releases text FROM the marker onward, so the marker
    // is the first thing this gate sees. It is machine framing, not prose.
    const cookie = await makeUser('ai-refine-marker');
    await optIn(cookie);
    mockState.generate.mockImplementation(
      async (_s: string, _u: string, onDelta?: (t: string) => void) => {
        onDelta?.('---STRAT');
        onDelta?.('EGY---\nYour deck grinds value.');
        onDelta?.('\n\n---TWEAKS---\n[]');
        return {
          content: '---STRATEGY---\nYour deck grinds value.\n\n---TWEAKS---\n[]',
          inputTokens: 1,
          outputTokens: 1,
          fetched: [],
        };
      }
    );
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());
    const stream = parseStream(res.text);
    expect(stream.streamed).not.toContain('STRATEGY');
    expect(stream.streamed.trim()).toBe('Your deck grinds value.');
    expect((stream.done as { content: string }).content).toBe('Your deck grinds value.');
  });

  it('reports a MID-stream failure in-band, stores nothing, spends nothing', async () => {
    const cookie = await makeUser('ai-review-midfail');
    await optIn(cookie);
    // Deltas go out, then the model dies — the 200 status is already spent, so
    // the failure has to ride the stream itself.
    mockState.generate.mockImplementation(
      async (
        _system: string,
        _user: string,
        onDelta?: (t: string) => void,
        _signal?: AbortSignal,
        options?: { tools?: unknown[] }
      ) => {
        // The research pass succeeds; the WRITING pass dies mid-stream, which
        // is the only way a failure can land after the headers are gone.
        if (options?.tools?.length) {
          return { content: '', inputTokens: 500, outputTokens: 100, fetched: [] };
        }
        onDelta?.('Your deck is ');
        throw new Error('boom');
      }
    );
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());

    expect(res.status).toBe(200);
    const stream = parseStream(res.text);
    expect(stream.streamed).toBe('Your deck is ');
    expect(stream.error).toBe('The review could not be generated. Try again.');
    // No terminator — that absence is what tells the client it was truncated.
    expect(stream.done).toBeUndefined();

    // Nothing stored ⇒ nothing charged, and the retry is a clean first attempt.
    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.body.used).toBe(0);
  });

  it('marks a max_tokens generation truncated and still stores the row', async () => {
    const cookie = await makeUser('ai-review-truncated');
    await optIn(cookie);
    mockState.generate.mockImplementation(
      async (_system: string, _user: string, onDelta?: (t: string) => void) => {
        onDelta?.('Your deck is ');
        return {
          content: 'Your deck is ',
          inputTokens: 1000,
          outputTokens: 2000,
          truncated: true,
          fetched: [],
        };
      }
    );
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(res.status).toBe(200);
    expect(parseStream(res.text).done).toMatchObject({ truncated: true });

    // Truncated still means "generated" — the row is stored and quota spent.
    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.body.used).toBe(1);
  });

  it('does not mark truncated on a normal completion', async () => {
    const cookie = await makeUser('ai-review-nottruncated');
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(parseStream(res.text).done).not.toHaveProperty('truncated');
  });

  it('an aborted request stores no row and spends no quota', async () => {
    const cookie = await makeUser('ai-review-aborted');
    await optIn(cookie);
    // Simulates the client disconnecting mid-generation: the SDK surfaces this
    // as APIUserAbortError, distinct from a genuine failure.
    mockState.generate.mockRejectedValue(new APIUserAbortError());
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());

    // No 500, no error line — an abort is a quiet no-op on a socket nobody
    // is reading from anymore.
    expect(res.status).toBe(200);
    expect(parseStream(res.text).error).toBeUndefined();

    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.body.used).toBe(0);
  });

  it('stamps the stored row with the review prompt version', async () => {
    const cookie = await makeUser('ai-review-promptversion');
    await optIn(cookie);
    await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(reviewBody());

    const { getPool } = await import('../db');
    const { DECK_REVIEW_PROMPT_VERSION } = await import('../ai/deck-review');
    const rows = await getPool().query<{ prompt_version: string }>(
      `SELECT r.prompt_version FROM ai_reviews r JOIN users u ON u.id = r.user_id
        WHERE u.username = $1`,
      ['ai-review-promptversion']
    );
    expect(rows.rows.map((r) => r.prompt_version)).toEqual([DECK_REVIEW_PROMPT_VERSION]);
  });

  it('researches with tools, then WRITES without them', async () => {
    // The whole point of the two-pass split. If the writing pass keeps the
    // tools, the model searches mid-answer again — it emits a section label,
    // then calls lookup_cards, and the section body lands in a markerless turn
    // the gate discards as research (measured: a section came back EMPTY in 3
    // of 6 runs). No tools while writing means that cannot happen.
    const cookie = await makeUser('ai-review-tooling');
    await optIn(cookie);
    await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(reviewBody());

    type Opts = {
      tools?: Array<{ definition: { name: string } }>;
      answerMarker?: string;
      endMarker?: string;
    };
    // 3rd argument is `onDelta`, 5th is the options bag the route builds.
    const calls = mockState.generate.mock.calls;
    expect(calls).toHaveLength(2);
    const [research, writing] = calls as [
      [string, string, undefined, unknown, Opts],
      [string, string, (t: string) => void, unknown, Opts],
    ];

    // Pass 1: tools, and NOT streamed — the reader never sees research.
    expect(research[4]?.tools?.map((t) => t.definition.name)).toEqual(['lookup_cards']);
    expect(research[2]).toBeUndefined();
    expect(research[4]?.answerMarker).toBeUndefined();

    // Pass 2: no tools, streamed, gated at both ends.
    const { WEAKNESS_MARK, END_MARK, DECK_REVIEW_RESEARCH_PROMPT, DECK_REVIEW_SYSTEM_PROMPT } =
      await import('../ai/deck-review');
    expect(writing[4]?.tools).toBeUndefined();
    expect(typeof writing[2]).toBe('function');
    expect(writing[4]?.answerMarker).toBe(WEAKNESS_MARK);
    expect(writing[4]?.endMarker).toBe(END_MARK);

    // And each pass gets its own prompt.
    expect(research[0]).toBe(DECK_REVIEW_RESEARCH_PROMPT);
    expect(writing[0]).toBe(DECK_REVIEW_SYSTEM_PROMPT);
  });

  it("carries the research pass's CARDS into the writing pass, and its prose nowhere", async () => {
    const cookie = await makeUser('ai-review-handoff');
    await optIn(cookie);
    mockState.generate.mockImplementation(
      async (
        _system: string,
        _user: string,
        onDelta?: (t: string) => void,
        _signal?: AbortSignal,
        options?: { tools?: unknown[] }
      ) => {
        if (options?.tools?.length) {
          return {
            content: 'Let me search for artifact removal. Good, that worked.',
            inputTokens: 500,
            outputTokens: 100,
            fetched: [
              { name: 'Anguished Unmaking', typeLine: 'Instant', oracleText: 'Exile target…' },
            ],
          };
        }
        onDelta?.(REVIEW_TEXT);
        return { content: REVIEW_TEXT, inputTokens: 1000, outputTokens: 200, fetched: [] };
      }
    );
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());

    const writingUserMessage = mockState.generate.mock.calls.at(-1)?.[1] as string;
    expect(writingUserMessage).toContain('Anguished Unmaking');
    expect(writingUserMessage).toContain('Cards you looked up');
    // The research pass's PROSE is discarded wholesale — it is the narration
    // the gate used to have to detect, and it reaches neither the writing
    // pass's message nor the reader.
    expect(writingUserMessage).not.toContain('Let me search');
    expect(res.text).not.toContain('Let me search');

    // Pass 2 has no tools, so the allowlist has to come from pass 1.
    expect(parseStream(res.text).done).toMatchObject({ fetched: ['Anguished Unmaking'] });
  });

  it('still delivers the review when it cites a card it never looked up', async () => {
    // The grounding check is a signal, not a filter: cutting a name out of
    // prose mangles the sentence, so an unverified citation is logged and the
    // reading is still delivered. This pins that it cannot throw after the
    // headers are already out — which is exactly how it broke once.
    const cookie = await makeUser('ai-review-unverified');
    await optIn(cookie);
    const prose = 'Your deck wants an answer. Add Tropical Island for fixing.';
    mockState.generate.mockImplementation(
      async (_s: string, _u: string, onDelta?: (t: string) => void) => {
        onDelta?.(prose);
        return { content: prose, inputTokens: 10, outputTokens: 10, fetched: [] };
      }
    );

    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());

    expect(res.status).toBe(200);
    expect(parseStream(res.text).done).toMatchObject({ content: prose });
  });
});

describe('review scope (T112)', () => {
  it('restricts the research search when the deck scope is owned', async () => {
    const cookie = await makeUser('ai-review-scope');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: REVIEW_TEXT,
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody({ scope: 'owned' }));
    expect(res.status).toBe(200);
    // Call 0 is the research pass (the one with tools).
    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).toMatch(/ALREADY OWNS/);
  });

  it('caps the research search by price when the deck scope is budget', async () => {
    const cookie = await makeUser('ai-review-scope-budget');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: REVIEW_TEXT,
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody({ scope: 'budget' }));
    expect(res.status).toBe(200);
    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).toMatch(/at most \$5 USD/);
    expect(options.tools[0].definition.description).not.toMatch(/ALREADY OWNS/);
  });

  it('caps in EUR when the player prices in EUR', async () => {
    const cookie = await makeUser('ai-review-scope-budget-eur');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: REVIEW_TEXT,
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const res = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody({ scope: 'budget', currency: 'eur' }));
    expect(res.status).toBe(200);
    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).toMatch(/at most €5 EUR/);
  });
});

describe('POST /api/ai/deck-refine', () => {
  const PROSE = 'Your deck grinds value out of the graveyard.';

  beforeEach(() => {
    mockState.generate.mockImplementation(
      async (_s: string, _u: string, onDelta?: (t: string) => void) => {
        const raw = refineReply(PROSE, [
          { add: 'Eternal Witness', cut: 'Sol Ring', why: 'Recursion beats a rock here.' },
        ]);
        onDelta?.(raw);
        return { content: raw, inputTokens: 500, outputTokens: 120, fetched: [] };
      }
    );
  });

  it('403s without server-side opt-in, exactly like the review', async () => {
    const cookie = await makeUser('ai-refine-noconsent');
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());
    expect(res.status).toBe(403);
    expect(mockState.generate).not.toHaveBeenCalled();
  });

  it('rejects a body with no pool field (400)', async () => {
    const cookie = await makeUser('ai-refine-nopool');
    await optIn(cookie);
    const body = refineBody();
    delete body.pool;
    const res = await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(body);
    expect(res.status).toBe(400);
  });

  it('returns verified tweaks and streams only the prose', async () => {
    const cookie = await makeUser('ai-refine-happy');
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());

    expect(res.status).toBe(200);
    const stream = parseStream(res.text);
    expect(stream.streamed).not.toContain('TWEAKS');
    expect(stream.done).toMatchObject({
      content: PROSE,
      cached: false,
      tweaks: [{ add: 'Eternal Witness', cut: 'Sol Ring', why: 'Recursion beats a rock here.' }],
    });
  });

  it('DROPS a card the pool never offered — the server is the last gate', async () => {
    // The prompt says don't invent; this asserts the route doesn't trust it.
    const cookie = await makeUser('ai-refine-invented');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => {
      const raw = refineReply(PROSE, [
        { add: 'Mana Crypt', cut: 'Sol Ring', why: 'Fast mana is fast.' },
        { add: 'Viscera Seer', cut: null, why: 'A free sac outlet this deck lacks.' },
      ]);
      // Deliberately NO `fetched` key. The grounding audit runs after the 200
      // and the first deltas are out, so it has to survive a generation that
      // lacks one — a throw there truncates the answer instead of erroring.
      return { content: raw, inputTokens: 1, outputTokens: 1 };
    });
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());

    const done = parseStream(res.text).done as { tweaks: { add: string }[] };
    expect(done.tweaks.map((t) => t.add)).toEqual(['Viscera Seer']);
  });

  it('never applies a swap that cuts an engine piece named in analysis.engines', async () => {
    const cookie = await makeUser('ai-refine-engine-cut');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, [
        { add: 'Eternal Witness', cut: 'Sol Ring', why: 'Recursion beats a rock here.' },
        { add: 'Viscera Seer', cut: 'Swamp', why: 'A free sac outlet.' },
      ]),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(
        refineBody({
          analysis: {
            totalNonCommander: 13,
            engines: [{ label: 'Artifacts', sources: ['Sol Ring'], payoffs: ['Meren'] }],
          },
        })
      );
    expect(res.status).toBe(200);
    const done = parseStream(res.text).done as { tweaks: { add: string; cut: string }[] };
    expect(done.tweaks).toEqual([{ add: 'Viscera Seer', cut: 'Swamp', why: 'A free sac outlet.' }]);
  });

  it('under the budget scope, trims the engine pool to cards under the ceiling', async () => {
    // The pool is the one source the parser trusts without the resolver, so
    // the route has to trim it itself; the tool's own restriction is pinned
    // on the review above.
    const cookie = await makeUser('ai-refine-budget');
    await optIn(cookie);
    const cache = getScryfallCache();
    const printing = (id: string, name: string, usd: string, eur: string | null = null) => {
      cache.setMany([
        {
          id,
          oracle_id: `${id}-oracle`,
          name,
          rarity: 'common',
          set: 'tst',
          set_name: 'Test',
          collector_number: '1',
          prices: { usd, eur },
        },
      ]);
      cache.setLookups([{ key: `ns:${name.toLowerCase()}|tst`, scryfallId: id }]);
    };
    printing('ai-refine-budget-cheap', 'Ai Refine Budget Cheap Rock', '0.25');
    // Cheap on Cardmarket, dear on TCGplayer: in under EUR, out under USD.
    printing('ai-refine-budget-pricey', 'Ai Refine Budget Pricey Rock', '40.00', '2.00');
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, [
        { add: 'Ai Refine Budget Cheap Rock', cut: null, why: 'Ramp on a budget.' },
        { add: 'Ai Refine Budget Pricey Rock', cut: null, why: 'Ramp at any price.' },
      ]),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(
        refineBody({
          scope: 'budget',
          pool: [
            { name: 'Ai Refine Budget Cheap Rock', oracleId: 'p-1', qty: 1 },
            { name: 'Ai Refine Budget Pricey Rock', oracleId: 'p-2', qty: 1 },
          ],
        })
      );
    expect(res.status).toBe(200);
    const done = parseStream(res.text).done as { tweaks: { add: string }[] };
    expect(done.tweaks.map((t) => t.add)).toEqual(['Ai Refine Budget Cheap Rock']);
    // What the model was shown: the trimmed pool under the budget header.
    const userMessage = mockState.generate.mock.calls[0][1] as string;
    expect(userMessage).toMatch(/ENGINE SUGGESTIONS — BUDGET/);
    expect(userMessage).toContain('Ai Refine Budget Cheap Rock');
    expect(userMessage).not.toContain('Ai Refine Budget Pricey Rock');

    // The same deck priced in EUR keeps the Cardmarket-cheap card and drops
    // the one with no EUR price at all — a USD price is never a stand-in.
    mockState.generate.mockClear();
    const eur = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(
        refineBody({
          scope: 'budget',
          currency: 'eur',
          pool: [
            { name: 'Ai Refine Budget Cheap Rock', oracleId: 'p-1', qty: 1 },
            { name: 'Ai Refine Budget Pricey Rock', oracleId: 'p-2', qty: 1 },
          ],
        })
      );
    expect(eur.status).toBe(200);
    const eurDone = parseStream(eur.text).done as { tweaks: { add: string }[]; cached: boolean };
    expect(eurDone.cached).toBe(false); // a EUR budget is its own key
    expect(eurDone.tweaks.map((t) => t.add)).toEqual(['Ai Refine Budget Pricey Rock']);
    expect(mockState.generate.mock.calls[0][1] as string).toMatch(/BUDGET .*under €5/);
  });

  it('hands the model a card-search tool and an answer marker', async () => {
    const cookie = await makeUser('ai-refine-tools');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(refineBody());

    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { name: string } }[];
      answerMarker: string;
    };
    expect(options.tools.map((t) => t.definition.name)).toEqual(['lookup_cards', 'check_bracket']);
    // Without a marker the model's research narration would stream into the
    // strategy read and be stored as part of it.
    expect(options.answerMarker).toBe('---STRATEGY---');
  });

  // E381: the client used to send a partner pair as one "A // B" commander
  // string, which is no card's name, so check_bracket counted NEITHER
  // commander (no Game Changer, no commander combo). A partner that is a Game
  // Changer is the smallest case that shows it.
  it('check_bracket counts BOTH partner commanders', async () => {
    const cookie = await makeUser('ai-refine-partner');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const body = refineBody({ commander: 'Ai Partner Lead', partnerCommander: 'Rhystic Study' });
    const first = await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(body);
    expect(first.status).toBe(200);

    const options = mockState.generate.mock.calls[0][4] as {
      tools: {
        definition: { name: string };
        run(i: Record<string, unknown>): Promise<{ text: string }>;
      }[];
    };
    const check = options.tools.find((t) => t.definition.name === 'check_bracket');
    const { text } = await check!.run({ add: 'Forest' });
    // Without the partner the deck has no floor at all and reads Bracket 2.
    expect(text).toMatch(/Before: bracket 3, floors: .*Game Changer/);
    // The model reads the pair exactly as it did before the field existed.
    expect(mockState.generate.mock.calls[0][1] as string).toContain(
      'Commander: Ai Partner Lead // Rhystic Study'
    );

    // …and so does the cache: an old client's joined string is the same
    // question, so it replays the stored reading instead of spending a new one.
    const old = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody({ commander: 'Ai Partner Lead // Rhystic Study' }));
    expect((parseStream(old.text).done as { cached: boolean }).cached).toBe(true);
  });

  it('rejects a partnerCommander that is not a card name', async () => {
    const cookie = await makeUser('ai-refine-partner-bad');
    await optIn(cookie);
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody({ partnerCommander: 42 }));
    expect(res.status).toBe(400);
  });

  it('WITHHOLDS check_bracket when the tag data is missing', async () => {
    // A TagLookup over absent data does not throw — it answers "no" to every
    // predicate, so the estimator reports no mass land denial, no extra turns
    // and no roles, and hands back a confidently too-low bracket. Not offering
    // the tool is the only safe failure.
    const { getTagLookup, __resetTagLookup } = await import('../ai/tags');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-for-this-test');
    __resetTagLookup();
    expect(getTagLookup()).toBeNull();

    const cookie = await makeUser('ai-refine-notags');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(refineBody());

    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { name: string } }[];
    };
    expect(options.tools.map((t) => t.definition.name)).toEqual(['lookup_cards']);

    cwdSpy.mockRestore();
    __resetTagLookup();
  });

  it('restricts the search to the collection on an owned-only build', async () => {
    // The guarantee used to live in the client's pool filter. Now that the
    // model searches for its own candidates, the server has to carry it.
    const cookie = await makeUser('ai-refine-owned');
    await optIn(cookie);
    const { getPool } = await import('../db');
    const { rows } = await getPool().query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      ['ai-refine-owned']
    );
    await getPool().query(
      `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at)
       VALUES ($1, 'c1', 'i1', $2::jsonb, 1, 1)`,
      [rows[0].id, JSON.stringify({ name: 'Eternal Witness', oracleId: 'o-ew' })]
    );
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));

    await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody({ ownedOnly: true }));

    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).toMatch(/ALREADY OWNS/);
  });

  it("under the unowned scope, an owned card leaves the pool and can't come back as a tweak", async () => {
    const cookie = await makeUser('ai-refine-scope-unowned');
    await optIn(cookie);
    const { getPool } = await import('../db');
    const { rows } = await getPool().query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      ['ai-refine-scope-unowned']
    );
    await getPool().query(
      `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at)
       VALUES ($1, 'c1', 'i1', $2::jsonb, 1, 1)`,
      [rows[0].id, JSON.stringify({ name: 'Eternal Witness', oracleId: 'o-ew' })]
    );
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, [
        { add: 'Eternal Witness', cut: null, why: 'Recursion.' },
        { add: 'Viscera Seer', cut: null, why: 'A free sac outlet.' },
      ]),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));

    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody({ scope: 'unowned' }));

    expect(res.status).toBe(200);
    const done = parseStream(res.text).done as { tweaks: { add: string }[] };
    expect(done.tweaks.map((t) => t.add)).toEqual(['Viscera Seer']);
    const userMessage = mockState.generate.mock.calls[0][1] as string;
    expect(userMessage).toMatch(/ENGINE SUGGESTIONS — NOT OWNED/);
    expect(userMessage).not.toContain('Eternal Witness');
    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).toMatch(/does NOT own/);
  });

  it('under the uncommitted scope, drops a name whose every owned copy sits in another deck', async () => {
    const cookie = await makeUser('ai-refine-uncommitted');
    await optIn(cookie);
    const { getPool } = await import('../db');
    const { loadOwnedNames } = await import('../ai/owned-names');
    const { rows } = await getPool().query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      ['ai-refine-uncommitted']
    );
    const userId = rows[0].id;
    // One row per physical copy (the sync model): two Sol Rings, a Swamp, a
    // Viscera Seer, two Rhystic Studies, a Mana Crypt and an Arcane Signet.
    const cardRows: Array<[string, string]> = [
      ['ring-1', 'Sol Ring'],
      ['ring-2', 'Sol Ring'],
      ['swamp-1', 'Swamp'],
      ['seer-1', 'Viscera Seer'],
      ['study-1', 'Rhystic Study'],
      ['study-2', 'Rhystic Study'],
      ['crypt-1', 'Mana Crypt'],
      ['signet-1', 'Arcane Signet'],
    ];
    for (const [id, name] of cardRows) {
      await getPool().query(
        `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at)
         VALUES ($1, $2, 'i1', $3, 1, 0)`,
        [userId, id, JSON.stringify({ name })]
      );
    }
    // Another deck claims ONE Sol Ring (mainboard), the Viscera Seer (as its
    // commander), a Rhystic Study (sideboard) and the Mana Crypt (considering);
    // a physical cube claims the Arcane Signet. This deck's own claims must not
    // count against it, and a draft cube claims nothing.
    const deck = (id: string, data: object) =>
      getPool().query(
        `INSERT INTO user_decks (user_id, id, data, rev, updated_at) VALUES ($1, $2, $3, 1, 0)`,
        [userId, id, JSON.stringify(data)]
      );
    const slot = (name: string, allocatedCopyId: string) => ({ card: { name }, allocatedCopyId });
    await deck('other', {
      cards: [slot('Sol Ring', 'ring-1')],
      commander: { name: 'Viscera Seer' },
      commanderAllocatedCopyId: 'seer-1',
      sideboard: [slot('Rhystic Study', 'study-1')],
      considering: [slot('Mana Crypt', 'crypt-1')],
    });
    await deck('deck-1', { cards: [slot('Swamp', 'swamp-1')], commander: null });
    for (const [id, isPhysical, copy] of [
      ['cube-1', true, 'signet-1'],
      ['cube-2', false, 'swamp-1'],
    ] as const) {
      await getPool().query(
        `INSERT INTO user_cubes (user_id, id, data, rev, updated_at) VALUES ($1, $2, $3, 1, 0)`,
        [userId, id, JSON.stringify({ isPhysical, picks: [slot('X', copy)] })]
      );
    }

    expect((await loadOwnedNames(userId, 'owned', 'deck-1')).sort()).toEqual([
      'Arcane Signet',
      'Mana Crypt',
      'Rhystic Study',
      'Sol Ring',
      'Swamp',
      'Viscera Seer',
    ]);
    // Sol Ring and Rhystic Study survive (a second copy is free); Swamp survives
    // (this deck's own copy is not "another deck", and a draft cube claims
    // nothing). Viscera Seer (commander), Mana Crypt (considering) and Arcane
    // Signet (physical cube) have no available copy left.
    expect((await loadOwnedNames(userId, 'uncommitted', 'deck-1')).sort()).toEqual([
      'Rhystic Study',
      'Sol Ring',
      'Swamp',
    ]);

    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody({ scope: 'uncommitted' }));
    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).toMatch(/ALREADY OWNS/);
    expect(mockState.generate.mock.calls[0][1]).toMatch(/not already in another of their decks/);
  });

  it('leaves the search unrestricted when the build is not owned-only', async () => {
    const cookie = await makeUser('ai-refine-unowned');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(refineBody());

    const options = mockState.generate.mock.calls[0][4] as {
      tools: { definition: { description: string } }[];
    };
    expect(options.tools[0].definition.description).not.toMatch(/ALREADY OWNS/);
  });

  it('shares the daily quota pool with the review', async () => {
    const cookie = await makeUser('ai-refine-quota');
    await optIn(cookie);
    const { getPool } = await import('../db');
    await getPool().query('UPDATE users SET ai_daily_limit = 1 WHERE username = $1', [
      'ai-refine-quota',
    ]);
    // Spend the single allowance on a REVIEW…
    const first = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    expect(first.status).toBe(200);
    // …and the refine is capped by it, not given its own budget.
    const over = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());
    expect(over.status).toBe(429);
  });

  it('re-verifies a cache hit against the pool it is replayed for', async () => {
    // The stored row holds the RAW reply, so replaying it under a pool that no
    // longer offers the card must drop the tweak rather than resurrect it.
    const cookie = await makeUser('ai-refine-cache');
    await optIn(cookie);
    const body = refineBody();
    const first = await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(body);
    expect((parseStream(first.text).done as { tweaks: unknown[] }).tweaks).toHaveLength(1);

    const second = await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(body);
    const done = parseStream(second.text).done as { cached: boolean; tweaks: { add: string }[] };
    expect(done.cached).toBe(true);
    expect(done.tweaks.map((t) => t.add)).toEqual(['Eternal Witness']);
    expect(mockState.generate).toHaveBeenCalledTimes(1);
  });

  it('is stored under its own feature key, not the review’s', async () => {
    const cookie = await makeUser('ai-refine-feature');
    await optIn(cookie);
    await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(refineBody());
    const { getPool } = await import('../db');
    const rows = await getPool().query<{ feature: string }>(
      `SELECT r.feature FROM ai_reviews r JOIN users u ON u.id = r.user_id
        WHERE u.username = $1`,
      ['ai-refine-feature']
    );
    expect(rows.rows.map((r) => r.feature)).toEqual(['deck-refine']);
  });
});

describe('grounding verdict on the stored row', () => {
  const PROSE = 'Your deck grinds value out of the graveyard.';

  /** Seed one printing, optionally as if it had been cached `ageDays` ago. */
  function seedCard(id: string, name: string, oracleText: string, ageDays = 0): void {
    const cache = getScryfallCache();
    const at = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - ageDays * 86_400_000);
    try {
      cache.setMany([
        {
          id,
          oracle_id: `${id}-oracle`,
          name,
          rarity: 'common',
          set: 'tst',
          set_name: 'Test',
          collector_number: '1',
          oracle_text: oracleText,
          prices: { usd: '1.00', eur: null },
        },
      ]);
      cache.setLookups([{ key: `ns:${name.toLowerCase()}|tst`, scryfallId: id }]);
    } finally {
      at.mockRestore();
    }
  }

  async function storedGrounding(username: string): Promise<Record<string, unknown> | null> {
    const { getPool } = await import('../db');
    const rows = await getPool().query<{ grounding: Record<string, unknown> | null }>(
      `SELECT r.grounding FROM ai_reviews r JOIN users u ON u.id = r.user_id WHERE u.username = $1`,
      [username]
    );
    expect(rows.rows).toHaveLength(1);
    return rows.rows[0].grounding;
  }

  it('stores a refine reading’s verdict, flagging a "why" that names a card the deck does not run', async () => {
    // The Zo-Zu refine (2026-10-14) argued from "your Young Pyromancer", a card
    // not in the list. Refine's prose had no citation check at all, and every
    // other check only logged, so nothing could find that reading afterwards.
    seedCard(
      'grounding-pyro',
      'Grounding Test Pyromancer',
      'Whenever you cast a spell, make a token.'
    );
    const cookie = await makeUser('ai-grounding-refine');
    await optIn(cookie);
    mockState.generate.mockImplementation(async () => ({
      content: refineReply(PROSE, [
        {
          add: 'Eternal Witness',
          cut: 'Sol Ring',
          why: 'Feeds your Grounding Test Pyromancer more spells.',
        },
        { add: 'Mana Crypt', cut: null, why: 'Fast mana.' },
      ]),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));

    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());
    expect(res.status).toBe(200);

    expect(await storedGrounding('ai-grounding-refine')).toEqual({
      unverified: ['Grounding Test Pyromancer'],
      recalled: [],
      rejected: ['Mana Crypt'],
      protectedCuts: [],
      suggestedAsDeck: [],
    });
  });

  it('stores a review’s unverified citations', async () => {
    seedCard('grounding-island', 'Grounding Test Island', 'Tap: add one mana.');
    const cookie = await makeUser('ai-grounding-review');
    await optIn(cookie);
    const prose = 'Add Grounding Test Island for fixing.';
    mockState.generate.mockImplementation(
      async (_s: string, _u: string, onDelta?: (t: string) => void) => {
        onDelta?.(prose);
        return { content: prose, inputTokens: 1, outputTokens: 1, fetched: [] };
      }
    );

    await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(reviewBody());

    expect(await storedGrounding('ai-grounding-review')).toEqual({
      unverified: ['Grounding Test Island'],
    });
  });

  it('gives the model the oracle text of a deck card cached more than a week ago', async () => {
    // The 7-day cache TTL is for prices. Under it, a deck card nobody had
    // looked up for a week reached the prompt with no rules text, and the
    // model judged it by its name.
    seedCard(
      'grounding-stale',
      'Grounding Stale Squelcher',
      'Spells you control can’t be countered.',
      30
    );
    const cookie = await makeUser('ai-grounding-stale');
    await optIn(cookie);
    const deck = {
      cards: [
        { name: 'Grounding Stale Squelcher', oracleId: 'o-s', qty: 1 },
        { name: 'Swamp', oracleId: 'o-2', qty: 12 },
      ],
    };

    await request(app).post('/api/ai/deck-refine').set('Cookie', cookie).send(refineBody(deck));
    await request(app).post('/api/ai/deck-review').set('Cookie', cookie).send(reviewBody(deck));

    const messages = mockState.generate.mock.calls.map((c) => c[1] as string);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    for (const m of messages) expect(m).toContain('Spells you control can’t be countered.');
  });
});

describe('per-feature model', () => {
  // Refine moved to its own tier (E1017) while the review stays on AI_MODEL
  // until its own gate passes. A refine call that silently fell back to
  // AI_MODEL would run, store and bill the wrong model.
  async function storedModels(username: string): Promise<Record<string, string>> {
    const { getPool } = await import('../db');
    const rows = await getPool().query<{ feature: string; model: string }>(
      `SELECT r.feature, r.model FROM ai_reviews r JOIN users u ON u.id = r.user_id
        WHERE u.username = $1`,
      [username]
    );
    return Object.fromEntries(rows.rows.map((r) => [r.feature, r.model]));
  }

  it('runs, stores and reports refine on REFINE_MODEL and the review on AI_MODEL', async () => {
    const cookie = await makeUser('ai-model-split');
    await optIn(cookie);

    const review = await request(app)
      .post('/api/ai/deck-review')
      .set('Cookie', cookie)
      .send(reviewBody());
    const reviewCalls = mockState.generate.mock.calls.length;
    mockState.generate.mockImplementation(async () => ({
      content: refineReply('Your deck grinds.', []),
      inputTokens: 1,
      outputTokens: 1,
      fetched: [],
    }));
    const refine = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());

    const options = mockState.generate.mock.calls.map(
      (c) => (c[4] ?? {}) as { model?: string; thinking?: string }
    );
    // Both review passes run the shipped review configuration: its model, thinking off.
    expect(reviewCalls).toBe(2);
    for (const o of options.slice(0, reviewCalls)) {
      expect(o).toMatchObject({ model: 'test-model', thinking: 'off' });
    }
    // Refine keeps its own model and the model's default thinking.
    expect(options.slice(reviewCalls).map((o) => [o.model, o.thinking])).toEqual([
      ['test-refine-model', undefined],
    ]);
    expect(parseStream(review.text).done).toMatchObject({ model: 'test-model' });
    expect(parseStream(refine.text).done).toMatchObject({ model: 'test-refine-model' });
    expect(await storedModels('ai-model-split')).toEqual({
      'deck-review': 'test-model',
      'deck-refine': 'test-refine-model',
    });
  });
});
