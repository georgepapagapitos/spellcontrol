import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http, { type Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { isUniqueViolation, SIGNAL_EMOTES } from './games';

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

/**
 * Same connection mechanics as `openGameEvents`, but parses ANY `event: X`
 * frame (not just `state`) and resolves once `count` total frames have
 * arrived. Used by the board-relay tests below, which need to see both the
 * initial `state` frame and any `board` frames.
 */
function openGameEventsAnyFrame(
  cookie: string,
  code: string,
  count: number
): Promise<{ status: number; frames: Array<{ type: string; data: unknown }> }> {
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
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf-8');
          if (res.statusCode !== 200) return;
          const frames: Array<{ type: string; data: unknown }> = [];
          const re = /event: (\w+)\ndata: (.+)\n\n/g;
          for (const m of raw.matchAll(re)) {
            try {
              frames.push({ type: m[1], data: JSON.parse(m[2]) });
            } catch {
              /* partial frame — ignore */
            }
          }
          if (frames.length >= count) {
            req.destroy();
            resolve({ status: res.statusCode!, frames });
          }
        });
        res.on('end', () => {
          if (res.statusCode !== 200) resolve({ status: res.statusCode!, frames: [] });
        });
      }
    );
    req.on('error', () => {
      /* expected once we've resolved via req.destroy() */
    });
    req.end();
  });
}

/** A minimally-valid `PublicBoard` body — enough to pass `isPlausibleBoard`. */
const validBoard = {
  turn: 1,
  life: 40,
  commanderTax: {},
  monarch: false,
  initiative: false,
  citysBlessing: false,
  battlefield: [],
  graveyard: [],
  exile: [],
  command: [],
  handCount: 7,
  libraryCount: 92,
};

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

  /**
   * F1 regression: `/events` only checked `isParticipant` at connect, so a
   * player removed via the host-only `remove-player` action kept their
   * still-open SSE stream and went on receiving every future frame.
   * `broadcastGameState` now evicts (ends + removes) any subscriber the new
   * state no longer counts as a participant, before fanning out — so the
   * kicked stream ends right on the removal broadcast, and the removal's own
   * state frame (with the seat gone) never reaches it.
   */
  it("ends a removed player's SSE stream on the remove-player PATCH, delivering no further state", async () => {
    const host = await registerAndGetCookie('games_kick_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joiner = await registerAndGetCookie('games_kick_j');
    const joined = await request(app)
      .post(`/api/games/${code}/join`)
      .set('Cookie', joiner)
      .send({});

    const addr = app.address();
    if (!addr || typeof addr === 'string') throw new Error('test server has no address');

    const frames: unknown[] = [];
    const streamEnded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`stream never ended; frames=${frames.length}`)),
        15000
      );
      const req = http.request(
        {
          host: '127.0.0.1',
          port: addr.port,
          path: `/api/games/${code}/events`,
          method: 'GET',
          headers: { Cookie: joiner },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk: Buffer) => {
            raw += chunk.toString('utf-8');
            const matches = raw.matchAll(/event: state\ndata: (.+)\n\n/g);
            frames.length = 0;
            for (const m of matches) frames.push(JSON.parse(m[1]));
          });
          res.on('end', () => {
            clearTimeout(timer);
            resolve();
          });
        }
      );
      req.on('error', () => {
        /* expected once the server ends the stream */
      });
      req.end();
    });

    // Give the connection a beat to register as a subscriber before kicking —
    // otherwise the PATCH could win the race and evict nobody.
    await new Promise((r) => setTimeout(r, 50));
    const kicked = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: joined.body.game.version,
        actions: [{ type: 'remove-player', seat: 1 }],
      });
    expect(kicked.status).toBe(200);

    await streamEnded;
    // Only the initial connect frame ever arrived — the removal's own state
    // broadcast (players down to 1) was never delivered to this subscriber.
    expect(frames).toHaveLength(1);
    expect((frames[0] as { players: unknown[] }).players).toHaveLength(2);
  }, 20000);
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
    // The timeout branch now carries the same boards/requests snapshots
    // every other /poll response does (F4) — empty here since nothing was
    // published.
    expect(res.body).toEqual({ unchanged: true, boards: [], requests: [] });
  });

  it('catchUp=1 responds immediately with the current boards snapshot even when `since` is not stale', async () => {
    const host = await registerAndGetCookie('games_poll_catchup_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joiner = await registerAndGetCookie('games_poll_catchup_j');
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner).send({});
    await request(app).post(`/api/games/${code}/board`).set('Cookie', joiner).send(validBoard);

    const current = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    const since = current.body.game.version as number;

    // `since` exactly matches — without catchUp this would hold, not answer
    // immediately (see the "since is already stale" test above for contrast).
    const res = await request(app)
      .get(`/api/games/${code}/poll?since=${since}&catchUp=1`)
      .set('Cookie', host);
    expect(res.status).toBe(200);
    expect(res.body.game.code).toBe(code);
    const entry = (res.body.boards as Array<{ seat: number }>).find((b) => b.seat === 1);
    expect(entry).toBeTruthy();
  });

  /**
   * F4 regression: a held poll settles on the FIRST thing that resolves it
   * and the subscriber is torn down — anything else broadcast in the same
   * turnaround window was silently dropped (a board only self-healed on the
   * client's *next* poll; a consent request had no re-delivery path at all).
   * Every branch now carries the full `boards`/`requests` snapshots, not
   * just the single item that resolved it.
   */
  it('a board-resolved held poll response carries the full boards + requests snapshots', async () => {
    const host = await registerAndGetCookie('games_poll_boardres_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joiner1 = await registerAndGetCookie('games_poll_boardres_j1');
    const joiner2 = await registerAndGetCookie('games_poll_boardres_j2');
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner1).send({});
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner2).send({});

    // Establish presence (F3) for host + joiner1 first, via the same GET a
    // real client's poll-loop fallback issues, so each is a required
    // approver and the request raised below stays 'pending' instead of
    // auto-resolving the moment nobody's left to ask.
    await request(app).get(`/api/games/${code}`).set('Cookie', joiner1);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    const version = current.body.game.version as number;

    // A pending request unrelated to the board publish below — proves the
    // `requests` array on the board-resolved response is the FULL current
    // snapshot, not just the thing that resolved this particular poll.
    await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', joiner2)
      .send(rewindRequestBody);

    // supertest/superagent only actually dispatches a request once it's
    // awaited (`.then()` triggers `.end()` internally) — a bare
    // `request(app).get(...)` assigned to a variable sends nothing yet. Using
    // `.end()` with a callback here forces the poll to go out over the wire
    // immediately, so it's genuinely held (and registered as a subscriber)
    // before the board publish below, rather than firing lazily afterward
    // and missing the live broadcast.
    const pollPromise = new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve, reject) => {
        request(app)
          .get(`/api/games/${code}/poll?since=${version}`)
          .set('Cookie', host)
          .end((err, res) => (err ? reject(err) : resolve(res)));
      }
    );
    // Give the poll a beat to register as a subscriber before publishing —
    // otherwise the publish could win the race and resolve nobody.
    await new Promise((r) => setTimeout(r, 50));
    await request(app).post(`/api/games/${code}/board`).set('Cookie', joiner1).send(validBoard);

    const res = await pollPromise;
    expect(res.status).toBe(200);
    expect((res.body.board as { seat: number }).seat).toBe(1);
    const boardsSeats = (res.body.boards as Array<{ seat: number }>).map((b) => b.seat);
    expect(boardsSeats).toEqual([1]);
    const resolvedRequests = res.body.requests as Array<{ status: string }>;
    expect(resolvedRequests).toHaveLength(1);
    expect(resolvedRequests[0].status).toBe('pending');
  });
});

