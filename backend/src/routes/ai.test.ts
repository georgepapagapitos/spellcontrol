import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';

// Mock the thin Anthropic client so no test ever touches the network. The
// route reads `aiEnabled()` per request, so the flag can flip mid-suite.
const mockState = {
  enabled: true,
  generate: vi.fn(),
};
vi.mock('../ai/client', () => ({
  AI_MODEL: 'test-model',
  aiEnabled: () => mockState.enabled,
  generateReview: (system: string, user: string, onDelta?: (t: string) => void) =>
    mockState.generate(system, user, onDelta),
}));

import { createTestEnv, extractSessionCookie } from '../test-helpers';

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
  mockState.generate.mockImplementation(
    async (_system: string, _user: string, onDelta?: (t: string) => void) => {
      onDelta?.('Your deck is ');
      onDelta?.('a fine deck.');
      return { content: REVIEW_TEXT, inputTokens: 1000, outputTokens: 200 };
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
    .send({ username, password: 'correct horse battery' });
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

  it('lets an admin through end to end', async () => {
    process.env.ADMIN_USERNAMES = 'ai-gate-admin';
    try {
      const cookie = await makeUser('ai-gate-admin');
      await optIn(cookie);
      const res = await request(app)
        .post('/api/ai/deck-review')
        .set('Cookie', cookie)
        .send(reviewBody());
      expect(res.status).toBe(200);
      expect(parseStream(res.text).done).toMatchObject({ content: REVIEW_TEXT });
    } finally {
      delete process.env.ADMIN_USERNAMES;
    }
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
      usage: { inputTokens: 1000, outputTokens: 200 },
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
    // The cache hit never touched the model.
    expect(mockState.generate).toHaveBeenCalledTimes(1);

    const status = await request(app).get('/api/ai/status').set('Cookie', cookie);
    expect(status.body.used).toBe(1);
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
    expect(mockState.generate).toHaveBeenCalledTimes(2);
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
        return { content: 'Prose here.\n\n---TWEAKS---\n[]', inputTokens: 1, outputTokens: 1 };
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

  it('reports a MID-stream failure in-band, stores nothing, spends nothing', async () => {
    const cookie = await makeUser('ai-review-midfail');
    await optIn(cookie);
    // Deltas go out, then the model dies — the 200 status is already spent, so
    // the failure has to ride the stream itself.
    mockState.generate.mockImplementation(
      async (_system: string, _user: string, onDelta?: (t: string) => void) => {
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
        return { content: raw, inputTokens: 500, outputTokens: 120 };
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
      return { content: raw, inputTokens: 1, outputTokens: 1 };
    });
    const res = await request(app)
      .post('/api/ai/deck-refine')
      .set('Cookie', cookie)
      .send(refineBody());

    const done = parseStream(res.text).done as { tweaks: { add: string }[] };
    expect(done.tweaks.map((t) => t.add)).toEqual(['Viscera Seer']);
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
