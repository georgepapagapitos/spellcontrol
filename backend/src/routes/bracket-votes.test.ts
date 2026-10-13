import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import { isRateLimiter } from '../route-utils';
import { bracketVotesRouter, parseBracketVote } from './bracket-votes';

let app: Server;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

let seq = 0;
async function makeUser(prefix = 'bv') {
  seq += 1;
  const username = `${prefix}-${seq}`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, username, id: me.body.user.id as string };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const vote = (over: Record<string, unknown> = {}) => ({
  deckId: 'deck-1',
  deckHash: HASH_A,
  estimatorVersion: 1,
  estimatedBracket: 2,
  signals: { softScore: 30, hardFloors: [], breakdown: { gameChangerCount: 0 } },
  statedBracket: 3,
  vote: 'disagree',
  note: 'We play it at 3.',
  ...over,
});

const put = (cookie: string, body: unknown) =>
  request(app)
    .put('/api/bracket-votes')
    .set('Cookie', cookie)
    .send(body as object);

describe('bracket votes', () => {
  it('requires a session to read or write', async () => {
    expect((await request(app).put('/api/bracket-votes').send(vote())).status).toBe(401);
    const get = await request(app).get(`/api/bracket-votes?deckId=deck-1&deckHash=${HASH_A}`);
    expect(get.status).toBe(401);
  });

  it('carries the rate limiter on both routes', () => {
    type Layer = { route?: { stack: Array<{ handle: unknown }> } };
    const routes = (bracketVotesRouter as unknown as { stack: Layer[] }).stack.filter(
      (l) => l.route
    );
    expect(routes).toHaveLength(2);
    for (const l of routes) {
      expect(l.route!.stack.some((h) => isRateLimiter(h.handle))).toBe(true);
    }
  });

  it('rejects malformed votes', async () => {
    const { cookie } = await makeUser();
    const bad: Array<Record<string, unknown>> = [
      { deckId: '' },
      { deckId: 'x'.repeat(101) },
      { deckHash: 'nope' },
      { estimatorVersion: 0 },
      { estimatedBracket: 6 },
      { statedBracket: 1.5 },
      { vote: 'maybe' },
      { vote: 'agree' }, // stated 3 differs from estimated 2
      { vote: 'disagree', statedBracket: 2 },
      { signals: [] },
      { signals: { big: 'x'.repeat(70_000) } },
      { note: 'x'.repeat(281) },
      { note: 42 },
    ];
    for (const over of bad) {
      const res = await put(cookie, vote(over));
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect((await put(cookie, 'nope')).status).toBe(400);
    const get = await request(app).get('/api/bracket-votes?deckId=deck-1').set('Cookie', cookie);
    expect(get.status).toBe(400);
  });

  it('records a vote, reads it back, and updates it in place on a re-vote', async () => {
    const { cookie, id } = await makeUser();
    const first = await put(cookie, vote());
    expect(first.status).toBe(200);
    expect(first.body.vote).toMatchObject({
      vote: 'disagree',
      statedBracket: 3,
      estimatedBracket: 2,
      note: 'We play it at 3.',
    });
    const again = await put(cookie, vote({ vote: 'agree', statedBracket: 2, note: '  ' }));
    expect(again.status).toBe(200);
    expect(again.body.vote).toMatchObject({ vote: 'agree', note: '' });

    const { rows } = await pool.query(`SELECT * FROM bracket_votes WHERE user_id = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deck_id: 'deck-1',
      deck_hash: HASH_A,
      estimator_version: 1,
      estimated_bracket: 2,
      stated_bracket: 2,
      vote: 'agree',
    });
    expect(rows[0].signals.softScore).toBe(30);

    const get = await request(app)
      .get(`/api/bracket-votes?deckId=deck-1&deckHash=${HASH_A}`)
      .set('Cookie', cookie);
    expect(get.body.vote).toMatchObject({ vote: 'agree' });
  });

  it('starts a new row when the deck content changes, and keeps votes per user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await put(a.cookie, vote());
    await put(a.cookie, vote({ deckHash: HASH_B }));
    await put(b.cookie, vote());
    const mine = await pool.query(`SELECT 1 FROM bracket_votes WHERE user_id = $1`, [a.id]);
    expect(mine.rowCount).toBe(2);
    const get = await request(app)
      .get(`/api/bracket-votes?deckId=deck-1&deckHash=${'c'.repeat(64)}`)
      .set('Cookie', a.cookie);
    expect(get.body.vote).toBeNull();
    // b never sees a's vote on a list b has not voted on.
    const theirs = await request(app)
      .get(`/api/bracket-votes?deckId=deck-1&deckHash=${HASH_B}`)
      .set('Cookie', b.cookie);
    expect(theirs.body.vote).toBeNull();
  });

  it('strips control characters from the note', () => {
    const parsed = parseBracketVote(vote({ note: 'a\u0000b\nc' }));
    expect(typeof parsed).toBe('object');
    if (typeof parsed === 'object') expect(parsed.note).toBe('a b c');
  });

  it('refuses a vote on a deck the account deleted', async () => {
    const { cookie, id } = await makeUser();
    await pool.query(
      `INSERT INTO user_decks (user_id, id, data, rev, deleted_at, updated_at)
       VALUES ($1, 'gone', NULL, 1, 1, 1)`,
      [id]
    );
    expect((await put(cookie, vote({ deckId: 'gone' }))).status).toBe(404);
  });

  it('deletes the labels with the deck', async () => {
    const { cookie, id } = await makeUser();
    await put(cookie, vote({ deckId: 'keep' }));
    await put(cookie, vote({ deckId: 'drop' }));
    const sync = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ upserts: [{ kind: 'deck', id: 'drop', data: { id: 'drop', name: 'Drop' } }] });
    expect(sync.status).toBe(200);
    const del = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ deletions: [{ kind: 'deck', id: 'drop' }] });
    expect(del.status).toBe(200);
    // The sync hook runs after the response, so give it a moment.
    let left: string[] = [];
    for (let i = 0; i < 40; i++) {
      const { rows } = await pool.query<{ deck_id: string }>(
        `SELECT deck_id FROM bracket_votes WHERE user_id = $1`,
        [id]
      );
      left = rows.map((r) => r.deck_id);
      if (left.length === 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(left).toEqual(['keep']);
  });

  it('deletes the labels with the account', async () => {
    const { cookie, id } = await makeUser();
    await put(cookie, vote());
    const del = await request(app).delete('/api/auth/me').set('Cookie', cookie);
    expect(del.status).toBe(200);
    const { rowCount } = await pool.query(`SELECT 1 FROM bracket_votes WHERE user_id = $1`, [id]);
    expect(rowCount).toBe(0);
  });
});

describe('GET /api/admin/bracket-votes', () => {
  async function makeAdmin() {
    const u = await makeUser('bvadmin');
    await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = ${u.username}`);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: u.username, password: 'correct horse battery' });
    return extractSessionCookie(login.headers['set-cookie'])!;
  }

  it('is admin only', async () => {
    const { cookie } = await makeUser();
    expect((await request(app).get('/api/admin/bracket-votes')).status).toBe(401);
    const res = await request(app).get('/api/admin/bracket-votes').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('lists labelled decks, disagreements first, as JSON or CSV', async () => {
    const owner = await makeUser('bvowner');
    await put(
      owner.cookie,
      vote({ deckId: 'csv-agree', vote: 'agree', statedBracket: 2, note: '' })
    );
    await put(owner.cookie, vote({ deckId: 'csv-dis', note: '=HYPERLINK("x")' }));
    const admin = await makeAdmin();
    const json = await request(app).get('/api/admin/bracket-votes').set('Cookie', admin);
    expect(json.status).toBe(200);
    const mine = (
      json.body.votes as Array<{ username: string; deckId: string; vote: string }>
    ).filter((v) => v.username === owner.username);
    expect(mine.map((v) => v.deckId)).toEqual(['csv-dis', 'csv-agree']);
    const csv = await request(app).get('/api/admin/bracket-votes?format=csv').set('Cookie', admin);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toContain('estimatedBracket');
    // A note that starts like a formula is defanged.
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
