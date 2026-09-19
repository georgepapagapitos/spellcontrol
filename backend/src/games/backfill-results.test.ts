import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { backfillResultsFromUserGames } from './backfill-results';

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

async function makeUserId(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  const r = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  return r.rows[0].id;
}

/** A `GameRecord` as the old client synced it into user_games. */
function record(opts: {
  id: string;
  mode: 'local' | 'online';
  players: Array<{ userId: string | null; name: string; eliminated?: boolean }>;
  winnerSeat: number | null;
  endedAt: number;
  summary?: unknown;
}) {
  return {
    id: opts.id,
    code: opts.mode === 'online' ? 'ABCD' : '',
    format: 'commander',
    startingLife: 40,
    players: opts.players.map((p, i) => ({
      seat: i,
      userId: p.userId,
      name: p.name,
      deckId: i === 0 ? 'deck-1' : null,
      deckName: i === 0 ? 'Atraxa' : null,
      commander: null,
      finalLife: p.eliminated ? 0 : 40,
      eliminated: p.eliminated ?? false,
    })),
    winnerSeat: opts.winnerSeat,
    startedAt: opts.endedAt - 60_000,
    endedAt: opts.endedAt,
    durationMs: 60_000,
    mode: opts.mode,
    ...(opts.summary !== undefined ? { summary: opts.summary } : {}),
  };
}

async function insertUserGame(userId: string, rec: { id: string }, deleted = false): Promise<void> {
  await pool.query(
    `INSERT INTO user_games (user_id, id, data, rev, deleted_at, updated_at)
     VALUES ($1, $2, $3, nextval('user_data_rev_seq'), $4, 123)`,
    [userId, rec.id, JSON.stringify(rec), deleted ? 456 : null]
  );
}

describe('backfillResultsFromUserGames', () => {
  it('folds local records into game_results as mode=local recorded by their owner, skips tombstones and rows that already exist, and runs once', async () => {
    const anaId = await makeUserId('bf-ana');
    const bobId = await makeUserId('bf-bob');

    const local = record({
      id: 'game_bf_local',
      mode: 'local',
      players: [
        { userId: null, name: 'Ana' },
        { userId: bobId, name: 'Bob', eliminated: true },
      ],
      winnerSeat: 0,
      endedAt: 50_000,
      summary: { turns: 3, durationMs: 60_000, seats: [] },
    });
    await insertUserGame(anaId, local);

    // An online game both players synced a copy of — and which already has
    // its canonical row. Must not be duplicated or overwritten.
    const online = record({
      id: 'sess-bf-online',
      mode: 'online',
      players: [
        { userId: anaId, name: 'Ana' },
        { userId: bobId, name: 'Bob' },
      ],
      winnerSeat: 1,
      endedAt: 60_000,
    });
    await insertUserGame(anaId, online);
    await insertUserGame(bobId, online);
    await pool.query(
      `INSERT INTO game_results
         (session_id, code, format, starting_life, winner_seat, winner_user_id,
          started_at, ended_at, duration_ms, participants, created_at)
       VALUES ('sess-bf-online', 'ABCD', 'commander', 40, 1, $1, 1, 60000, 59999, '[]', 60000)`,
      [bobId]
    );

    // A pre-E56 online game with no canonical row: inserted, recorded by nobody.
    const orphan = record({
      id: 'sess-bf-orphan',
      mode: 'online',
      players: [
        { userId: anaId, name: 'Ana' },
        { userId: null, name: 'Guest' },
      ],
      winnerSeat: null,
      endedAt: 70_000,
    });
    await insertUserGame(anaId, orphan);

    // Deleted on the client — a tombstone, never a result.
    const deleted = record({
      id: 'game_bf_deleted',
      mode: 'local',
      players: [
        { userId: null, name: 'X' },
        { userId: null, name: 'Y' },
      ],
      winnerSeat: 0,
      endedAt: 80_000,
    });
    await insertUserGame(anaId, deleted, true);

    const n = await backfillResultsFromUserGames(pool);
    expect(n).toBe(2);

    const rows = await pool.query(
      `SELECT session_id, mode, recorded_by_user_id, winner_seat, winner_user_id, participants, summary, ended_at
         FROM game_results WHERE session_id LIKE '%bf%' ORDER BY session_id`
    );
    const byId = new Map(rows.rows.map((r) => [r.session_id, r]));
    expect([...byId.keys()]).toEqual(['game_bf_local', 'sess-bf-online', 'sess-bf-orphan']);

    const l = byId.get('game_bf_local')!;
    expect(l.mode).toBe('local');
    expect(l.recorded_by_user_id).toBe(anaId);
    expect(l.winner_seat).toBe(0);
    expect(l.winner_user_id).toBeNull(); // seat 0 was a guest
    expect(l.participants).toHaveLength(2);
    expect(l.participants[1]).toMatchObject({
      seat: 1,
      userId: bobId,
      username: null,
      name: 'Bob',
      eliminated: true,
      finalLife: 0,
      colorIdentity: [],
    });
    expect(l.participants[0].deckId).toBe('deck-1');
    expect(l.summary).toMatchObject({ turns: 3 });
    expect(Number(l.ended_at)).toBe(50_000);

    // Existing canonical row untouched (its own participants stayed []).
    const o = byId.get('sess-bf-online')!;
    expect(o.participants).toEqual([]);
    expect(o.mode).toBe('online');

    const orph = byId.get('sess-bf-orphan')!;
    expect(orph.mode).toBe('online');
    expect(orph.recorded_by_user_id).toBeNull();
    expect(orph.winner_user_id).toBeNull();

    // Second boot: marker set, nothing rescanned.
    await insertUserGame(
      anaId,
      record({
        id: 'game_bf_late',
        mode: 'local',
        players: [
          { userId: null, name: 'A' },
          { userId: null, name: 'B' },
        ],
        winnerSeat: null,
        endedAt: 90_000,
      })
    );
    expect(await backfillResultsFromUserGames(pool)).toBe(0);
    const late = await pool.query(`SELECT 1 FROM game_results WHERE session_id = 'game_bf_late'`);
    expect(late.rowCount).toBe(0);
  });
});
