import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

/**
 * The local half of the unified results record: POST a finished local game,
 * read it back through /mine and the friend-scoped reads alongside online
 * rows, filter by mode, and delete as the recorder only.
 */

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

let seq = 0;
/** A finished local GameState as the client would post it. */
function localGame(opts: {
  id?: string;
  seats: Array<{ userId?: string | null; name?: string; life?: number; eliminated?: boolean }>;
  winnerSeat?: number | null;
  endedAt?: number;
  events?: unknown[];
}) {
  const endedAt = opts.endedAt ?? 10_000 + ++seq;
  return {
    id: opts.id ?? `game_local_${seq}`,
    code: '',
    mode: 'local',
    status: 'finished',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    layout: 'pod',
    tapOrientation: 'horizontal',
    activeSeat: null,
    startingSeat: 0,
    designations: { monarch: null, initiative: null },
    players: opts.seats.map((s, i) => ({
      id: `local_${i}`,
      userId: s.userId ?? null,
      seat: i,
      name: s.name ?? `P${i}`,
      deckId: null,
      deckName: null,
      commander: null,
      partner: null,
      colorIdentity: [],
      panelColorKey: null,
      life: s.life ?? 40,
      poison: 0,
      commanderDamage: {},
      eliminated: s.eliminated ?? false,
      isHost: i === 0,
      connected: true,
    })),
    events: opts.events ?? [
      { id: 'e1', ts: 1000, kind: 'start', actorSeat: null, targetSeat: null },
      { id: 'e2', ts: 1500, kind: 'life', actorSeat: 0, targetSeat: 1, delta: -5 },
      { id: 'e3', ts: endedAt, kind: 'end', actorSeat: null, targetSeat: 0 },
    ],
    winnerSeat: opts.winnerSeat === undefined ? 0 : opts.winnerSeat,
    createdAt: 1000,
    updatedAt: endedAt,
    startedAt: 1000,
    endedAt,
    version: 3,
  };
}

