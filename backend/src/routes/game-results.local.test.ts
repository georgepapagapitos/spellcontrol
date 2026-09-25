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
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
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
  format?: string;
  coopOutcome?: 'won' | 'lost';
  hordeId?: string;
  turnOrder?: 'clockwise' | 'counterclockwise';
}) {
  // Every fixture gets a fresh id even when a caller pins endedAt — a reused
  // id is a 200 (same recorder) or a 409 (another's), never a second row.
  seq += 1;
  const endedAt = opts.endedAt ?? 10_000 + seq;
  return {
    id: opts.id ?? `game_local_${seq}`,
    code: '',
    mode: 'local',
    status: 'finished',
    hostUserId: null,
    format: opts.format ?? 'commander',
    ...(opts.coopOutcome !== undefined ? { coopOutcome: opts.coopOutcome } : {}),
    ...(opts.hordeId !== undefined ? { hordeId: opts.hordeId } : {}),
    ...(opts.turnOrder !== undefined ? { turnOrder: opts.turnOrder } : {}),
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
  /** Omit to mimic a row written before host_user_id existed (stays NULL). */
  hostUserId?: string | null;
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
        started_at, ended_at, duration_ms, participants, notable_events, created_at,
        host_user_id)
     VALUES ($1, 'CODE', 'commander', 40, 0, $2, 1, $4, 99, $3, NULL, 100, $5)`,
    [
      opts.sessionId,
      opts.winnerUserId,
      JSON.stringify(participants),
      opts.endedAt ?? 100,
      opts.hostUserId ?? null,
    ]
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

  it('accepts a finished game whose log includes clock pause/resume events (board timer)', async () => {
    const ana = await makeUser('lr-clock');
    const game = localGame({
      seats: [{}, {}],
      events: [
        { id: 'e1', ts: 1000, kind: 'start', actorSeat: null, targetSeat: null },
        { id: 'e2', ts: 1500, kind: 'clock', actorSeat: null, targetSeat: null, paused: true },
        { id: 'e3', ts: 2500, kind: 'clock', actorSeat: null, targetSeat: null, paused: false },
        { id: 'e4', ts: 3000, kind: 'end', actorSeat: null, targetSeat: 0 },
      ],
    });
    const res = await request(app).post('/api/game-results').set('Cookie', ana).send({ game });
    expect(res.status).toBe(201);
    expect(res.body.result.summary).not.toBeNull();
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

  it('persists turnOrder and returns it on read, defaulting to null when absent', async () => {
    const ana = await makeUser('lr-turnorder');
    const ccw = localGame({ seats: [{}, {}], turnOrder: 'counterclockwise' });
    const res = await request(app).post('/api/game-results').set('Cookie', ana).send({ game: ccw });
    expect(res.status).toBe(201);
    expect(res.body.result.turnOrder).toBe('counterclockwise');

    const mine = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    const row = mine.body.results.find((r: { sessionId: string }) => r.sessionId === ccw.id);
    expect(row.turnOrder).toBe('counterclockwise');

    const noOrder = localGame({ seats: [{}, {}] });
    const res2 = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: noOrder });
    expect(res2.status).toBe(201);
    expect(res2.body.result.turnOrder).toBeNull();
  });

  it('rejects a bad turnOrder value on POST', async () => {
    const ana = await makeUser('lr-turnorder-bad');
    const bad = { ...localGame({ seats: [{}, {}] }), turnOrder: 'sideways' };
    const res = await request(app).post('/api/game-results').set('Cookie', ana).send({ game: bad });
    expect(res.status).toBe(400);
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

// ─── POST /api/game-results (horde / co-op) ──────────────────────────────────

describe('POST /api/game-results (horde game)', () => {
  it('records a 1-survivor horde game with a coopOutcome and no winning seat', async () => {
    const ana = await makeUser('horde-solo');
    const game = localGame({
      seats: [{}],
      format: 'horde',
      winnerSeat: null,
      coopOutcome: 'won',
      hordeId: 'zombies',
    });
    const res = await request(app).post('/api/game-results').set('Cookie', ana).send({ game });
    expect(res.status).toBe(201);
    expect(res.body.result.format).toBe('horde');
    expect(res.body.result.coopOutcome).toBe('won');
    expect(res.body.result.hordeId).toBe('zombies');
    expect(res.body.result.winnerSeat).toBeNull();
    expect(res.body.result.winnerUserId).toBeNull();
  });

  it('accepts up to 4 survivors and rejects a 5th', async () => {
    const ana = await makeUser('horde-4up');
    const ok = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({
        game: localGame({
          seats: [{}, {}, {}, {}],
          format: 'horde',
          winnerSeat: null,
          coopOutcome: 'lost',
        }),
      });
    expect(ok.status).toBe(201);

    const tooMany = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({
        game: localGame({
          seats: [{}, {}, {}, {}, {}],
          format: 'horde',
          winnerSeat: null,
          coopOutcome: 'lost',
        }),
      });
    expect(tooMany.status).toBe(400);
  });

  it('rejects a horde game with no coopOutcome', async () => {
    const ana = await makeUser('horde-no-outcome');
    const res = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: localGame({ seats: [{}, {}], format: 'horde', winnerSeat: null }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/won or lost/);
  });

  it('rejects a horde game carrying a winnerSeat', async () => {
    const ana = await makeUser('horde-winner-seat');
    const res = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({
        game: localGame({ seats: [{}, {}], format: 'horde', winnerSeat: 0, coopOutcome: 'won' }),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no winning seat/);
  });

  it('leaves non-horde parsing unchanged: still 2-8 players, winnerSeat rules as today', async () => {
    const ana = await makeUser('horde-non-horde-unchanged');
    const oneSeat = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: localGame({ seats: [{}] }) });
    expect(oneSeat.status).toBe(400);

    const ok = await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({ game: localGame({ seats: [{}, {}], winnerSeat: 0 }) });
    expect(ok.status).toBe(201);
    expect(ok.body.result.coopOutcome).toBeNull();
    expect(ok.body.result.hordeId).toBeNull();
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

  it('never counts a horde (co-op) game in the leaderboard or head-to-head', async () => {
    const ana = await makeUser('horde-stats-ana');
    await makeUser('horde-stats-bob');
    const anaId = await userId('horde-stats-ana');
    const bobId = await userId('horde-stats-bob');
    await makeFriends(anaId, bobId);

    await request(app)
      .post('/api/game-results')
      .set('Cookie', ana)
      .send({
        game: localGame({
          seats: [{ userId: anaId }, { userId: bobId }],
          format: 'horde',
          winnerSeat: null,
          coopOutcome: 'won',
        }),
      });

    const board = await request(app).get('/api/game-results/leaderboard').set('Cookie', ana);
    expect(board.body.leaderboard).toHaveLength(0);

    const h2h = await request(app).get(`/api/game-results/h2h/${bobId}`).set('Cookie', ana);
    expect(h2h.body.summary.gamesPlayed).toBe(0);

    // Still visible in personal history — only the PvP stats surfaces exclude it.
    const mine = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(mine.body.results.map((r: { format: string }) => r.format)).toContain('horde');
  });
});

// ─── Correcting a recorded game ──────────────────────────────────────────────

describe('PATCH /api/game-results/:sessionId', () => {
  it('lets the recorder fix the winner and a seat deck, and moves the placement with it', async () => {
    const ana = await makeUser('edit-ana');
    const game = localGame({ seats: [{}, {}], winnerSeat: 0 });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game });

    const res = await request(app)
      .patch(`/api/game-results/${game.id}`)
      .set('Cookie', ana)
      .send({
        winnerSeat: 1,
        decks: [
          {
            seat: 1,
            deckId: 'd1',
            deckName: 'Atraxa',
            commander: 'Atraxa',
            colorIdentity: ['w', 'u', 'b', 'g'],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.result.winnerSeat).toBe(1);
    const seat1 = res.body.result.participants.find((p: { seat: number }) => p.seat === 1);
    expect(seat1.deckName).toBe('Atraxa');
    // Colors are normalized to the canonical uppercase set, like every other
    // write path.
    expect(seat1.colorIdentity).toEqual(['W', 'U', 'B', 'G']);
    // The summary must not keep claiming the old winner came first.
    expect(res.body.result.summary.winnerSeat).toBe(1);
    const placements = res.body.result.summary.seats.map(
      (s: { seat: number; placement: number | null }) => [s.seat, s.placement]
    );
    expect(placements).toEqual([
      [0, null],
      [1, 1],
    ]);

    const mine = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(mine.body.results[0].winnerSeat).toBe(1);
  });

  it('clears the winner when asked, and leaves seats it was not given alone', async () => {
    const ana = await makeUser('edit-clear');
    const game = localGame({ seats: [{}, {}], winnerSeat: 0 });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game });

    const res = await request(app)
      .patch(`/api/game-results/${game.id}`)
      .set('Cookie', ana)
      .send({ winnerSeat: null });
    expect(res.status).toBe(200);
    expect(res.body.result.winnerSeat).toBe(null);
    expect(res.body.result.winnerUserId).toBe(null);
    expect(res.body.result.participants).toHaveLength(2);
    expect(res.body.result.participants[0].deckName).toBe(null);
  });

  it('refuses another account, an online row, an unknown seat and an eliminated winner', async () => {
    const ana = await makeUser('edit-owner');
    const bob = await makeUser('edit-other');
    const anaId = await userId('edit-owner');
    const game = localGame({ seats: [{}, { eliminated: true }], winnerSeat: 0 });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game });

    const notMine = await request(app)
      .patch(`/api/game-results/${game.id}`)
      .set('Cookie', bob)
      .send({ winnerSeat: 1 });
    expect(notMine.status).toBe(404);

    await insertOnlineRow({
      sessionId: 'edit-online-1',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: null }],
    });
    const online = await request(app)
      .patch('/api/game-results/edit-online-1')
      .set('Cookie', ana)
      .send({ winnerSeat: 1 });
    expect(online.status).toBe(404);

    const noSeat = await request(app)
      .patch(`/api/game-results/${game.id}`)
      .set('Cookie', ana)
      .send({ winnerSeat: 5 });
    expect(noSeat.status).toBe(400);

    const dead = await request(app)
      .patch(`/api/game-results/${game.id}`)
      .set('Cookie', ana)
      .send({ winnerSeat: 1 });
    expect(dead.status).toBe(400);

    // The row is untouched by every refusal above.
    const still = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(still.body.results[0].winnerSeat).toBe(0);
  });
});

// ─── Hiding a shared online row from one account's list ──────────────────────

describe('PUT/DELETE /api/game-results/:sessionId/hidden', () => {
  it('drops an online row out of the hider list only, and hands it back on request', async () => {
    const ana = await makeUser('hide-ana');
    const bob = await makeUser('hide-bob');
    const anaId = await userId('hide-ana');
    const bobId = await userId('hide-bob');
    await makeFriends(anaId, bobId);
    await insertOnlineRow({
      sessionId: 'hide-1',
      winnerUserId: bobId,
      participants: [{ userId: anaId }, { userId: bobId }],
    });

    const hid = await request(app).put('/api/game-results/hide-1/hidden').set('Cookie', ana);
    expect(hid.status).toBe(200);

    const mine = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(mine.body.results.map((r: { sessionId: string }) => r.sessionId)).not.toContain(
      'hide-1'
    );
    expect(mine.body.hiddenCount).toBe(1);

    const hiddenList = await request(app).get('/api/game-results/mine?hidden=1').set('Cookie', ana);
    expect(hiddenList.body.results.map((r: { sessionId: string }) => r.sessionId)).toEqual([
      'hide-1',
    ]);

    // The other seat's list is untouched — this is one account's curation.
    const theirs = await request(app).get('/api/game-results/mine').set('Cookie', bob);
    expect(theirs.body.results.map((r: { sessionId: string }) => r.sessionId)).toContain('hide-1');
    expect(theirs.body.hiddenCount).toBe(0);

    const back = await request(app).delete('/api/game-results/hide-1/hidden').set('Cookie', ana);
    expect(back.status).toBe(200);
    const after = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(after.body.results.map((r: { sessionId: string }) => r.sessionId)).toContain('hide-1');
    expect(after.body.hiddenCount).toBe(0);
  });

  it('still counts a hidden game in the shared record', async () => {
    const ana = await makeUser('hide-stats-ana');
    await makeUser('hide-stats-bob');
    const anaId = await userId('hide-stats-ana');
    const bobId = await userId('hide-stats-bob');
    await makeFriends(anaId, bobId);
    await insertOnlineRow({
      sessionId: 'hide-stats-1',
      winnerUserId: bobId,
      participants: [{ userId: anaId }, { userId: bobId }],
    });
    await request(app).put('/api/game-results/hide-stats-1/hidden').set('Cookie', ana);

    // Hiding is list curation, never a retraction: one seat must not be able
    // to quietly rewrite a head-to-head both of them played.
    const board = await request(app).get('/api/game-results/leaderboard').set('Cookie', ana);
    expect(board.body.leaderboard[0].gamesPlayed).toBe(1);
    expect(board.body.leaderboard[0].friendWins).toBe(1);
    const h2h = await request(app).get(`/api/game-results/h2h/${bobId}`).set('Cookie', ana);
    expect(h2h.body.summary.gamesPlayed).toBe(1);
  });

  it('hides a local game a friend recorded you into, which you cannot delete', async () => {
    const ana = await makeUser('hide-friend-ana');
    const bob = await makeUser('hide-friend-bob');
    const anaId = await userId('hide-friend-ana');
    const bobId = await userId('hide-friend-bob');
    await makeFriends(anaId, bobId);
    // Bob records it, Ana is a seat: it lands in her history with no way off.
    const game = localGame({ seats: [{ userId: bobId }, { userId: anaId }] });
    await request(app).post('/api/game-results').set('Cookie', bob).send({ game });

    expect(
      (await request(app).delete(`/api/game-results/${game.id}`).set('Cookie', ana)).status
    ).toBe(404);
    expect(
      (await request(app).put(`/api/game-results/${game.id}/hidden`).set('Cookie', ana)).status
    ).toBe(200);
    const mine = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    expect(mine.body.results.map((r: { sessionId: string }) => r.sessionId)).not.toContain(game.id);
    // Bob, who recorded it, still has it: one account's curation.
    const his = await request(app).get('/api/game-results/mine').set('Cookie', bob);
    expect(his.body.results.map((r: { sessionId: string }) => r.sessionId)).toContain(game.id);
  });

  it('refuses a row the caller can delete, and one they never sat at', async () => {
    const ana = await makeUser('hide-local');
    const bob = await makeUser('hide-stranger');
    const anaId = await userId('hide-local');
    const game = localGame({ seats: [{ userId: anaId }, {}] });
    await request(app).post('/api/game-results').set('Cookie', ana).send({ game });

    // A local row you recorded is deleted outright; hiding it would be a
    // second path to the same thing.
    const local = await request(app).put(`/api/game-results/${game.id}/hidden`).set('Cookie', ana);
    expect(local.status).toBe(404);

    await insertOnlineRow({
      sessionId: 'hide-strangers-game',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: null }],
    });
    const stranger = await request(app)
      .put('/api/game-results/hide-strangers-game/hidden')
      .set('Cookie', bob);
    expect(stranger.status).toBe(404);
  });
});

// ─── The host can delete the online game they made ───────────────────────────

describe('DELETE /api/game-results/:sessionId (online, as host)', () => {
  it('lets the host delete it, and nobody else at the table', async () => {
    const ana = await makeUser('hostdel-ana');
    const bob = await makeUser('hostdel-bob');
    const anaId = await userId('hostdel-ana');
    const bobId = await userId('hostdel-bob');
    await insertOnlineRow({
      sessionId: 'hostdel-1',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: bobId }],
      hostUserId: anaId,
    });

    // Bob played in it but did not make the table.
    const notHost = await request(app).delete('/api/game-results/hostdel-1').set('Cookie', bob);
    expect(notHost.status).toBe(404);
    expect(
      (await pool.query(`SELECT 1 FROM game_results WHERE session_id = 'hostdel-1'`)).rowCount
    ).toBe(1);

    const host = await request(app).delete('/api/game-results/hostdel-1').set('Cookie', ana);
    expect(host.status).toBe(200);
    expect(
      (await pool.query(`SELECT 1 FROM game_results WHERE session_id = 'hostdel-1'`)).rowCount
    ).toBe(0);

    // It is gone for the other seat too — that is the whole point, and why
    // only the host gets to do it.
    const theirs = await request(app).get('/api/game-results/mine').set('Cookie', bob);
    expect(theirs.body.results.map((r: { sessionId: string }) => r.sessionId)).not.toContain(
      'hostdel-1'
    );
  });

  it('offers the host delete instead of hide, never both', async () => {
    const ana = await makeUser('hostdel-both');
    const anaId = await userId('hostdel-both');
    await insertOnlineRow({
      sessionId: 'hostdel-2',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: null }],
      hostUserId: anaId,
    });
    // Hiding a row you can delete outright would be a second path to one thing.
    const hide = await request(app).put('/api/game-results/hostdel-2/hidden').set('Cookie', ana);
    expect(hide.status).toBe(404);
    expect(
      (await request(app).delete('/api/game-results/hostdel-2').set('Cookie', ana)).status
    ).toBe(200);
  });

  /**
   * Every online row recorded before host_user_id existed carries NULL. Those
   * must keep the behaviour they had — nobody deletes them, everyone at the
   * table can still hide them. Written as a test because the obvious SQL for
   * the hide rule (`NOT (mode = 'online' AND host_user_id = $3)`) evaluates to
   * NULL on exactly these rows and quietly filters them out, taking hide away
   * from the only games that ever needed it.
   */
  it('leaves a pre-migration online row un-deletable but still hideable', async () => {
    const ana = await makeUser('hostdel-legacy');
    const anaId = await userId('hostdel-legacy');
    await insertOnlineRow({
      sessionId: 'hostdel-legacy-1',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: null }],
      // no hostUserId — as if written before the column existed
    });
    const host = await pool.query<{ host_user_id: string | null }>(
      `SELECT host_user_id FROM game_results WHERE session_id = 'hostdel-legacy-1'`
    );
    expect(host.rows[0].host_user_id).toBe(null);

    expect(
      (await request(app).delete('/api/game-results/hostdel-legacy-1').set('Cookie', ana)).status
    ).toBe(404);
    expect(
      (await request(app).put('/api/game-results/hostdel-legacy-1/hidden').set('Cookie', ana))
        .status
    ).toBe(200);
  });

  it('carries the host through /mine so the client knows who may delete', async () => {
    const ana = await makeUser('hostdel-read');
    const anaId = await userId('hostdel-read');
    await insertOnlineRow({
      sessionId: 'hostdel-3',
      winnerUserId: anaId,
      participants: [{ userId: anaId }, { userId: null }],
      hostUserId: anaId,
    });
    const mine = await request(app).get('/api/game-results/mine').set('Cookie', ana);
    const row = mine.body.results.find(
      (r: { sessionId: string }) => r.sessionId === 'hostdel-3'
    ) as { hostUserId: string | null };
    expect(row.hostUserId).toBe(anaId);
  });
});
