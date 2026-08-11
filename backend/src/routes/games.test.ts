import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http, { type Server } from 'node:http';
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

let app: Server;
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

/**
 * Opens `GET /api/games/:code/events` with a raw `http.request` (supertest's
 * `.end()` callback never fires for a stream that stays open) and resolves
 * once either a non-200 status lands, or `count` `event: state` frames have
 * been parsed out of the response body — whichever comes first. Always
 * destroys the connection before resolving, so the test doesn't leak an open
 * socket (and the server's `req.on('close')` teardown gets exercised too).
 */
function openGameEvents(
  cookie: string,
  code: string,
  count: number
): Promise<{ status: number; body?: unknown; events: unknown[] }> {
  return new Promise((resolve, reject) => {
    const addr = app.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('test server has no address'));
      return;
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: `/api/games/${code}/events`,
        method: 'GET',
        headers: { Cookie: cookie },
      },
      (res) => {
        let raw = '';
        const events: unknown[] = [];
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf-8');
          if (res.statusCode !== 200) return;
          // Frames are separated by a blank line; parse out any full
          // `event: state\ndata: <json>` frames seen so far.
          const matches = raw.matchAll(/event: state\ndata: (.+)\n\n/g);
          events.length = 0;
          for (const m of matches) events.push(JSON.parse(m[1]));
          if (events.length >= count) {
            req.destroy();
            resolve({ status: res.statusCode!, events });
          }
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            let body: unknown;
            try {
              body = JSON.parse(raw);
            } catch {
              /* leave body undefined */
            }
            resolve({ status: res.statusCode!, body, events });
          }
        });
      }
    );
    // req.destroy() above intentionally aborts the socket once we have what
    // we need; that surfaces here as an ECONNRESET-ish error, which is the
    // expected teardown path, not a test failure.
    req.on('error', () => {
      /* expected once we've resolved via req.destroy() */
    });
    req.end();
  });
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

  // Join codes are 4 chars (~1M), so without this an authed stranger could
  // sweep the space and harvest every live session's seats, deck names and
  // commanders. The 404 must be indistinguishable from an unknown code.
  it('404s for an authed non-participant, identically to an unknown code', async () => {
    const hostCookie = await registerAndGetCookie('games_get_host');
    const strangerCookie = await registerAndGetCookie('games_get_stranger');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;

    const stranger = await request(app).get(`/api/games/${code}`).set('Cookie', strangerCookie);
    const unknown = await request(app).get('/api/games/ZZZZ').set('Cookie', strangerCookie);
    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual(unknown.body);
    expect(stranger.body.game).toBeUndefined();
  });

  it('serves the full state once the caller holds a seat', async () => {
    const hostCookie = await registerAndGetCookie('games_get_seat_host');
    const joinerCookie = await registerAndGetCookie('games_get_seat_joiner');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;

    const before = await request(app).get(`/api/games/${code}`).set('Cookie', joinerCookie);
    expect(before.status).toBe(404);

    await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joinerCookie)
      .send({ name: 'Joiner' });

    const after = await request(app).get(`/api/games/${code}`).set('Cookie', joinerCookie);
    expect(after.status).toBe(200);
    expect(after.body.game.code).toBe(code);
  });
});

describe('GET /api/games/:code/events (SSE)', () => {
  it('streams the current state to a participant on connect', async () => {
    const hostCookie = await registerAndGetCookie('games_sse_host');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;

    const { status, events } = await openGameEvents(hostCookie, code, 1);
    expect(status).toBe(200);
    expect((events[0] as { code: string }).code).toBe(code);
    expect((events[0] as { players: unknown[] }).players).toHaveLength(1);
  });

  // Same sweep risk as GET /:code — see the comment on that handler. A
  // non-participant must get an identical body to an unknown code, never a
  // hint the code is live.
  it('404s for an authed non-participant, identically to GET /:code and an unknown code', async () => {
    const hostCookie = await registerAndGetCookie('games_sse_host2');
    const strangerCookie = await registerAndGetCookie('games_sse_stranger');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;

    const streamed = await openGameEvents(strangerCookie, code, 1);
    const plainGet = await request(app).get(`/api/games/${code}`).set('Cookie', strangerCookie);
    const unknownGet = await request(app).get('/api/games/ZZZZ').set('Cookie', strangerCookie);

    expect(streamed.status).toBe(404);
    expect(streamed.body).toEqual(plainGet.body);
    expect(streamed.body).toEqual(unknownGet.body);
  });

  it('rejects unauthenticated requests', async () => {
    const created = await request(app)
      .post('/api/games')
      .set('Cookie', await registerAndGetCookie('games_sse_host3'))
      .send({});
    const code = created.body.game.code as string;
    const res = await request(app).get(`/api/games/${code}/events`);
    expect(res.status).toBe(401);
  });

  it('broadcasts a mutation to a connected subscriber', async () => {
    const hostCookie = await registerAndGetCookie('games_sse_bcast_h');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;

    // Collect the initial connect frame + the frame the PATCH below triggers.
    const streamPromise = openGameEvents(hostCookie, code, 2);
    // Give the connection a beat to register as a subscriber before mutating —
    // otherwise the PATCH could win the race and broadcast to no one yet.
    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', hostCookie)
      .send({ baseVersion: created.body.game.version, actions: [{ type: 'start' }] });

    const { status, events } = await streamPromise;
    expect(status).toBe(200);
    expect((events[0] as { status: string }).status).toBe('lobby');
    expect((events[1] as { status: string }).status).toBe('active');
  });
});