describe('POST /api/games/:code/board (board relay)', () => {
  it('rejects unauthenticated requests', async () => {
    const created = await request(app)
      .post('/api/games')
      .set('Cookie', await registerAndGetCookie('games_board_auth'))
      .send({});
    const code = created.body.game.code as string;
    const res = await request(app).post(`/api/games/${code}/board`).send(validBoard);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown code', async () => {
    const cookie = await registerAndGetCookie('games_board_unknown');
    const res = await request(app)
      .post('/api/games/ZZZZ/board')
      .set('Cookie', cookie)
      .send(validBoard);
    expect(res.status).toBe(404);
  });

  // Stealth 404: a non-participant on a REAL code must get the byte-identical
  // response an unknown code gives, or this route becomes an oracle for
  // enumerating live 4-char join codes — the sweep every read route here
  // deliberately closes.
  it('gives a non-participant the same 404 an unknown code gives', async () => {
    const host = await registerAndGetCookie('games_board_np_h');
    const stranger = await registerAndGetCookie('games_board_np_s');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const real = await request(app)
      .post(`/api/games/${code}/board`)
      .set('Cookie', stranger)
      .send(validBoard);
    const unknown = await request(app)
      .post('/api/games/ZZZZ/board')
      .set('Cookie', stranger)
      .send(validBoard);
    expect(real.status).toBe(404);
    expect(real.status).toBe(unknown.status);
    expect(real.body).toEqual(unknown.body);
  });

  it('rejects a malformed payload with 400', async () => {
    const host = await registerAndGetCookie('games_board_malformed');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .post(`/api/games/${code}/board`)
      .set('Cookie', host)
      .send({ turn: 'not a number' });
    expect(res.status).toBe(400);
  });

  it('rejects an oversized payload with 413', async () => {
    const host = await registerAndGetCookie('games_board_oversized');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const huge = {
      ...validBoard,
      battlefield: Array.from({ length: 5000 }, (_, i) => ({
        card: { id: `slot_${i}`, name: 'x'.repeat(200) },
        tapped: false,
        counters: {},
        stickers: [],
        x: 0.1,
        y: 0.1,
        faceDown: false,
      })),
    };
    const res = await request(app).post(`/api/games/${code}/board`).set('Cookie', host).send(huge);
    expect(res.status).toBe(413);
  });

  it('a connected subscriber receives a published board as a `board` frame', async () => {
    const host = await registerAndGetCookie('games_board_sse_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joiner = await registerAndGetCookie('games_board_sse_j');
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner).send({});

    // Host's own stream: initial `state` frame + the `board` frame the
    // joiner's publish below triggers.
    const streamPromise = openGameEventsAnyFrame(host, code, 2);
    // Give the connection a beat to register as a subscriber before
    // publishing — otherwise the publish could win the race and broadcast
    // to no one yet.
    await new Promise((r) => setTimeout(r, 50));
    const posted = await request(app)
      .post(`/api/games/${code}/board`)
      .set('Cookie', joiner)
      .send(validBoard);
    expect(posted.status).toBe(200);

    const { status, frames } = await streamPromise;
    expect(status).toBe(200);
    const boardFrame = frames.find((f) => f.type === 'board');
    expect(boardFrame).toBeTruthy();
    expect((boardFrame!.data as { seat: number }).seat).toBe(1);
  });

  it('ignores a spoofed seat in the body — always stores/broadcasts under the caller’s real seat', async () => {
    const host = await registerAndGetCookie('games_board_spoof_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joiner = await registerAndGetCookie('games_board_spoof_j');
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner).send({});

    const streamPromise = openGameEventsAnyFrame(host, code, 2);
    await new Promise((r) => setTimeout(r, 50));
    // Joiner is seat 1; body claims to be seat 0 (the host's seat).
    await request(app)
      .post(`/api/games/${code}/board`)
      .set('Cookie', joiner)
      .send({ ...validBoard, seat: 0 });

    const { frames } = await streamPromise;
    const boardFrame = frames.find((f) => f.type === 'board');
    expect(boardFrame).toBeTruthy();
    expect((boardFrame!.data as { seat: number }).seat).toBe(1);
  });

  it('a late subscriber catches up on a board published before it connected', async () => {
    const host = await registerAndGetCookie('games_board_late_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const joiner = await registerAndGetCookie('games_board_late_j');
    await request(app).post(`/api/games/${code}/join`).set('Cookie', joiner).send({});

    // Published BEFORE the host subscribes.
    await request(app).post(`/api/games/${code}/board`).set('Cookie', joiner).send(validBoard);

    // Connect after the fact — initial `state` frame + the catch-up `board` frame.
    const { frames } = await openGameEventsAnyFrame(host, code, 2);
    const boardFrame = frames.find((f) => f.type === 'board');
    expect(boardFrame).toBeTruthy();
    expect((boardFrame!.data as { seat: number }).seat).toBe(1);
  });
});

/** Minimal valid rewind-request creation body. */
const rewindRequestBody = { kind: 'rewind', payload: { steps: 2, summary: 'undo two draws' } };

/**
 * Seats up a host + N joiners, returns their cookies and the code. By
 * default each joiner also issues one `GET /:code` right after joining —
 * mirroring a real client, which opens its live transport (SSE/poll)
 * immediately after join — so it registers presence (see `touchPresence`/
 * `isSeatPresent` in the route) and reads as a normal connected-and-present
 * seat to `requiredApprovers`. Pass `presence: false` for a joiner that must
 * stay presence-less on purpose (F3's "seat that never showed up" case).
 */
async function setupTable(
  hostName: string,
  joinerNames: string[],
  opts: { presence?: boolean } = {}
): Promise<{ code: string; host: string; joiners: string[] }> {
  const presence = opts.presence ?? true;
  const host = await registerAndGetCookie(hostName);
  const created = await request(app).post('/api/games').set('Cookie', host).send({});
  const code = created.body.game.code as string;
  const joiners: string[] = [];
  for (const name of joinerNames) {
    const cookie = await registerAndGetCookie(name);
    await request(app).post(`/api/games/${code}/join`).set('Cookie', cookie).send({});
    if (presence) await request(app).get(`/api/games/${code}`).set('Cookie', cookie);
    joiners.push(cookie);
  }
  return { code, host, joiners };
}

describe('POST /api/games/:code/request (rewind consent channel)', () => {
  it('rejects unauthenticated requests', async () => {
    const { code } = await setupTable('games_req_auth', []);
    const res = await request(app).post(`/api/games/${code}/request`).send(rewindRequestBody);
    expect(res.status).toBe(401);
  });

  it('404s for a non-participant, byte-identical to an unknown code', async () => {
    const { code } = await setupTable('games_req_np_h', []);
    const stranger = await registerAndGetCookie('games_req_np_s');
    const real = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', stranger)
      .send(rewindRequestBody);
    const unknown = await request(app)
      .post('/api/games/ZZZZ/request')
      .set('Cookie', stranger)
      .send(rewindRequestBody);
    expect(real.status).toBe(404);
    expect(real.body).toEqual(unknown.body);
  });

  it('rejects an unsupported kind', async () => {
    const { code, host } = await setupTable('games_req_kind', ['games_req_kind_j']);
    const res = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send({ kind: 'mulligan', payload: { steps: 1, summary: 'x' } });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed payload', async () => {
    const { code, host } = await setupTable('games_req_bad', ['games_req_bad_j']);
    const res = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send({ kind: 'rewind', payload: { steps: -1, summary: '' } });
    expect(res.status).toBe(400);
  });

  it('creates a pending request with a server-generated id, and a second raise from the same seat is rejected', async () => {
    const { code, host } = await setupTable('games_req_dup_h', ['games_req_dup_j']);
    const first = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(first.status).toBe(201);
    expect(first.body.request.id).toBeTruthy();
    expect(first.body.request.status).toBe('pending');
    expect(first.body.request.requesterSeat).toBe(0);

    const second = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(second.status).toBe(409);
  });

  it('resolves approved immediately when no other seat is connected', async () => {
    const { code, host } = await setupTable('games_req_solo', []);
    const res = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('approved');
  });
});

describe('POST /api/games/:code/request/:id/respond (resolution policy)', () => {
  it('one decline resolves the request denied immediately, without waiting on other seats', async () => {
    const { code, host, joiners } = await setupTable('games_resp_deny_h', [
      'games_resp_deny_j1',
      'games_resp_deny_j2',
    ]);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;

    const declined = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: false });
    expect(declined.status).toBe(200);
    expect(declined.body.request.status).toBe('denied');

    // Second seat never got to weigh in — the request is already gone (a
    // resolved request is removed, not kept around in a "denied" state), so
    // this reads as an ordinary not-found rather than a conflict.
    const secondResponse = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[1])
      .send({ approve: true });
    expect(secondResponse.status).toBe(404);
  });

  it('unanimous approval from every connected non-requester seat resolves approved', async () => {
    const { code, host, joiners } = await setupTable('games_resp_appr_h', [
      'games_resp_appr_j1',
      'games_resp_appr_j2',
    ]);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;

    const first = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: true });
    expect(first.status).toBe(200);
    expect(first.body.request.status).toBe('pending');

    const second = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[1])
      .send({ approve: true });
    expect(second.status).toBe(200);
    expect(second.body.request.status).toBe('approved');
  });

  it('a disconnected seat does not block approval — unanimity is over connected seats only', async () => {
    const { code, host, joiners } = await setupTable('games_resp_disc_h', [
      'games_resp_disc_j1',
      'games_resp_disc_j2',
    ]);
    // Seat 2 (joiners[1]) leaves mid-game-lobby, so it's dropped entirely —
    // use a mid-game disconnect instead so the seat (and its `connected`
    // flag) stays on the roster but flips false.
    const joinedState = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({ baseVersion: joinedState.body.game.version, actions: [{ type: 'start' }] });
    await request(app).post(`/api/games/${code}/leave`).set('Cookie', joiners[1]).send({});

    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;

    // Only the still-connected joiner needs to approve.
    const res = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: true });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('approved');
  });

  it('the requester cannot approve their own request', async () => {
    const { code, host } = await setupTable('games_resp_self_h', ['games_resp_self_j']);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;
    const res = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', host)
      .send({ approve: true });
    expect(res.status).toBe(403);
  });

  it('a seat cannot respond on another seat’s behalf — the acting seat is always the caller’s own', async () => {
    const { code, host, joiners } = await setupTable('games_resp_spoof_h', [
      'games_resp_spoof_j1',
      'games_resp_spoof_j2',
    ]);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;

    // joiners[0] is seat 1; there is no seat field in the body to spoof
    // seat 2 with — the route has none, so this can only ever record as
    // seat 1's own response, and unanimity still needs seat 2's approval.
    await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: true, seat: 2 });

    const still = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    expect(still.status).toBe(200);
    const finalRespond = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[1])
      .send({ approve: true });
    expect(finalRespond.status).toBe(200);
    expect(finalRespond.body.request.status).toBe('approved');
  });

  it('a non-participant gets the same 404 an unknown code gives', async () => {
    const { code, host } = await setupTable('games_resp_np_h', ['games_resp_np_j']);
    const stranger = await registerAndGetCookie('games_resp_np_s');
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;

    const real = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', stranger)
      .send({ approve: true });
    const unknown = await request(app)
      .post(`/api/games/ZZZZ/request/${id}/respond`)
      .set('Cookie', stranger)
      .send({ approve: true });
    expect(real.status).toBe(404);
    expect(real.body).toEqual(unknown.body);
  });

  it('rejects a non-boolean approve field', async () => {
    const { code, host, joiners } = await setupTable('games_resp_badbody_h', [
      'games_resp_badbody_j',
    ]);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;
    const res = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: 'yes' });
    expect(res.status).toBe(400);
  });

  it('a response after the request has already expired is a plain not-found, not a self-approve or a stale write', async () => {
    const { code, host, joiners } = await setupTable('games_resp_expire_h', [
      'games_resp_expire_j',
    ]);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(created.body.request.status).toBe('pending');
    const id = created.body.request.id as string;

    // REQUEST_TTL_MS collapses to 200ms under test (see the route file) — the
    // expiry timer has already resolved and removed this request by now.
    await new Promise((r) => setTimeout(r, 400));

    const res = await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: true });
    expect(res.status).toBe(404);
  });

  it('expires after its TTL and broadcasts the resolution as not-approved (not a wedged table)', async () => {
    const { code, host } = await setupTable('games_expire_sse_h', ['games_expire_sse_j']);
    // Connect first so the expiry broadcast has a subscriber to land on.
    // Initial `state` frame + the create's own `request` (pending) frame +
    // the expiry's `request` (expired) frame.
    const streamPromise = openGameEventsAnyFrame(host, code, 3);
    await new Promise((r) => setTimeout(r, 50));
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(created.body.request.status).toBe('pending');

    const { frames } = await streamPromise;
    const requestFrames = frames.filter((f) => f.type === 'request');
    expect(requestFrames.some((f) => (f.data as { status: string }).status === 'expired')).toBe(
      true
    );
  }, 10000);
});

