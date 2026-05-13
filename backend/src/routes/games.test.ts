import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, dbTestsEnabled, extractSessionCookie } from '../test-helpers';

const d = dbTestsEnabled ? describe : describe.skip;

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  if (!dbTestsEnabled) return;
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  return extractSessionCookie(res.headers['set-cookie'])!;
}

d('POST /api/games', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/games').send({});
    expect(res.status).toBe(401);
  });

  it('creates a session and returns a 4-char code', async () => {
    const cookie = await registerAndGetCookie('games_alice');
    const res = await request(app)
      .post('/api/games')
      .set('Cookie', cookie)
      .send({ format: 'commander', startingLife: 40 });
    expect(res.status).toBe(201);
    expect(res.body.game.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(res.body.game.players).toHaveLength(1);
    expect(res.body.game.players[0].isHost).toBe(true);
  });
});

d('POST /api/games/:code/join + PATCH /:code', () => {
  it('joins a game and applies a life action', async () => {
    const hostCookie = await registerAndGetCookie('games_host');
    const joinerCookie = await registerAndGetCookie('games_join');
    const created = await request(app)
      .post('/api/games')
      .set('Cookie', hostCookie)
      .send({ format: 'commander' });
    const code = created.body.game.code as string;

    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joinerCookie)
      .send({ name: 'Bob' });
    expect(joined.status).toBe(200);
    expect(joined.body.game.players).toHaveLength(2);

    const started = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', hostCookie)
      .send({ baseVersion: joined.body.game.version, actions: [{ type: 'start' }] });
    expect(started.status).toBe(200);
    expect(started.body.game.status).toBe('active');

    // Non-host participant can adjust life.
    const lifed = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joinerCookie)
      .send({
        baseVersion: started.body.game.version,
        actions: [{ type: 'life', seat: 0, delta: -5, actorSeat: 1 }],
      });
    expect(lifed.status).toBe(200);
    expect(lifed.body.game.players[0].life).toBe(35);
  });

  it('returns 409 on stale baseVersion', async () => {
    const cookie = await registerAndGetCookie('games_conflict');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({ baseVersion: 99, actions: [{ type: 'start' }] });
    expect(res.status).toBe(409);
    expect(res.body.current).toBeDefined();
  });

  it('non-host non-participant is blocked from mutating', async () => {
    const host = await registerAndGetCookie('games_h2');
    const stranger = await registerAndGetCookie('games_s2');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', stranger)
      .send({
        baseVersion: created.body.game.version,
        actions: [{ type: 'life', seat: 0, delta: -1, actorSeat: 0 }],
      });
    expect(res.status).toBe(403);
  });

  it('non-host cannot start / reset / change settings', async () => {
    const host = await registerAndGetCookie('games_h3');
    const joiner = await registerAndGetCookie('games_j3');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({ baseVersion: joined.body.game.version, actions: [{ type: 'start' }] });
    expect(res.status).toBe(403);
  });
});

d('POST /api/games/:code/leave', () => {
  it('host leave deletes the session', async () => {
    const host = await registerAndGetCookie('games_leave_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const res = await request(app).post(`/api/games/${code}/leave`).set('Cookie', host).send({});
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    const after = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    expect(after.status).toBe(404);
  });

  it('lobby joiner leave removes their seat', async () => {
    const host = await registerAndGetCookie('games_leave_h2');
    const joiner = await registerAndGetCookie('games_leave_j');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner).send({});
    const res = await request(app).post(`/api/games/${code}/leave`).set('Cookie', joiner).send({});
    expect(res.status).toBe(200);
    expect(res.body.game.players).toHaveLength(1);
  });
});
