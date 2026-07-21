import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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

async function makeUser(username: string): Promise<{ cookie: string; userId: string }> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return {
    cookie: extractSessionCookie(reg.headers['set-cookie'])!,
    userId: reg.body.user.id as string,
  };
}

async function createNight(cookie: string): Promise<{ id: string; token: string }> {
  const res = await request(app)
    .post('/api/game-nights')
    .set('Cookie', cookie)
    .send({ title: 'Trade night', startsAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  expect(res.status).toBe(201);
  return { id: res.body.night.id, token: res.body.night.token };
}

/** RSVP + set trade opt-in via the real authed write path. */
async function joinTrades(token: string, cookie: string, tradeOptIn = true): Promise<void> {
  const res = await request(app)
    .post(`/api/game-nights/public/${token}/rsvp`)
    .set('Cookie', cookie)
    .send({ status: 'going', tradeOptIn });
  expect(res.status).toBe(200);
}

let seedCounter = 0;
async function seedRow(
  table: 'user_cards' | 'user_binders' | 'user_lists',
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  const id = `${table}-${userId}-${seedCounter++}`;
  const now = Date.now();
  if (table === 'user_cards') {
    await pool.query(
      `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at)
       VALUES ($1, $2, 'import-1', $3, nextval('user_data_rev_seq'), $4)`,
      [userId, id, JSON.stringify(data), now]
    );
  } else {
    await pool.query(
      `INSERT INTO ${table} (user_id, id, data, rev, updated_at)
       VALUES ($1, $2, $3, nextval('user_data_rev_seq'), $4)`,
      [userId, id, JSON.stringify(data), now]
    );
  }
}

function card(
  overrides: Record<string, unknown> & { name: string; oracleId: string }
): Record<string, unknown> {
  return {
    copyId: `copy-${overrides.oracleId}-${Math.random().toString(36).slice(2)}`,
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `sf-${overrides.oracleId}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    colors: [],
    cmc: 0,
    typeLine: 'Artifact',
    ...overrides,
  };
}

/** A BinderDef-shaped fixture — defaults to a catch-all (empty filter) rule. */
function binder(
  overrides: Record<string, unknown> & { id: string; position: number }
): Record<string, unknown> {
  const now = Date.now();
  return {
    name: 'Binder',
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#888',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function list(
  overrides: Record<string, unknown> & { id: string; name: string }
): Record<string, unknown> {
  const now = Date.now();
  return {
    entries: [],
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('GET /api/tonight-trades/:nightId', () => {
  it('404s for an unknown night id', async () => {
    const { cookie } = await makeUser('tt-unknown');
    const res = await request(app).get('/api/tonight-trades/does-not-exist').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Game night not found.' });
  });

  it('404s (same shape) for a caller with no RSVP at all on a real night', async () => {
    const host = await makeUser('tt-norsvp-host');
    const stranger = await makeUser('tt-norsvp-stranger');
    const { id } = await createNight(host.cookie);
    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Game night not found.' });
  });

  it('404s (same shape) for a caller who has an RSVP but has not opted in', async () => {
    const host = await makeUser('tt-noopt-host');
    const { id, token } = await createNight(host.cookie);
    await joinTrades(token, host.cookie, false);
    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', host.cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Game night not found.' });
  });

  it('returns exactly the opted-in attendees — a 4th who RSVPd but did not opt in is excluded', async () => {
    const host = await makeUser('tt-roster-host');
    const a = await makeUser('tt-roster-a');
    const b = await makeUser('tt-roster-b');
    const c = await makeUser('tt-roster-c'); // RSVPs but does NOT opt in
    const { id, token } = await createNight(host.cookie);
    await joinTrades(token, host.cookie, true);
    await joinTrades(token, a.cookie, true);
    await joinTrades(token, b.cookie, true);
    await joinTrades(token, c.cookie, false);

    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', host.cookie);
    expect(res.status).toBe(200);
    const userIds = (res.body.attendees as Array<{ userId: string }>)
      .map((att) => att.userId)
      .sort();
    expect(userIds).toEqual([host.userId, a.userId, b.userId].sort());
  });

  it('a binder not flagged tradeable contributes zero cards even though its owner is opted in', async () => {
    const host = await makeUser('tt-notradeable-host');
    const owner = await makeUser('tt-notradeable-owner');
    const { id, token } = await createNight(host.cookie);
    await joinTrades(token, host.cookie, true);
    await joinTrades(token, owner.cookie, true);

    await seedRow(
      'user_cards',
      owner.userId,
      card({ name: 'Sol Ring', oracleId: 'o-sol-nt', colors: [] })
    );
    await seedRow(
      'user_binders',
      owner.userId,
      binder({ id: 'b-plain', position: 0, name: 'Keepers' })
    );

    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', host.cookie);
    const ownerAttendee = (
      res.body.attendees as Array<{ userId: string; tradeableCards: unknown[] }>
    ).find((att) => att.userId === owner.userId);
    expect(ownerAttendee?.tradeableCards).toEqual([]);
  });

  it('routes the FULL binder set before filtering to tradeable — a card claimed by a higher-priority non-tradeable binder is excluded even though a lower-priority tradeable binder would also match it', async () => {
    const host = await makeUser('tt-routing-host');
    const owner = await makeUser('tt-routing-owner');
    const { id, token } = await createNight(host.cookie);
    await joinTrades(token, host.cookie, true);
    await joinTrades(token, owner.cookie, true);

    // Lightning Bolt (red) matches Binder A (position 0, non-tradeable,
    // colors=R) so it lands there — NOT the trade board — even though
    // Binder B's catch-all rule would also match it if routing ever reached it.
    await seedRow(
      'user_cards',
      owner.userId,
      card({ name: 'Lightning Bolt', oracleId: 'o-bolt', colors: ['R'] })
    );
    // Sol Ring (colorless) doesn't match Binder A's red-only rule, falls
    // through to Binder B (tradeable catch-all).
    await seedRow(
      'user_cards',
      owner.userId,
      card({ name: 'Sol Ring', oracleId: 'o-sol-routing', colors: [] })
    );
    await seedRow(
      'user_binders',
      owner.userId,
      binder({
        id: 'b-keepers',
        position: 0,
        name: 'Keepers',
        filterGroups: [
          { filter: { colors: { chips: [{ value: 'R', negate: false }], joiners: [] } } },
        ],
      })
    );
    await seedRow(
      'user_binders',
      owner.userId,
      binder({ id: 'b-tradebox', position: 1, name: 'Trade box', tradeable: true })
    );

    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', host.cookie);
    const ownerAttendee = (
      res.body.attendees as Array<{ userId: string; tradeableCards: Array<{ oracleId: string }> }>
    ).find((att) => att.userId === owner.userId);
    const oracleIds = ownerAttendee?.tradeableCards.map((c) => c.oracleId).sort();
    expect(oracleIds).toEqual(['o-sol-routing']);
  });

  it("excludes a tracking list from an attendee's lists", async () => {
    const host = await makeUser('tt-lists-host');
    const owner = await makeUser('tt-lists-owner');
    const { id, token } = await createNight(host.cookie);
    await joinTrades(token, host.cookie, true);
    await joinTrades(token, owner.cookie, true);

    await seedRow('user_lists', owner.userId, list({ id: 'l-want', name: 'Commander wants' }));
    await seedRow(
      'user_lists',
      owner.userId,
      list({ id: 'l-track', name: 'Eligible commanders', kind: 'tracking' })
    );

    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', host.cookie);
    const ownerAttendee = (
      res.body.attendees as Array<{ userId: string; lists: Array<{ name: string }> }>
    ).find((att) => att.userId === owner.userId);
    expect(ownerAttendee?.lists.map((l) => l.name)).toEqual(['Commander wants']);
  });

  it('excludes a guest RSVP row even if trade_opt_in were somehow true on it (read-site guard)', async () => {
    const host = await makeUser('tt-guest-host');
    const { id, token } = await createNight(host.cookie);
    await joinTrades(token, host.cookie, true);

    // The write path can never set trade_opt_in true for a guest row — force
    // it directly to prove the READ side also guards user_id IS NOT NULL
    // independently, rather than only relying on the write-side guard.
    const guestRsvp = await request(app)
      .post(`/api/game-nights/public/${token}/rsvp`)
      .send({ status: 'going', displayName: 'Guest G' });
    expect(guestRsvp.status).toBe(201);
    await pool.query(`UPDATE game_night_rsvps SET trade_opt_in = true WHERE id = $1`, [
      guestRsvp.body.rsvp.id,
    ]);

    const res = await request(app).get(`/api/tonight-trades/${id}`).set('Cookie', host.cookie);
    const userIds = (res.body.attendees as Array<{ userId: string }>).map((att) => att.userId);
    expect(userIds).toEqual([host.userId]);
  });
});
