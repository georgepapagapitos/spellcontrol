import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { persistGameResult } from './persist-result';
import { createGameState, makePlayer, type GameEvent, type GameState } from './state';

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

async function makeUser(username: string): Promise<void> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
}

async function userId(username: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    username,
  ]);
  return r.rows[0].id;
}

function ev(kind: GameEvent['kind'], overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    ts: 1500,
    kind,
    actorSeat: null,
    targetSeat: null,
    ...overrides,
  };
}

/** A finished online GameState with two seated, authed players and an
 *  arbitrary event log — everything persistGameResult needs. */
function finishedState(input: {
  id: string;
  events: GameEvent[];
  winnerSeat?: number | null;
  playerUserIds: (string | null)[];
}): GameState {
  const base = createGameState({
    id: input.id,
    code: 'CODE',
    mode: 'online',
    hostUserId: input.playerUserIds[0] ?? null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: input.playerUserIds.map((userId, i) =>
      makePlayer({
        id: userId ?? `guest-${i}`,
        userId,
        seat: i,
        name: `P${i}`,
        startingLife: 40,
        isHost: i === 0,
      })
    ),
    ts: 1000,
  });
  return {
    ...base,
    status: 'finished',
    events: input.events,
    winnerSeat: input.winnerSeat ?? null,
    startedAt: 1000,
    endedAt: 2000,
  };
}

describe('persistGameResult — notable_events', () => {
  it('persists exactly the notable subset (eliminate/end/designation) of a mixed event log', async () => {
    await makeUser('pr-notable-a');
    await makeUser('pr-notable-b');
    const aId = await userId('pr-notable-a');
    const bId = await userId('pr-notable-b');

    const events: GameEvent[] = [
      ev('start'),
      ev('join', { targetSeat: 0, message: 'P0' }),
      ev('life', { targetSeat: 1, delta: -5 }),
      ev('note', { actorSeat: 0, message: 'Player B rage-quit' }),
      ev('eliminate', { targetSeat: 1 }),
      ev('designation', { targetSeat: 0, message: 'monarch' }),
      ev('end', { targetSeat: 0 }),
    ];
    const state = finishedState({
      id: 'pr-notable-session',
      events,
      winnerSeat: 0,
      playerUserIds: [aId, bId],
    });

    await persistGameResult(state, pool);

    const row = (
      await pool.query(`SELECT notable_events FROM game_results WHERE session_id = $1`, [
        'pr-notable-session',
      ])
    ).rows[0];
    expect(row.notable_events.map((e: GameEvent) => e.kind)).toEqual([
      'eliminate',
      'designation',
      'end',
    ]);
    // HARD PRIVACY BINDING: never a 'note' event (free player-typed text) in
    // the persisted subset, even though one was present in the raw log.
    expect(row.notable_events.some((e: GameEvent) => e.kind === 'note')).toBe(false);
  });

  it('persists [] (not null) for a game with an empty events array', async () => {
    await makeUser('pr-empty-a');
    await makeUser('pr-empty-b');
    const aId = await userId('pr-empty-a');
    const bId = await userId('pr-empty-b');
    const state = finishedState({
      id: 'pr-empty-session',
      events: [],
      playerUserIds: [aId, bId],
    });

    await persistGameResult(state, pool);

    const row = (
      await pool.query(`SELECT notable_events FROM game_results WHERE session_id = $1`, [
        'pr-empty-session',
      ])
    ).rows[0];
    // Distinguishes "the selector ran and found nothing" ([]) from a
    // pre-migration row, which reads as null.
    expect(row.notable_events).not.toBeNull();
    expect(row.notable_events).toEqual([]);
  });

  it('keeps ON CONFLICT (session_id) DO NOTHING idempotency with the new column present', async () => {
    await makeUser('pr-idem-a');
    await makeUser('pr-idem-b');
    const aId = await userId('pr-idem-a');
    const bId = await userId('pr-idem-b');
    const state = finishedState({
      id: 'pr-idem-session',
      events: [ev('eliminate', { targetSeat: 1 })],
      winnerSeat: 0,
      playerUserIds: [aId, bId],
    });

    await persistGameResult(state, pool);
    await persistGameResult(state, pool);

    const count = await pool.query(`SELECT COUNT(*) AS n FROM game_results WHERE session_id = $1`, [
      'pr-idem-session',
    ]);
    expect(Number(count.rows[0].n)).toBe(1);
  });
});
