import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie } from '../test-helpers';
import { getDb } from '../db';
import {
  COUNT_ROWS_PER_DAY,
  ERROR_HITS_PER_IP_CAP,
  recentErrorCount,
  resetErrorHits,
  scrubText,
} from './events';

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

  it('stores a tab that reloaded onto a new build, but keeps it out of the burst alert', async () => {
    await pool.query('DELETE FROM error_counts');
    resetErrorHits();
    const reload = {
      name: 'error',
      path: '/decks/:id',
      kind: 'reload',
      message: 'Unable to preload CSS for /assets/DeckEditorPage-Cq1x2a.css',
    };
    for (let i = 0; i < 3; i++) await request(app).post('/api/events').send(reload);
    await request(app)
      .post('/api/events')
      .send({ name: 'error', path: '/', kind: 'render', message: 'boom' });
    const rows = await errorRows();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'render', count: 1 }),
        expect.objectContaining({ kind: 'reload', count: 3 }),
      ])
    );
    expect(await recentErrorCount(5)).toBe(1);
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

describe('scrubText', () => {
  it('masks emails', () => {
    expect(scrubText('failed for a.b+c@example.co.uk today', 200)).toBe('failed for [email] today');
  });

  it('finishes fast on a long run of email-class characters with no @', () => {
    const t0 = performance.now();
    scrubText('+'.repeat(100_000), 200);
    scrubText('a@' + 'b'.repeat(100_000), 200);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('beacon burst alert and row caps (E1070, E1071)', () => {
  const err = (message: string) =>
    request(app).post('/api/events').send({ name: 'error', path: '/', kind: 'error', message });

  it('counts a hit on a row already at 300 as one, not 300', async () => {
    await pool.query('DELETE FROM error_counts');
    resetErrorHits();
    await pool.query(
      `INSERT INTO error_counts (day, path, kind, message, frame, count, last_seen)
         VALUES (CURRENT_DATE, '/', 'error', 'old loop', '', 300, now() - interval '1 hour')`
    );
    await err('old loop');
    expect(await recentErrorCount(15)).toBe(1);
  });

  it('keeps 30 identical beacons from one caller under the default threshold of 25', async () => {
    resetErrorHits();
    for (let i = 0; i < 30; i++) await err('spam');
    expect(await recentErrorCount(15)).toBe(ERROR_HITS_PER_IP_CAP);
    expect(await recentErrorCount(15)).toBeLessThanOrEqual(25);
  });

  it('forgets hits older than the window', async () => {
    resetErrorHits();
    await err('x');
    expect(await recentErrorCount(15, Date.now() + 16 * 60_000)).toBe(0);
  });

  it('folds paths past the per-day cap into one overflow row, for events and vitals', async () => {
    await pool.query('DELETE FROM event_counts');
    await pool.query('DELETE FROM vital_counts');
    for (let i = 0; i < COUNT_ROWS_PER_DAY + 100; i += 20) {
      await Promise.all(
        Array.from({ length: 20 }, (_, j) => {
          const path = `/p${i + j}`;
          return Promise.all([
            request(app).post('/api/events').send({ name: 'pageview', path }),
            request(app).post('/api/events').send({ name: 'vital', path, metric: 'LCP', value: 1 }),
          ]);
        })
      );
    }
    for (const table of ['event_counts', 'vital_counts']) {
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
      // concurrent writers can each pass the count check once, so allow a small slack
      expect(Number(rows[0].n), table).toBeLessThanOrEqual(COUNT_ROWS_PER_DAY + 25);
      const over = await pool.query(`SELECT 1 FROM ${table} WHERE path = '[overflow]'`);
      expect(over.rowCount, table).toBe(1);
    }
  });

  it('drops a path that is not route-shaped', async () => {
    await pool.query('DELETE FROM event_counts');
    await request(app).post('/api/events').send({ name: 'pageview', path: '/a b<script>' });
    const { rows } = await pool.query('SELECT 1 FROM event_counts');
    expect(rows).toHaveLength(0);
  });
});
