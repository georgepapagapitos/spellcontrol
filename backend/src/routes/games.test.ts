import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { isUniqueViolation } from './games';

describe('isUniqueViolation (F20 join-code race guard)', () => {
  it('matches only a Postgres 23505 error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
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

describe('POST /api/games', () => {
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

  it('defaults the host player name to their username when no hostName is supplied', async () => {
    const cookie = await registerAndGetCookie('games_hostname_plain');
    const res = await request(app).post('/api/games').set('Cookie', cookie).send({});
    expect(res.body.game.players[0].name).toBe('games_hostname_plain');
  });

  it('prefers the host’s display name over username when set', async () => {
    const cookie = await registerAndGetCookie('games_hostname_dn');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Host H.' });
    const res = await request(app).post('/api/games').set('Cookie', cookie).send({});
    expect(res.body.game.players[0].name).toBe('Host H.');
  });

  it('an explicit hostName still wins over the display name', async () => {
    const cookie = await registerAndGetCookie('games_hostname_override');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Host H.' });
    const res = await request(app)
      .post('/api/games')
      .set('Cookie', cookie)
      .send({ hostName: 'Custom Name' });
    expect(res.body.game.players[0].name).toBe('Custom Name');
  });
});

describe('GET /api/games/:code', () => {
  it('returns the full state with no knownVersion', async () => {
    const cookie = await registerAndGetCookie('games_get_full');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app).get(`/api/games/${code}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.code).toBe(code);
    expect(res.body.unchanged).toBeUndefined();
  });

  it('short-circuits to { unchanged: true } when knownVersion matches', async () => {
    const cookie = await registerAndGetCookie('games_get_unchanged');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const version = created.body.game.version as number;
    const res = await request(app)
      .get(`/api/games/${code}?knownVersion=${version}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unchanged: true });
  });

  it('returns the full state when knownVersion is stale', async () => {
    const cookie = await registerAndGetCookie('games_get_stale');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app).get(`/api/games/${code}?knownVersion=999`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.code).toBe(code);
  });
});