async function insertOnlineRow(opts: {
  sessionId: string;
  winnerUserId: string | null;
  participants: Array<{ userId: string | null }>;
  endedAt?: number;
}): Promise<void> {
  const participants = opts.participants.map((p, i) => ({
    seat: i,
    userId: p.userId,
    username: null,
    name: `P${i}`,
    deckId: null,
    deckName: null,
    commander: null,
    colorIdentity: [],
    finalLife: 40,
    eliminated: false,
  }));
  await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_seat, winner_user_id,
        started_at, ended_at, duration_ms, participants, notable_events, created_at)
     VALUES ($1, 'CODE', 'commander', 40, 0, $2, 1, $4, 99, $3, NULL, 100)`,
    [opts.sessionId, opts.winnerUserId, JSON.stringify(participants), opts.endedAt ?? 100]
  );
}

// ─── POST /api/game-results ──────────────────────────────────────────────────

describe('POST /api/game-results (local game)', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app)
      .post('/api/game-results')
      .send({ game: localGame({ seats: [{}, {}] }) });
    expect(res.status).toBe(401);
  });

  it('records a finished local game as a mode=local row recorded by the caller', async () => {
    const ana = await makeUser('lr-ana');
    const anaId = await userId('lr-ana');
    const game = localGame({ seats: [{ userId: anaId, name: 'Ana' }, { name: 'Walk-up' }] });
    const res = await request(app).post('/api/game-results').set('Cookie', ana).send({ game });
    expect(res.status).toBe(201);
    expect(res.body.result.sessionId).toBe(game.id);
    expect(res.body.result.mode).toBe('local');
    expect(res.body.result.recordedByUserId).toBe(anaId);
    expect(res.body.result.winnerUserId).toBe(anaId);
    // Username denormalized like the online path; the guest seat stays null.
    expect(res.body.result.participants[0].username).toBe('lr-ana');
    expect(res.body.result.participants[1].userId).toBeNull();
    // Derived once, from the log the row never stores.
    expect(res.body.result.summary).not.toBeNull();
    expect(res.body.result.summary.startingSeat).toBe(0);

    const row = await pool.query(
      `SELECT mode, recorded_by_user_id FROM game_results WHERE session_id = $1`,
      [game.id]
    );
    expect(row.rows[0]).toEqual({ mode: 'local', recorded_by_user_id: anaId });
  });

  it('rejects a game that is not local, not finished, or malformed', async () => {
    const ana = await makeUser('lr-shape');
    const post = (game: unknown) =>
      request(app).post('/api/game-results').set('Cookie', ana).send({ game });

    expect((await post({ ...localGame({ seats: [{}, {}] }), mode: 'online' })).status).toBe(400);
    expect((await post({ ...localGame({ seats: [{}, {}] }), status: 'active' })).status).toBe(400);
    expect((await post({ ...localGame({ seats: [{}] }) })).status).toBe(400);
    expect((await post({ ...localGame({ seats: [{}, {}] }), winnerSeat: 7 })).status).toBe(400);
    expect((await post({ ...localGame({ seats: [{}, {}] }), format: 'chaos' })).status).toBe(400);
    expect((await post({ ...localGame({ seats: [{}, {}] }), id: 'has space' })).status).toBe(400);
    expect(
      (
        await post({
          ...localGame({ seats: [{}, {}] }),
          events: [{ id: 'x', ts: 1, kind: 'not-a-kind', actorSeat: null, targetSeat: null }],
        })
      ).status
    ).toBe(400);
    expect((await post(null)).status).toBe(400);
  });

  it('credits only the caller and accepted friends — a stranger seat is refused', async () => {
    const ana = await makeUser('lr-credit-ana');
    await makeUser('lr-credit-bob');
    await makeUser('lr-credit-eve');
    const anaId = await userId('lr-credit-ana');
    const bobId = await userId('lr-credit-bob');
    const eveId = await userId('lr-credit-eve');
    await makeFriends(anaId, bobId);

    const withStranger = localGame({ seats: [{ userId: anaId }, { userId: eveId }] });
    const bad = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: withStranger });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/friends/);

    const withFriend = localGame({ seats: [{ userId: anaId }, { userId: bobId }] });
    const ok = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: withFriend });
    expect(ok.status).toBe(201);
    expect(ok.body.result.participants[1].username).toBe('lr-credit-bob');
  });

  it('refuses one account holding two seats', async () => {
    const ana = await makeUser('lr-dup');
    const anaId = await userId('lr-dup');
    const res = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: localGame({ seats: [{ userId: anaId }, { userId: anaId }] }) });
    expect(res.status).toBe(400);
  });

  it('never stamps an eliminated seat as winner_user_id', async () => {
    const ana = await makeUser('lr-elim');
    const anaId = await userId('lr-elim');
    const game = localGame({
      seats: [{ userId: anaId, eliminated: true, life: 0 }, { name: 'Guest' }],
      winnerSeat: 0,
    });
    const res = await request(app).post('/api/game-results').set('Cookie', ana).send({ game });
    expect(res.status).toBe(201);
    expect(res.body.result.winnerUserId).toBeNull();
  });

  it('is idempotent for the recorder and a 409 for anyone else claiming the id', async () => {
    const ana = await makeUser('lr-idem-ana');
    const bob = await makeUser('lr-idem-bob');
    const game = localGame({ seats: [{ name: 'A' }, { name: 'B' }] });
    const first = await request(app).post('/api/game-results').set('Cookie', ana).send({ game });
    expect(first.status).toBe(201);
    // A retry after a dropped response: same row, 200, nothing rewritten.
    const again = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: { ...game, winnerSeat: 1 } });
    expect(again.status).toBe(200);
    expect(again.body.result.winnerSeat).toBe(0);
    const other = await request(app).post('/api/game-results').set('Cookie', bob).send({ game });
    expect(other.status).toBe(409);
    const n = await pool.query(`SELECT COUNT(*) AS n FROM game_results WHERE session_id = $1`, [
      game.id,
    ]);
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('413 for a body over the size cap', async () => {
    const ana = await makeUser('lr-big');
    const events = Array.from({ length: 4000 }, (_, i) => ({
      id: `e${i}`,
      ts: 1000 + i,
      kind: 'note',
      actorSeat: 0,
      targetSeat: null,
      message: 'x'.repeat(400),
    }));
    const res = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: localGame({ seats: [{}, {}], events }) });
    expect(res.status).toBe(413);
  });
});

// ─── GET /api/game-results/mine ──────────────────────────────────────────────

describe('GET /api/game-results/mine', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/game-results/mine');
    expect(res.status).toBe(401);
  });

  it('returns games the caller sat in (either mode) and local games they recorded, newest first', async () => {
    const ana = await makeUser('mine-ana');
    await makeUser('mine-bob');
    const anaId = await userId('mine-ana');
    const bobId = await userId('mine-bob');
    await makeFriends(anaId, bobId);

    await insertOnlineRow({
      sessionId: 'mine-online-1',
      winnerUserId: bobId,
      participants: [{ userId: anaId }, { userId: bobId }],
      endedAt: 5_000,
    });
    // Recorded by ana, but ana held no seat (she tracked for the table).
    const tracked = localGame({ seats: [{ name: 'X' }, { name: 'Y' }], endedAt: 6_000 });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game: tracked });
    const seated = localGame({ seats: [{ userId: anaId }, { userId: bobId }], endedAt: 7_000 });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game: seated });
    // Someone else's game entirely.
    await insertOnlineRow({
      sessionId: 'mine-online-other',
      winnerUserId: bobId,
      participants: [{ userId: bobId }, { userId: null }],
      endedAt: 8_000,
    });

    const res = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { sessionId: string }) => r.sessionId)).toEqual([
      seated.id,
      tracked.id,
      'mine-online-1',
    ]);
    expect(res.body.results.map((r: { mode: string }) => r.mode)).toEqual([
      'local',
      'local',
      'online',
    ]);
    expect(res.body.nextCursor).toBeNull();

    const local = await request(app).get('/api/game-results/mine?mode=local').set('Cookie', ana);
    expect(local.body.results).toHaveLength(2);
    const online = await request(app).get('/api/game-results/mine?mode=online').set('Cookie', ana);
    expect(online.body.results.map((r: { sessionId: string }) => r.sessionId)).toEqual([
      'mine-online-1',
    ]);
    const bad = await request(app).get('/api/game-results/mine?mode=paper').set('Cookie', ana);
    expect(bad.status).toBe(400);
  });

  it('pages with a keyset cursor', async () => {
    const ana = await makeUser('mine-page');
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/game-results')
        .set('Cookie', ana)
        .send({ game: localGame({ seats: [{}, {}], endedAt: 20_000 + i }) });
    }
    const p1 = await request(app).get('/api/game-results/mine?limit=2').set('Cookie', ana);
    expect(p1.body.results).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await request(app)
      .get(`/api/game-results/mine?limit=2&before=${encodeURIComponent(p1.body.nextCursor)}`)
      .set('Cookie', ana);
    expect(p2.body.results).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    const ids = [...p1.body.results, ...p2.body.results].map((r: { endedAt: number }) => r.endedAt);
    expect(ids).toEqual([20_002, 20_001, 20_000]);
  });
});

// ─── DELETE /api/game-results/:sessionId ─────────────────────────────────────

describe('DELETE /api/game-results/:sessionId', () => {
  it('lets the recorder remove a local game, and nobody else', async () => {
    const ana = await makeUser('del-ana');
    const bob = await makeUser('del-bob');
    const game = localGame({ seats: [{}, {}] });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game });

    const notMine = await request(app).delete(`/api/game-results/${game.id}`).set('Cookie', bob);
    expect(notMine.status).toBe(404);
    const mine = await request(app).delete(`/api/game-results/${game.id}`).set('Cookie', ana);
    expect(mine.status).toBe(200);
    const gone = await request(app).delete(`/api/game-results/${game.id}`).set('Cookie', ana);
    expect(gone.status).toBe(404);
  });

  it('never removes an online row, even for a participant', async () => {
    const ana = await makeUser('del-online');
    const anaId = await userId('del-online');
    await insertOnlineRow({
      sessionId: 'del-online-1',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: null }],
    });
    const res = await request(app).delete('/api/game-results/del-online-1').set('Cookie', ana);
    expect(res.status).toBe(404);
    const still = await pool.query(`SELECT 1 FROM game_results WHERE session_id = 'del-online-1'`);
    expect(still.rowCount).toBe(1);
  });
});

// ─── Friend-scoped reads count both modes ────────────────────────────────────

describe('leaderboard and h2h across modes', () => {
  it('counts a local game between friends alongside online ones, and splits on ?mode', async () => {
    const ana = await makeUser('mix-ana');
    await makeUser('mix-bob');
    const anaId = await userId('mix-ana');
    const bobId = await userId('mix-bob');
    await makeFriends(anaId, bobId);

    await insertOnlineRow({
      sessionId: 'mix-online',
      winnerUserId: bobId,
      participants: [{ userId: anaId }, { userId: bobId }],
    });
    await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: localGame({ seats: [{ userId: anaId }, { userId: bobId }], winnerSeat: 0 }) });

    const all = await request(app).get('/api/game-results/leaderboard').set('Cookie', ana);
    expect(all.body.leaderboard).toHaveLength(1);
    expect(all.body.leaderboard[0].gamesPlayed).toBe(2);
    expect(all.body.leaderboard[0].callerWins).toBe(1);
    expect(all.body.leaderboard[0].friendWins).toBe(1);

    const localOnly = await request(app)
      .get('/api/game-results/leaderboard?mode=local')
      .set('Cookie', ana);
    expect(localOnly.body.leaderboard[0].gamesPlayed).toBe(1);
    expect(localOnly.body.leaderboard[0].callerWins).toBe(1);

    const h2h = await request(app).get(`/api/game-results/h2h/${bobId}`).set('Cookie', ana);
    expect(h2h.body.summary.gamesPlayed).toBe(2);
    expect(h2h.body.results.map((r: { mode: string }) => r.mode).sort()).toEqual([
      'local',
      'online',
    ]);
    const h2hOnline = await request(app)
      .get(`/api/game-results/h2h/${bobId}?mode=online`)
      .set('Cookie', ana);
    expect(h2hOnline.body.summary.gamesPlayed).toBe(1);
  });
});