describe('GET /api/games/:code/poll (long-poll)', () => {
  // Same sweep risk as GET /:code and /events — see the comment on GET /:code.
  it('404s for an authed non-participant, identically to GET /:code and /events', async () => {
    const hostCookie = await registerAndGetCookie('games_poll_host1');
    const strangerCookie = await registerAndGetCookie('games_poll_stranger1');
    const created = await request(app).post('/api/games').set('Cookie', hostCookie).send({});
    const code = created.body.game.code as string;

    const polled = await request(app)
      .get(`/api/games/${code}/poll?since=0`)
      .set('Cookie', strangerCookie);
    const plainGet = await request(app).get(`/api/games/${code}`).set('Cookie', strangerCookie);
    const unknownGet = await request(app).get('/api/games/ZZZZ').set('Cookie', strangerCookie);

    expect(polled.status).toBe(404);
    expect(polled.body).toEqual(plainGet.body);
    expect(polled.body).toEqual(unknownGet.body);
  });

  it('rejects unauthenticated requests', async () => {
    const created = await request(app)
      .post('/api/games')
      .set('Cookie', await registerAndGetCookie('games_poll_host2'))
      .send({});
    const code = created.body.game.code as string;
    const res = await request(app).get(`/api/games/${code}/poll?since=0`);
    expect(res.status).toBe(401);
  });

  it('responds immediately with the full state when `since` is already stale', async () => {
    const cookie = await registerAndGetCookie('games_poll_stale');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app).get(`/api/games/${code}/poll?since=-1`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.code).toBe(code);
  });

  it('also responds immediately when `since` is missing or invalid', async () => {
    const cookie = await registerAndGetCookie('games_poll_missing_since');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app).get(`/api/games/${code}/poll`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.code).toBe(code);
  });

  it('a held request is released by a mutation broadcasting for that code', async () => {
    const cookie = await registerAndGetCookie('games_poll_release');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const version = created.body.game.version as number;

    const pollPromise = request(app)
      .get(`/api/games/${code}/poll?since=${version}`)
      .set('Cookie', cookie);
    // Give the request a beat to register as a subscriber before mutating —
    // otherwise the PATCH could win the race and broadcast to no one yet.
    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({ baseVersion: version, actions: [{ type: 'start' }] });

    const res = await pollPromise;
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe('active');
    expect(res.body.game.version).toBeGreaterThan(version);
  });

  it('the timeout path answers { unchanged: true } when nothing happens', async () => {
    const cookie = await registerAndGetCookie('games_poll_timeout');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const version = created.body.game.version as number;

    const res = await request(app)
      .get(`/api/games/${code}/poll?since=${version}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unchanged: true });
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

  /**
   * Regression cover for the write-after-end process kill. `broadcastGameDeleted`
   * → `onDeleted` → `res.end()` does not clear that stream's 25s heartbeat (only
   * `req.on('close')` does), so a tick landing between the `end()` and socket
   * teardown writes to an ended response and emits ERR_STREAM_WRITE_AFTER_END —
   * fatal, since nothing installs an `uncaughtException` handler. Guarded in the
   * route by a no-op 'error' listener plus a `writableEnded` check.
   *
   * The ~1ms race isn't reproducible against a 25s timer without plumbing the
   * interval for tests, so this covers the deletion path end-to-end: the server
   * must end an open stream on host leave and still be serving afterwards.
   * Generous timeout because it waits on a real socket while the rest of this
   * file's suite contends for the same test Postgres.
   */
  it('ends an open SSE stream on host leave, and keeps serving', async () => {
    const host = await registerAndGetCookie('games_sse_teardown');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;

    const addr = app.address();
    if (!addr || typeof addr === 'string') throw new Error('test server has no address');

    const trace: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`stream never ended; trace=${trace.join(' -> ') || 'nothing'}`)),
        15000
      );
      const req = http.request(
        {
          host: '127.0.0.1',
          port: addr.port,
          path: `/api/games/${code}/events`,
          method: 'GET',
          headers: { Cookie: host },
        },
        (res) => {
          trace.push(`status=${res.statusCode}`);
          let triggered = false;
          res.on('data', (chunk: Buffer) => {
            if (triggered || !chunk.toString('utf-8').includes('event: state')) return;
            triggered = true;
            trace.push('frame');
            // Host leave = end + delete -> broadcastGameDeleted -> res.end().
            request(app)
              .post(`/api/games/${code}/leave`)
              .set('Cookie', host)
              .send({})
              .then((r) => trace.push(`leave=${r.status}`))
              .catch((e: Error) => trace.push(`leave-threw=${e.message}`));
          });
          res.on('end', () => {
            clearTimeout(timer);
            resolve();
          });
        }
      );
      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.end();
    });

    // Still up and serving: ending that stream did not take the process with it.
    const after = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    expect(after.status).toBe(404);
  }, 20000);
});
