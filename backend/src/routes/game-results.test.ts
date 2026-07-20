import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { persistGameResult } from '../games/persist-result';
import type { GameState } from '../games/state';

let app: Express;
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

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function userId(username: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  return r.rows[0].id;
}

async function makeFriends(aId: string, bId: string): Promise<void> {
  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status, created_at, accepted_at)
     VALUES ($1, $2, 'accepted', 1, 2)`,
    [aId, bId]
  );
}

let resultSeq = 0;
/** Insert a canonical result directly, for read-route tests. */
async function insertResult(opts: {
  winnerUserId: string | null;
  participants: Array<{ userId: string | null; deckId?: string | null; deckName?: string | null }>;
}): Promise<string> {
  const sessionId = `res-${++resultSeq}`;
  const participants = opts.participants.map((p, i) => ({
    seat: i,
    userId: p.userId,
    username: null,
    name: `P${i}`,
    deckId: p.deckId ?? null,
    deckName: p.deckName ?? null,
    commander: null,
    colorIdentity: [],
    finalLife: 40,
    eliminated: false,
  }));
  await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_seat, winner_user_id,
        started_at, ended_at, duration_ms, participants, created_at)
     VALUES ($1, 'CODE', 'commander', 40, 0, $2, 1, 100, 99, $3, 100)`,
    [sessionId, opts.winnerUserId, JSON.stringify(participants)]
  );
  return sessionId;
}

/** Poll for a fire-and-forget result write (the PATCH handler doesn't await it). */
async function waitForResult(sessionId: string, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await pool.query(`SELECT 1 FROM game_results WHERE session_id = $1`, [sessionId]);
    if ((r.rowCount ?? 0) > 0) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

// ─── write hook (via the real games PATCH lifecycle) ──────────────────────────

describe('finish write hook', () => {
  async function playToFinish(hostName: string, joinName: string) {
    const host = await makeUser(hostName);
    const joiner = await makeUser(joinName);
    const created = await request(app)
      .post('/api/games')
      .set('Cookie', host)
      .send({ format: 'commander' });
    const code = created.body.game.code as string;
    const sessionId = created.body.game.id as string;

    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({ name: 'Bob' });
    const started = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({ baseVersion: joined.body.game.version, actions: [{ type: 'start' }] });
    return { host, joiner, code, sessionId, version: started.body.game.version };
  }

  it('writes a canonical record when an online game flips to finished', async () => {
    const { host, code, sessionId } = await playToFinish('grh-host', 'grh-join');
    const hostId = await userId('grh-host');

    const ended = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: (await request(app).get(`/api/games/${code}`).set('Cookie', host)).body.game
          .version,
        actions: [{ type: 'end', winnerSeat: 0 }],
      });
    expect(ended.body.game.status).toBe('finished');

    expect(await waitForResult(sessionId)).toBe(true);
    const row = await pool.query(`SELECT * FROM game_results WHERE session_id = $1`, [sessionId]);
    const r = row.rows[0];
    expect(r.winner_seat).toBe(0);
    expect(r.winner_user_id).toBe(hostId);
    expect(r.participants).toHaveLength(2);
    // username denormalized at write time
    expect(r.participants[0].username).toBe('grh-host');
  });

  it('writes no record until the game is finished', async () => {
    const { sessionId } = await playToFinish('grh-pending-host', 'grh-pending-join');
    // Game is 'active', not finished — no row.
    const row = await pool.query(`SELECT 1 FROM game_results WHERE session_id = $1`, [sessionId]);
    expect(row.rowCount).toBe(0);
  });

  it('is idempotent — re-persisting the same finished state inserts nothing new', async () => {
    const { sessionId } = await playToFinish('grh-idem-host', 'grh-idem-join');
    const row = await pool.query(`SELECT state FROM game_sessions WHERE id = $1`, [sessionId]);
    const state = {
      ...(row.rows[0].state as GameState),
      status: 'finished' as const,
      winnerSeat: 0,
    };

    await persistGameResult(state, pool);
    await persistGameResult(state, pool);
    const count = await pool.query(`SELECT COUNT(*) AS n FROM game_results WHERE session_id = $1`, [
      sessionId,
    ]);
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it('records a null winner for a draw (winnerSeat null)', async () => {
    const { sessionId } = await playToFinish('grh-draw-host', 'grh-draw-join');
    const row = await pool.query(`SELECT state FROM game_sessions WHERE id = $1`, [sessionId]);
    const state = {
      ...(row.rows[0].state as GameState),
      id: `${sessionId}-draw`,
      status: 'finished' as const,
      winnerSeat: null,
    };
    await persistGameResult(state, pool);
    const r = await pool.query(`SELECT winner_user_id FROM game_results WHERE session_id = $1`, [
      `${sessionId}-draw`,
    ]);
    expect(r.rows[0].winner_user_id).toBeNull();
  });
});

// ─── GET /api/game-results/leaderboard ────────────────────────────────────────

describe('GET /api/game-results/leaderboard', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/game-results/leaderboard');
    expect(res.status).toBe(401);
  });

  it('returns [] when the caller has no shared games', async () => {
    const alice = await makeUser('lb-empty-alice');
    const res = await request(app).get('/api/game-results/leaderboard').set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
  });

  it('aggregates W/L per friend over shared games, excluding non-friends', async () => {
    const alice = await makeUser('lb-alice');
    await makeUser('lb-bob');
    await makeUser('lb-carol');
    const aliceId = await userId('lb-alice');
    const bobId = await userId('lb-bob');
    const carolId = await userId('lb-carol');
    await makeFriends(aliceId, bobId); // alice–bob are friends; carol is not

    // Two games with bob: alice wins one, bob wins one.
    await insertResult({
      winnerUserId: aliceId,
      participants: [{ userId: aliceId }, { userId: bobId }],
    });
    await insertResult({
      winnerUserId: bobId,
      participants: [{ userId: aliceId }, { userId: bobId }],
    });
    // A game with carol (not a friend) — must be excluded.
    await insertResult({
      winnerUserId: aliceId,
      participants: [{ userId: aliceId }, { userId: carolId }],
    });

    const res = await request(app).get('/api/game-results/leaderboard').set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toHaveLength(1);
    const entry = res.body.leaderboard[0];
    expect(entry.friendUsername).toBe('lb-bob');
    expect(entry.friendDisplayName).toBeNull();
    expect(entry.gamesPlayed).toBe(2);
    expect(entry.callerWins).toBe(1);
    expect(entry.friendWins).toBe(1);
  });

  it('prefers the friend’s display name when set', async () => {
    const alice = await makeUser('lb-dn-alice');
    const bob = await makeUser('lb-dn-bob');
    const aliceId = await userId('lb-dn-alice');
    const bobId = await userId('lb-dn-bob');
    await makeFriends(aliceId, bobId);
    await request(app).patch('/api/auth/profile').set('Cookie', bob).send({ displayName: 'Bobby' });
    await insertResult({
      winnerUserId: aliceId,
      participants: [{ userId: aliceId }, { userId: bobId }],
    });

    const res = await request(app).get('/api/game-results/leaderboard').set('Cookie', alice);
    expect(res.body.leaderboard[0].friendDisplayName).toBe('Bobby');
  });
});

