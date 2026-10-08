import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import { eventsRouter } from './events';
import { isRateLimiter } from '../route-utils';
import { parseSuggestion } from './suggestion-labels';

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

const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';
const SORIN = '5c0d3a7e-2b1c-4f6d-8e4b-9a7c6d5e4f30';

const label = (over: Record<string, unknown> = {}) => ({
  name: 'suggestion',
  path: '/decks/:id',
  surface: 'generation',
  action: 'dismiss',
  rank: 0,
  reason: 'generation',
  cmdr: ATRAXA,
  cmdrName: "Atraxa, Praetors' Voice",
  cardOut: 'Early Winter',
  ...over,
});

async function rows() {
  const { rows } = await pool.query(
    `SELECT * FROM suggestion_counts WHERE day = CURRENT_DATE ORDER BY card_out, card_in`
  );
  return rows;
}

describe('POST /api/events {name:"suggestion"}', () => {
  it('counts a label as one aggregate row and always answers 204', async () => {
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/api/events').send(label())).status).toBe(204);
    }
    const found = (await rows()).filter((r) => r.card_out === 'Early Winter');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      surface: 'generation',
      action: 'dismiss',
      commander: ATRAXA,
      count: 2,
    });
  });

  it('keeps no column that could name a person, a deck or a session', async () => {
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'suggestion_counts' AND table_schema = current_schema()`
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'action',
      'card_in',
      'card_out',
      'commander',
      'commander_name',
      'count',
      'day',
      'partner',
      'rank',
      'reason',
      'surface',
    ]);
  });

  it('drops an event that carries a field it does not know, such as a deck or user id', async () => {
    const before = (await rows()).length;
    for (const extra of [
      { deckId: 'd1' },
      { userId: 'u1' },
      { deck: ['Sol Ring'] },
      { session: 'abc' },
    ]) {
      expect(
        (
          await request(app)
            .post('/api/events')
            .send(label({ cardOut: 'Extra', ...extra }))
        ).status
      ).toBe(204);
    }
    expect(await rows()).toHaveLength(before);
  });

  it('drops malformed labels', async () => {
    const before = (await rows()).length;
    const bad = [
      label({ surface: 'nowhere' }),
      label({ action: 'like' }),
      label({ cmdr: 'not-an-oracle-id' }),
      label({ partner: 'nope' }),
      label({ rank: -1 }),
      label({ rank: 1.5 }),
      label({ rank: 100 }),
      label({ reason: 'Not A Kind' }),
      label({ cardOut: undefined, cardIn: undefined }),
      label({ action: 'shown', n: 3 }),
      label({ action: 'shown', cardOut: undefined, n: 0 }),
      label({ action: 'shown', cardOut: undefined, n: 201 }),
    ];
    for (const body of bad) {
      expect((await request(app).post('/api/events').send(body)).status).toBe(204);
    }
    expect(await rows()).toHaveLength(before);
  });

  it('scrubs card text and sums an impression count', async () => {
    await request(app)
      .post('/api/events')
      .send(
        label({
          surface: 'coach:all',
          action: 'accept',
          rank: 2,
          reason: 'fill-gaps',
          partner: SORIN,
          cardIn: 'Grave Pact',
          cardOut: 'mail me at a@b.co',
        })
      );
    await request(app)
      .post('/api/events')
      .send(
        label({ surface: 'coach:all', action: 'shown', cardOut: undefined, rank: undefined, n: 7 })
      );
    const all = await rows();
    const accept = all.find((r) => r.card_in === 'Grave Pact');
    expect(accept).toMatchObject({ partner: SORIN, rank: 2, card_out: 'mail me at [email]' });
    expect(all.find((r) => r.action === 'shown')).toMatchObject({ count: 7, card_in: '' });
  });

  it('counts a cube swap label without a commander, and refuses one that carries one', async () => {
    const cube = (over: Record<string, unknown> = {}) => ({
      name: 'suggestion',
      path: '/decks/cube/:id',
      surface: 'cube-swap',
      action: 'dismiss',
      reason: 'removal',
      cardOut: 'Terminate',
      ...over,
    });
    expect((await request(app).post('/api/events').send(cube())).status).toBe(204);
    const found = (await rows()).filter((r) => r.surface === 'cube-swap');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      action: 'dismiss',
      reason: 'removal',
      commander: '',
      partner: '',
      card_out: 'Terminate',
    });
    // Every other surface still needs its commander; a cube label may not carry one.
    const before = (await rows()).length;
    for (const body of [
      cube({ cmdr: ATRAXA }),
      cube({ partner: SORIN }),
      label({ cmdr: undefined }),
    ]) {
      expect((await request(app).post('/api/events').send(body)).status).toBe(204);
    }
    expect(await rows()).toHaveLength(before);
  });

  it('shares the beacon rate limiter', () => {
    const layer = eventsRouter.stack.find(
      (l) =>
        l.route?.path === '/' &&
        (l.route as unknown as { methods: { post?: boolean } }).methods.post
    );
    const handlers = layer?.route?.stack.map((s) => s.handle) ?? [];
    expect(handlers.some((h) => isRateLimiter(h))).toBe(true);
  });
});

describe('parseSuggestion', () => {
  it('lower-cases oracle ids and defaults rank and reason', () => {
    expect(
      parseSuggestion({
        surface: 'hidden-gems',
        action: 'accept',
        cmdr: ATRAXA.toUpperCase(),
        cardIn: 'Grave Pact',
      })
    ).toMatchObject({ commander: ATRAXA, rank: 0, reason: '', count: 1 });
  });
});

describe('GET /api/admin/suggestions', () => {
  it('is admin-only and aggregates per surface and top dismissed cards per commander', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      username: 'sugadmin',
      password: 'correct horse battery',
      email: 'sugadmin@example.test',
    });
    const userCookie = extractSessionCookie(reg.headers['set-cookie'])!;
    expect(
      (await request(app).get('/api/admin/suggestions').set('Cookie', userCookie)).status
    ).toBe(403);
    await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = 'sugadmin'`);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sugadmin', password: 'correct horse battery' });
    const admin = extractSessionCookie(login.headers['set-cookie'])!;

    // A suggestion dismissed from Swap this card credits the card it offered, not the deck's own.
    await request(app)
      .post('/api/events')
      .send(
        label({
          surface: 'swap',
          cmdr: SORIN,
          cmdrName: 'Sorin',
          cardIn: 'Cultivate',
          cardOut: 'Rampant Growth',
        })
      );
    const res = await request(app).get('/api/admin/suggestions?days=7').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.surfaces).toEqual(
      expect.arrayContaining([
        { surface: 'generation', shown: 0, accept: 0, dismiss: 2, undo: 0 },
        { surface: 'coach:all', shown: 7, accept: 1, dismiss: 0, undo: 0 },
      ])
    );
    expect(res.body.surfaces).toEqual(
      expect.arrayContaining([{ surface: 'cube-swap', shown: 0, accept: 0, dismiss: 1, undo: 0 }])
    );
    // A cube has no commander: its dismissals count per surface, never as a blank commander.
    expect(res.body.topDismissed.every((g: { commander: string }) => g.commander !== '')).toBe(
      true
    );
    expect(res.body.topDismissed[0]).toMatchObject({
      commander: ATRAXA,
      name: "Atraxa, Praetors' Voice",
      cards: [{ card: 'Early Winter', count: 2 }],
    });
    expect(
      res.body.topDismissed.find((c: { commander: string }) => c.commander === SORIN)
    ).toMatchObject({
      cards: [{ card: 'Cultivate', count: 1 }],
    });
  });
});