describe('POST /api/games/:code/join + PATCH /:code', () => {
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

  it('defaults a joiner’s name to their display name (falls back to username) when no name is sent', async () => {
    const hostCookie = await registerAndGetCookie('games_joinname_host');
    const joinerCookie = await registerAndGetCookie('games_joinname_joiner');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joinerCookie)
      .send({});
    const p = joined.body.game.players.find((pl: { isHost: boolean }) => !pl.isHost);
    expect(p.name).toBe('games_joinname_joiner');
  });

  it('prefers the joiner’s display name over username when set', async () => {
    const hostCookie = await registerAndGetCookie('games_joinname_dn_host');
    const joinerCookie = await registerAndGetCookie('games_joinname_dn_joiner');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', joinerCookie)
      .send({ displayName: 'Joiner J.' });
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joinerCookie)
      .send({});
    const p = joined.body.game.players.find((pl: { isHost: boolean }) => !pl.isHost);
    expect(p.name).toBe('Joiner J.');
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

describe('miscellaneous', () => {
  it('GET unknown code returns 404', async () => {
    const cookie = await registerAndGetCookie('games_misc1');
    const res = await request(app).get('/api/games/ZZZZ').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('PATCH unknown code returns 404', async () => {
    const cookie = await registerAndGetCookie('games_misc2');
    const res = await request(app)
      .patch('/api/games/ZZZZ')
      .set('Cookie', cookie)
      .send({ baseVersion: 0, actions: [{ type: 'start' }] });
    expect(res.status).toBe(404);
  });

  it('PATCH rejects empty / oversized action lists', async () => {
    const cookie = await registerAndGetCookie('games_misc3');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const empty = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({ baseVersion: created.body.game.version, actions: [] });
    expect(empty.status).toBe(400);
    const huge = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version,
        actions: Array.from({ length: 51 }, () => ({
          type: 'note',
          actorSeat: null,
          message: 'x',
        })),
      });
    expect(huge.status).toBe(400);
  });

  it('PATCH rejects missing baseVersion', async () => {
    const cookie = await registerAndGetCookie('games_misc4');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({ actions: [{ type: 'start' }] });
    expect(res.status).toBe(400);
  });

  it('PATCH sanitizes panelColorKey on update-player', async () => {
    const host = await registerAndGetCookie('games_pck_h');
    const joiner = await registerAndGetCookie('games_pck_j');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});

    // Valid override flows through; lowercase is normalized to uppercase.
    const valid = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({
        baseVersion: joined.body.game.version,
        actions: [{ type: 'update-player', seat: 1, patch: { panelColorKey: 'r' } }],
      });
    expect(valid.status).toBe(200);
    const seat1 = valid.body.game.players.find((p: { seat: number }) => p.seat === 1);
    expect(seat1.panelColorKey).toBe('R');

    // Garbage value gets coerced to null instead of landing in a CSS class.
    const garbage = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({
        baseVersion: valid.body.game.version,
        actions: [
          { type: 'update-player', seat: 1, patch: { panelColorKey: '"><script>x</script>' } },
        ],
      });
    expect(garbage.status).toBe(200);
    const seat1After = garbage.body.game.players.find((p: { seat: number }) => p.seat === 1);
    expect(seat1After.panelColorKey).toBeNull();

    // Explicit null is preserved (it means "reset to auto").
    const cleared = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({
        baseVersion: garbage.body.game.version,
        actions: [{ type: 'update-player', seat: 1, patch: { panelColorKey: null } }],
      });
    expect(cleared.status).toBe(200);
  });

  it('PATCH sanitizes colorIdentity on update-player', async () => {
    const host = await registerAndGetCookie('games_ci_h');
    const joiner = await registerAndGetCookie('games_ci_j');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({
        baseVersion: joined.body.game.version,
        actions: [
          {
            type: 'update-player',
            seat: 1,
            patch: { colorIdentity: ['w', 'X', 'u', 'u'] },
          },
        ],
      });
    expect(res.status).toBe(200);
    const seat1 = res.body.game.players.find((p: { seat: number }) => p.seat === 1);
    expect(seat1.colorIdentity).toEqual(['W', 'U']);
  });

  it('PATCH whitelists update-player patch (F1: no forged userId/isHost/life)', async () => {
    const host = await registerAndGetCookie('games_wl_h');
    const joiner = await registerAndGetCookie('games_wl_j');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});
    const before = joined.body.game.players.find((p: { seat: number }) => p.seat === 1);

    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({
        baseVersion: joined.body.game.version,
        actions: [
          {
            type: 'update-player',
            seat: 1,
            patch: {
              userId: before.userId === 'victim' ? 'other' : 'victim',
              isHost: true,
              life: 999,
              eliminated: true,
              name: 'ok',
            },
          },
        ],
      });
    expect(res.status).toBe(200);
    const after = res.body.game.players.find((p: { seat: number }) => p.seat === 1);
    // Whitelisted field applied; smuggled fields ignored.
    expect(after.name).toBe('ok');
    expect(after.userId).toBe(before.userId);
    expect(after.isHost).toBe(false);
    expect(after.life).toBe(before.life);
    expect(after.eliminated).toBe(false);
  });

  it('PATCH caps update-player name at 40 chars (F32)', async () => {
    const host = await registerAndGetCookie('games_cap_h');
    const joiner = await registerAndGetCookie('games_cap_j');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiner)
      .send({
        baseVersion: joined.body.game.version,
        actions: [{ type: 'update-player', seat: 1, patch: { name: 'x'.repeat(80) } }],
      });
    expect(res.status).toBe(200);
    const after = res.body.game.players.find((p: { seat: number }) => p.seat === 1);
    expect(after.name).toHaveLength(40);
  });

  it('PATCH rejects a non-finite numeric field with 400 (F2)', async () => {
    const cookie = await registerAndGetCookie('games_num');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({ baseVersion: created.body.game.version, actions: [{ type: 'start' }] });
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version + 1,
        actions: [{ type: 'life', seat: 0, delta: 'oops', actorSeat: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it('PATCH surfaces reducer errors as 400', async () => {
    const cookie = await registerAndGetCookie('games_misc5');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version,
        actions: [{ type: 'life', seat: 99, delta: -1, actorSeat: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it('join rejects after the game has started', async () => {
    const host = await registerAndGetCookie('games_misc_h');
    const stranger = await registerAndGetCookie('games_misc_s');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({ baseVersion: created.body.game.version, actions: [{ type: 'start' }] });
    const res = await request(app).post(`/api/games/${code}/join`).set('Cookie', stranger).send({});
    expect(res.status).toBe(409);
  });

  it('re-join updates an existing seat in place', async () => {
    const host = await registerAndGetCookie('games_rj_h');
    const joiner = await registerAndGetCookie('games_rj_j');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const first = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({ name: 'A', deckName: 'D1' });
    expect(first.body.game.players).toHaveLength(2);
    const second = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({ name: 'B', deckName: 'D2' });
    expect(second.status).toBe(200);
    expect(second.body.game.players).toHaveLength(2);
    const p = second.body.game.players.find((pl: { name: string }) => pl.name === 'B');
    expect(p).toBeTruthy();
    expect(p.deckName).toBe('D2');
  });
});

describe('POST /api/games/:code/leave', () => {
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

  it('mid-game joiner leave marks them disconnected (seat preserved)', async () => {
    const host = await registerAndGetCookie('games_leave_h3');
    const joiner = await registerAndGetCookie('games_leave_j3');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});
    await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({ baseVersion: joined.body.game.version, actions: [{ type: 'start' }] });
    const res = await request(app).post(`/api/games/${code}/leave`).set('Cookie', joiner).send({});
    expect(res.status).toBe(200);
    expect(res.body.game.players).toHaveLength(2);
    const me = res.body.game.players.find((p: { isHost: boolean }) => !p.isHost);
    expect(me.connected).toBe(false);
  });

  it('leave on unknown code returns 404', async () => {
    const cookie = await registerAndGetCookie('games_leave_nf');
    const res = await request(app).post('/api/games/ZZZZ/leave').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('leave by a non-participant is a no-op (200, state unchanged)', async () => {
    const host = await registerAndGetCookie('games_leave_h4');
    const stranger = await registerAndGetCookie('games_leave_s4');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .post(`/api/games/${code}/leave`)
      .set('Cookie', stranger)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.game).toBeDefined();
    expect(res.body.game.players).toHaveLength(1);
  });
});