// ─── GET /api/game-results/h2h/:friendId ──────────────────────────────────────

describe('GET /api/game-results/h2h/:friendId', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/game-results/h2h/whoever');
    expect(res.status).toBe(401);
  });

  it('403 when the target is not a friend', async () => {
    const alice = await makeUser('h2h-stranger-alice');
    await makeUser('h2h-stranger-bob');
    const bobId = await userId('h2h-stranger-bob');
    const res = await request(app).get(`/api/game-results/h2h/${bobId}`).set('Cookie', alice);
    expect(res.status).toBe(403);
  });

  it('returns mutual games + W/L summary + per-deck matchups', async () => {
    const alice = await makeUser('h2h-alice');
    await makeUser('h2h-bob');
    const aliceId = await userId('h2h-alice');
    const bobId = await userId('h2h-bob');
    await makeFriends(aliceId, bobId);

    await insertResult({
      winnerUserId: aliceId,
      participants: [
        { userId: aliceId, deckId: 'd1', deckName: 'Atraxa' },
        { userId: bobId, deckId: 'd2', deckName: 'Krenko' },
      ],
    });
    await insertResult({
      winnerUserId: bobId,
      participants: [
        { userId: aliceId, deckId: 'd1', deckName: 'Atraxa' },
        { userId: bobId, deckId: 'd2', deckName: 'Krenko' },
      ],
    });

    const res = await request(app).get(`/api/game-results/h2h/${bobId}`).set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.friend.username).toBe('h2h-bob');
    expect(res.body.friend.displayName).toBeNull();
    expect(res.body.results).toHaveLength(2);
    expect(res.body.summary.gamesPlayed).toBe(2);
    expect(res.body.summary.callerWins).toBe(1);
    expect(res.body.summary.friendWins).toBe(1);
    // Same deck pairing both games → one matchup row, played twice.
    expect(res.body.summary.deckMatchups).toHaveLength(1);
    expect(res.body.summary.deckMatchups[0].played).toBe(2);
    expect(res.body.summary.deckMatchups[0].callerDeckName).toBe('Atraxa');
  });

  it('prefers the friend’s display name when set', async () => {
    const alice = await makeUser('h2h-dn-alice');
    const bob = await makeUser('h2h-dn-bob');
    const aliceId = await userId('h2h-dn-alice');
    const bobId = await userId('h2h-dn-bob');
    await makeFriends(aliceId, bobId);
    await request(app).patch('/api/auth/profile').set('Cookie', bob).send({ displayName: 'Bobby' });
    await insertResult({
      winnerUserId: aliceId,
      participants: [{ userId: aliceId }, { userId: bobId }],
    });

    const res = await request(app).get(`/api/game-results/h2h/${bobId}`).set('Cookie', alice);
    expect(res.body.friend.displayName).toBe('Bobby');
  });
});
