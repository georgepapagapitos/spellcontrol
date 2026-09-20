import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';

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

async function count(name: string, path: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    'SELECT count FROM event_counts WHERE day = CURRENT_DATE AND name = $1 AND path = $2',
    [name, path]
  );
  return rows[0]?.count ?? 0;
}

describe('POST /api/events', () => {
  it('increments one aggregate counter per (day, name, path) and stores nothing else', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/api/events').send({ name: 'pageview', path: '/' });
      expect(res.status).toBe(204);
    }
    expect(await count('pageview', '/')).toBe(2);
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'event_counts' AND table_schema = current_schema()`
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(['count', 'day', 'name', 'path']);
  });

  it('records the past-the-landing funnel events, which it used to drop', async () => {
    // #1911 added these four to the client and to no server list, so each one
    // beaconed into a 204 and wrote no row for as long as it shipped. An
    // unrecorded door and an unused door look identical in Admin → Analytics,
    // so the regression is only ever found by someone acting on the numbers.
    for (const name of ['play_started', 'register_completed', 'deck_created', 'binder_created']) {
      const res = await request(app).post('/api/events').send({ name, path: '/play' });
      expect(res.status).toBe(204);
      expect(await count(name, '/play'), `${name} should have been counted`).toBe(1);
    }
  });

  it('drops unknown event names and non-path paths silently', async () => {
    const bad = await request(app).post('/api/events').send({ name: 'evil', path: '/' });
    expect(bad.status).toBe(204);
    const noPath = await request(app).post('/api/events').send({ name: 'sign_in', path: 'x' });
    expect(noPath.status).toBe(204);
    expect(await count('evil', '/')).toBe(0);
    expect(await count('sign_in', 'x')).toBe(0);
  });
});

describe('POST /api/events {name:"error"}', () => {
  async function errorRows() {
    const { rows } = await pool.query<{
      path: string;
      kind: string;
      message: string;
      frame: string;
      count: number;
    }>('SELECT path, kind, message, frame, count FROM error_counts ORDER BY message');
    return rows;
  }

  it('counts one row per (path, kind, message, frame) with the text scrubbed and capped', async () => {
    const body = {
      name: 'error',
      path: '/decks/:id/*',
      kind: 'error',
      message:
        'Failed to fetch https://api.example.com/x?token=SECRET for bob@example.com id 123456789 ' +
        'y'.repeat(400),
      frame: '/assets/index-abc123.js:10:20',
    };
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/api/events').send(body)).status).toBe(204);
    }
    const rows = await errorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].message).not.toContain('SECRET');
    expect(rows[0].message).not.toContain('bob@');
    expect(rows[0].message).not.toContain('123456789');
    expect(rows[0].message).toContain('[email]');
    expect(rows[0].message.length).toBeLessThanOrEqual(200);
    expect(rows[0].frame).toBe('/assets/index-abc123.js:10:20');
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'error_counts' AND table_schema = current_schema()`
    );
    expect(cols.map((r) => r.column_name).sort()).toEqual([
      'count',
      'day',
      'frame',
      'kind',
      'last_seen',
      'message',
      'path',
    ]);
  });

  it('drops unknown kinds and stores a placeholder for an empty message', async () => {
    await pool.query('DELETE FROM error_counts');
    await request(app)
      .post('/api/events')
      .send({ name: 'error', path: '/', kind: 'weird', message: 'x' });
    await request(app).post('/api/events').send({ name: 'error', path: '/', kind: 'rejection' });
    const rows = await errorRows();
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'rejection', message: '[no message]', frame: '', count: 1 }),
    ]);
  });
});

describe('POST /api/events {name:"vital"}', () => {
  it('stores only the Core Web Vitals band, never the value', async () => {
    const send = (metric: string, value: unknown) =>
      request(app).post('/api/events').send({ name: 'vital', path: '/', metric, value });
    await send('LCP', 1200);
    await send('LCP', 3000);
    await send('LCP', 9000);
    await send('INP', 150);
    await send('CLS', 0.3);
    await send('TTFB', 100); // not a tracked metric
    await send('LCP', 'fast'); // not a number
    const { rows } = await pool.query<{ metric: string; rating: string; count: number }>(
      'SELECT metric, rating, count FROM vital_counts ORDER BY metric, rating'
    );
    expect(rows).toEqual([
      { metric: 'CLS', rating: 'poor', count: 1 },
      { metric: 'INP', rating: 'good', count: 1 },
      { metric: 'LCP', rating: 'good', count: 1 },
      { metric: 'LCP', rating: 'needs-improvement', count: 1 },
      { metric: 'LCP', rating: 'poor', count: 1 },
    ]);
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'vital_counts' AND table_schema = current_schema()`
    );
    expect(cols.map((r) => r.column_name).sort()).toEqual([
      'count',
      'day',
      'metric',
      'path',
      'rating',
    ]);
  });
});

describe('GET /api/admin/events', () => {
  it('is admin-only and returns the raw daily rows', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      username: 'evadmin',
      password: 'correct horse battery',
      email: 'evadmin@example.test',
    });
    expect(reg.status).toBe(201);
    const userCookie = extractSessionCookie(reg.headers['set-cookie'])!;
    expect((await request(app).get('/api/admin/events').set('Cookie', userCookie)).status).toBe(
      403
    );

    await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = 'evadmin'`);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'evadmin', password: 'correct horse battery' });
    const admin = extractSessionCookie(login.headers['set-cookie'])!;
    await request(app).post('/api/events').send({ name: 'guide_cta', path: '/guides/' });
    await request(app)
      .post('/api/events')
      .send({ name: 'error', path: '/play', kind: 'render', message: 'boom', frame: 'f.js:1:1' });
    await request(app)
      .post('/api/events')
      .send({ name: 'vital', path: '/play', metric: 'CLS', value: 0.02 });
    const res = await request(app).get('/api/admin/events?days=7').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'guide_cta', path: '/guides/', count: 1 }),
      ])
    );
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/play', kind: 'render', message: 'boom', count: 1 }),
      ])
    );
    expect(res.body.vitals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/play', metric: 'CLS', rating: 'good', count: 1 }),
      ])
    );
  });
});