/**
 * F3 regression: `requiredApprovers` used to key entirely off `p.connected`,
 * which only flips on an explicit leave/join — a locked phone or a dropped
 * network never clears it, so a genuinely-gone seat still blocked every
 * request for its full TTL and it always resolved denied. Presence is now
 * derived from the transports the server actually sees (a live subscriber,
 * or `lastSeen` within `PRESENCE_TTL_MS`), and a `userId: null` guest seat
 * (which has no device to ever respond) is never a required approver at all,
 * even though `makePlayer` defaults it to `connected: true`.
 */
describe('required-approver presence (F3)', () => {
  it('resolves approved immediately when the only other seat has never shown presence', async () => {
    // presence: false — the joiner joins but never issues the follow-up GET
    // (or any SSE/poll) setupTable normally simulates, so it has no
    // lastSeen entry and no live subscriber.
    const { code, host } = await setupTable(
      'games_presence_absent_h',
      ['games_presence_absent_j'],
      { presence: false }
    );
    const res = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('approved');
  });

  it('still requires (and accepts) approval from a seat with recent presence', async () => {
    // setupTable's default `presence: true` already issued a GET for this
    // joiner right after it joined (a plain GET is the client's 2.5s
    // poll-loop fallback, and is on its own enough to count as presence).
    const { code, host, joiners } = await setupTable('games_presence_present_h', [
      'games_presence_present_j',
    ]);

    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(created.status).toBe(201);
    expect(created.body.request.status).toBe('pending');

    const approved = await request(app)
      .post(`/api/games/${code}/request/${created.body.request.id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: true });
    expect(approved.status).toBe(200);
    expect(approved.body.request.status).toBe('approved');
  });

  it('a guest seat (userId: null) is never a required approver, even though it defaults connected:true', async () => {
    const { code, host } = await setupTable('games_presence_guest_h', []);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    const added = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: current.body.game.version,
        actions: [
          {
            type: 'add-player',
            player: {
              id: 'guest_local',
              userId: null,
              seat: 1,
              name: 'Guest',
              deckId: null,
              deckName: null,
              commander: null,
              partner: null,
              colorIdentity: [],
              panelColorKey: null,
              life: 40,
              poison: 0,
              commanderDamage: {},
              eliminated: false,
              isHost: false,
              connected: true,
            },
          },
        ],
      });
    expect(added.status).toBe(200);
    const guest = added.body.game.players.find((p: { seat: number }) => p.seat === 1);
    expect(guest.connected).toBe(true);
    expect(guest.userId).toBeNull();

    const res = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('approved');
  });
});

describe('POST /api/games/:code/request/:id/cancel', () => {
  it('lets the requester withdraw their own pending request', async () => {
    const { code, host } = await setupTable('games_cancel_h', ['games_cancel_j']);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;
    const res = await request(app)
      .post(`/api/games/${code}/request/${id}/cancel`)
      .set('Cookie', host)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('cancelled');
  });

  it('rejects a non-requester trying to cancel', async () => {
    const { code, host, joiners } = await setupTable('games_cancel_np_h', ['games_cancel_np_j']);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;
    const res = await request(app)
      .post(`/api/games/${code}/request/${id}/cancel`)
      .set('Cookie', joiners[0])
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('cross-seat requests fan out over SSE (catch-up + live)', () => {
  it('a late subscriber catches up on a pending request', async () => {
    const { code, host } = await setupTable('games_req_sse_late_h', ['games_req_sse_late_j']);
    await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);

    const { frames } = await openGameEventsAnyFrame(host, code, 2);
    const requestFrame = frames.find((f) => f.type === 'request');
    expect(requestFrame).toBeTruthy();
    expect((requestFrame!.data as { status: string }).status).toBe('pending');
  });

  it('a connected subscriber sees the resolve frame when the request is approved', async () => {
    const { code, host, joiners } = await setupTable('games_req_sse_live_h', [
      'games_req_sse_live_j',
    ]);
    const created = await request(app)
      .post(`/api/games/${code}/request`)
      .set('Cookie', host)
      .send(rewindRequestBody);
    const id = created.body.request.id as string;

    // Initial state frame + the pending request's own create broadcast +
    // the resolve broadcast the respond below triggers.
    const streamPromise = openGameEventsAnyFrame(host, code, 3);
    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .post(`/api/games/${code}/request/${id}/respond`)
      .set('Cookie', joiners[0])
      .send({ approve: true });

    const { frames } = await streamPromise;
    const resolved = frames.filter((f) => f.type === 'request');
    expect(resolved.some((f) => (f.data as { status: string }).status === 'approved')).toBe(true);
  });
});

describe('sweepStale broadcasts deletion (E-gap: an orphaned stream must not stay "healthy" forever)', () => {
  it('ends an open SSE stream for a session swept as 24h+ stale, and keeps serving', async () => {
    const host = await registerAndGetCookie('games_sweep_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;

    // Backdate the session so the next sweep (triggered inline by ANY
    // POST /api/games — see the route) treats it as stale.
    await pool.query('UPDATE game_sessions SET updated_at = $1 WHERE code = $2', [
      Date.now() - 25 * 60 * 60 * 1000,
      code,
    ]);

    const addr = app.address();
    if (!addr || typeof addr === 'string') throw new Error('test server has no address');

    const trace: string[] = [];
    const streamEnded = new Promise<void>((resolve, reject) => {
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
          res.on('data', () => {});
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

    // Give the stream a beat to register as a subscriber before the sweep —
    // otherwise the sweep could win the race and broadcast to no one yet.
    await new Promise((r) => setTimeout(r, 50));
    // Any create triggers sweepStale() inline (see the route).
    await request(app)
      .post('/api/games')
      .set('Cookie', await registerAndGetCookie('games_sweep_trigger'))
      .send({});

    await streamEnded;

    // Still up and serving, and the swept code is genuinely gone.
    const after = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    expect(after.status).toBe(404);
  }, 20000);
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

    // Non-host participant can adjust their own seat's life.
    const lifed = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joinerCookie)
      .send({
        baseVersion: started.body.game.version,
        actions: [{ type: 'life', seat: 1, delta: -5, actorSeat: 1 }],
      });
    expect(lifed.status).toBe(200);
    expect(lifed.body.game.players[1].life).toBe(35);
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

/**
 * T99: per-device online surface — each player adjusts only their own seat's
 * life/poison/commander-damage, including the host (who otherwise keeps an
 * admin monopoly on start/reset/settings/add-player/remove-player). One
 * carve-out: a host-added guest seat (`userId: null`) has no device of its
 * own, so anyone seated may adjust it.
 */
describe('actionIsAllowed: own-seat-only life/poison/cmd-dmg (T99)', () => {
  it('own-seat life, set-life, poison, and cmd-dmg all succeed for a non-host participant', async () => {
    const { code, joiners } = await setupTable('games_ownseat_ok', ['games_ownseat_ok_j']);
    const joiner = joiners[0]; // seat 1
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', joiner);
    let baseVersion = current.body.game.version as number;
    for (const action of [
      { type: 'life', seat: 1, delta: -1, actorSeat: 1 },
      { type: 'set-life', seat: 1, value: 30, actorSeat: 1 },
      { type: 'poison', seat: 1, delta: 1, actorSeat: 1 },
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 1, actorSeat: 1 },
    ]) {
      const res = await request(app)
        .patch(`/api/games/${code}`)
        .set('Cookie', joiner)
        .send({ baseVersion, actions: [action] });
      expect(res.status).toBe(200);
      baseVersion = res.body.game.version;
    }
  });

  it('a non-host is blocked (403) from adjusting another participant’s seat', async () => {
    const { code, joiners } = await setupTable('games_ownseat_nh403', ['games_ownseat_nh403_j']);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', joiners[0]);
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiners[0])
      .send({
        baseVersion: current.body.game.version,
        actions: [{ type: 'life', seat: 0, delta: -1, actorSeat: 1 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Can only adjust your own seat.');
  });

  it('the host is also blocked (403) from adjusting another participant’s seat', async () => {
    const { code, host } = await setupTable('games_ownseat_host403', ['games_ownseat_host403_j']);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: current.body.game.version,
        actions: [{ type: 'life', seat: 1, delta: -1, actorSeat: 0 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Can only adjust your own seat.');
  });

  it('a guest seat (userId: null) can have its life adjusted by any seated participant, host or not', async () => {
    const { code, host, joiners } = await setupTable('games_ownseat_guest', [
      'games_ownseat_guest_j',
    ]);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    const added = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: current.body.game.version,
        actions: [
          {
            type: 'add-player',
            player: {
              id: 'guest_local',
              userId: null,
              seat: 2,
              name: 'Guest',
              deckId: null,
              deckName: null,
              commander: null,
              partner: null,
              colorIdentity: [],
              panelColorKey: null,
              life: 40,
              poison: 0,
              commanderDamage: {},
              eliminated: false,
              isHost: false,
              connected: true,
            },
          },
        ],
      });
    expect(added.status).toBe(200);

    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiners[0])
      .send({
        baseVersion: added.body.game.version,
        actions: [{ type: 'life', seat: 2, delta: -3, actorSeat: 1 }],
      });
    expect(res.status).toBe(200);
    const guest = res.body.game.players.find((p: { seat: number }) => p.seat === 2);
    expect(guest.life).toBe(37);
  });

  it('cmd-dmg: naming another attacker via fromSeat is fine as long as seat (the receiver) is the caller’s own', async () => {
    const { code, joiners } = await setupTable('games_ownseat_cmddmg', ['games_ownseat_cmddmg_j']);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', joiners[0]);
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', joiners[0])
      .send({
        baseVersion: current.body.game.version,
        actions: [{ type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 2, actorSeat: 1 }],
      });
    expect(res.status).toBe(200);
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

/**
 * F2 regression: `note` (open to any participant) carried an unbounded
 * `message`, and `add-player` (host-only) stored its `player` object
 * verbatim — no name cap, no color-identity scrub, no protection against a
 * forged `isHost`/`connected`/`commanderDamage` — unlike the create/join
 * paths, which normalize all of that. Both land in `game_sessions.state` and
 * get re-broadcast on every subsequent push.
 */
describe('PATCH validates note / add-player payloads and bounds batch size (F2)', () => {
  it('rejects a note whose message is not a string', async () => {
    const cookie = await registerAndGetCookie('games_note_bad');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version,
        actions: [{ type: 'note', actorSeat: null, message: 12345 }],
      });
    expect(res.status).toBe(400);
  });

  it('caps an oversized note message rather than storing it verbatim', async () => {
    const cookie = await registerAndGetCookie('games_note_cap');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version,
        actions: [{ type: 'note', actorSeat: null, message: 'x'.repeat(10_000) }],
      });
    expect(res.status).toBe(200);
    const noteEvent = res.body.game.events.at(-1);
    expect(noteEvent.kind).toBe('note');
    expect(noteEvent.message).toHaveLength(500);
  });

  it('passes a legitimate short note through unchanged', async () => {
    const cookie = await registerAndGetCookie('games_note_ok');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version,
        actions: [{ type: 'note', actorSeat: null, message: '🪙 Coin flip → Heads' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.game.events.at(-1).message).toBe('🪙 Coin flip → Heads');
  });

  it('caps an add-player name and strips forged isHost/panelColorKey/colorIdentity', async () => {
    const host = await registerAndGetCookie('games_addp_h');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: created.body.game.version,
        actions: [
          {
            type: 'add-player',
            player: {
              id: 'guest_1',
              userId: null,
              seat: 1,
              name: 'x'.repeat(80),
              deckId: null,
              deckName: null,
              commander: null,
              partner: null,
              colorIdentity: ['w', 'X'],
              panelColorKey: 'z',
              life: 40,
              poison: 0,
              commanderDamage: { '0': 21 },
              eliminated: false,
              isHost: true,
              connected: false,
            },
          },
        ],
      });
    expect(res.status).toBe(200);
    const added = res.body.game.players.find((p: { seat: number }) => p.seat === 1);
    expect(added.name).toHaveLength(40);
    expect(added.isHost).toBe(false);
    expect(added.connected).toBe(true);
    expect(added.commanderDamage).toEqual({});
    expect(added.userId).toBeNull();
    expect(added.colorIdentity).toEqual(['W']);
    expect(added.panelColorKey).toBeNull();
  });

  it('rejects add-player with a non-numeric seat or life', async () => {
    const host = await registerAndGetCookie('games_addp_bad');
    const created = await request(app).post('/api/games').set('Cookie', host).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', host)
      .send({
        baseVersion: created.body.game.version,
        actions: [
          {
            type: 'add-player',
            player: { id: 'g', userId: null, seat: 'one', life: 40, name: 'x' },
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('rejects a PATCH action batch over 32KB with 413', async () => {
    const cookie = await registerAndGetCookie('games_patch_big');
    const created = await request(app).post('/api/games').set('Cookie', cookie).send({});
    const code = created.body.game.code as string;
    const res = await request(app)
      .patch(`/api/games/${code}`)
      .set('Cookie', cookie)
      .send({
        baseVersion: created.body.game.version,
        actions: [{ type: 'note', actorSeat: null, message: 'x'.repeat(40_000) }],
      });
    expect(res.status).toBe(413);
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

describe('POST /api/games/:code/signal (ephemeral table signals)', () => {
  it('rejects unauthenticated requests', async () => {
    const { code } = await setupTable('games_sig_auth', []);
    const res = await request(app)
      .post(`/api/games/${code}/signal`)
      .send({ kind: 'reaction', emote: SIGNAL_EMOTES[0] });
    expect(res.status).toBe(401);
  });

  it('404s for an unknown code', async () => {
    const cookie = await registerAndGetCookie('games_sig_unknown');
    const res = await request(app)
      .post('/api/games/ZZZZ/signal')
      .set('Cookie', cookie)
      .send({ kind: 'reaction', emote: SIGNAL_EMOTES[0] });
    expect(res.status).toBe(404);
  });

  // Stealth 404, byte-identical to an unknown code — same reason every other
  // route in this file closes the join-code enumeration hole.
  it('gives a non-participant the same 404 an unknown code gives', async () => {
    const { code } = await setupTable('games_sig_np_h', []);
    const stranger = await registerAndGetCookie('games_sig_np_s');
    const real = await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', stranger)
      .send({ kind: 'reaction', emote: SIGNAL_EMOTES[0] });
    const unknown = await request(app)
      .post('/api/games/ZZZZ/signal')
      .set('Cookie', stranger)
      .send({ kind: 'reaction', emote: SIGNAL_EMOTES[0] });
    expect(real.status).toBe(404);
    expect(real.body).toEqual(unknown.body);
  });

  it('rejects an unsupported kind', async () => {
    const { code, host } = await setupTable('games_sig_kind', []);
    const res = await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', host)
      .send({ kind: 'taunt' });
    expect(res.status).toBe(400);
  });

  it('rejects a reaction with an emote outside the fixed set', async () => {
    const { code, host } = await setupTable('games_sig_emote', []);
    const res = await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', host)
      .send({ kind: 'reaction', emote: '💀' });
    expect(res.status).toBe(400);
  });

  it('rejects a roll with a die outside the fixed set', async () => {
    const { code, host } = await setupTable('games_sig_die', []);
    const res = await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', host)
      .send({ kind: 'roll', die: 'd100' });
    expect(res.status).toBe(400);
  });

  it('echoes a reaction signal with the server-stamped seat, ignoring a spoofed seat in the body', async () => {
    const { code, joiners } = await setupTable('games_sig_echo_h', ['games_sig_echo_j']);
    const res = await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', joiners[0])
      .send({ kind: 'reaction', emote: SIGNAL_EMOTES[2], seat: 0 });
    expect(res.status).toBe(200);
    expect(res.body.signal.kind).toBe('reaction');
    expect(res.body.signal.emote).toBe(SIGNAL_EMOTES[2]);
    // Joiner is seat 1; the body's claimed seat 0 (the host's) is ignored —
    // there is no seat field this route reads from the body at all.
    expect(res.body.signal.seat).toBe(1);
    expect(typeof res.body.signal.ts).toBe('number');
  });

  it('a d6 roll is always 1-6, a d20 roll is always 1-20, a coin is always 0 or 1', async () => {
    const { code, host } = await setupTable('games_sig_roll_range', []);
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post(`/api/games/${code}/signal`)
        .set('Cookie', host)
        .send({ kind: 'roll', die: 'd6' });
      expect(res.body.signal.value).toBeGreaterThanOrEqual(1);
      expect(res.body.signal.value).toBeLessThanOrEqual(6);
    }
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post(`/api/games/${code}/signal`)
        .set('Cookie', host)
        .send({ kind: 'roll', die: 'd20' });
      expect(res.body.signal.value).toBeGreaterThanOrEqual(1);
      expect(res.body.signal.value).toBeLessThanOrEqual(20);
    }
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post(`/api/games/${code}/signal`)
        .set('Cookie', host)
        .send({ kind: 'roll', die: 'coin' });
      expect([0, 1]).toContain(res.body.signal.value);
    }
  });

  it("a 'first' roll returns a seat that actually exists in the game", async () => {
    const { code, host } = await setupTable('games_sig_first_h', [
      'games_sig_first_j1',
      'games_sig_first_j2',
    ]);
    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .post(`/api/games/${code}/signal`)
        .set('Cookie', host)
        .send({ kind: 'roll', die: 'first' });
      expect(res.status).toBe(200);
      expect([0, 1, 2]).toContain(res.body.signal.value);
    }
  });

  it('a connected SSE subscriber receives a broadcast signal frame', async () => {
    const { code, host, joiners } = await setupTable('games_sig_sse_h', ['games_sig_sse_j']);
    // Host's own stream: initial `state` frame + the `signal` frame the
    // joiner's send below triggers.
    const streamPromise = openGameEventsAnyFrame(host, code, 2);
    await new Promise((r) => setTimeout(r, 50));
    const posted = await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', joiners[0])
      .send({ kind: 'reaction', emote: SIGNAL_EMOTES[4] });
    expect(posted.status).toBe(200);

    const { frames } = await streamPromise;
    const signalFrame = frames.find((f) => f.type === 'signal');
    expect(signalFrame).toBeTruthy();
    expect((signalFrame!.data as { seat: number; emote: string }).seat).toBe(1);
    expect((signalFrame!.data as { seat: number; emote: string }).emote).toBe(SIGNAL_EMOTES[4]);
  });

  it('a held long-poll resolves early on a signal, carrying the boards/requests snapshots', async () => {
    const { code, host, joiners } = await setupTable('games_sig_poll_h', ['games_sig_poll_j']);
    const current = await request(app).get(`/api/games/${code}`).set('Cookie', host);
    const version = current.body.game.version as number;

    const pollPromise = new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve, reject) => {
        request(app)
          .get(`/api/games/${code}/poll?since=${version}`)
          .set('Cookie', host)
          .end((err, res) => (err ? reject(err) : resolve(res)));
      }
    );
    // Give the poll a beat to register as a subscriber before sending —
    // otherwise the signal could win the race and resolve nobody.
    await new Promise((r) => setTimeout(r, 50));
    await request(app)
      .post(`/api/games/${code}/signal`)
      .set('Cookie', joiners[0])
      .send({ kind: 'roll', die: 'd6' });

    const res = await pollPromise;
    expect(res.status).toBe(200);
    const signal = res.body.signal as { kind: string; seat: number; die: string };
    expect(signal.kind).toBe('roll');
    expect(signal.seat).toBe(1);
    expect(signal.die).toBe('d6');
    // Every branch of /poll carries the full snapshots, not just the item
    // that resolved it (F4 convention) — empty here since nothing else was
    // published, but the keys must be present.
    expect(res.body.boards).toEqual([]);
    expect(res.body.requests).toEqual([]);
  });
});
