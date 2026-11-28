import { afterEach, describe, expect, it } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import {
  DB_UNAVAILABLE_ERROR,
  dbGate,
  isDbReady,
  markDbReadyForTesting,
  prepareDatabase,
  requireDb,
  resetDbReadinessForTesting,
  retryWithBackoff,
  whenDbReady,
} from './readiness';

function gatedApp(gate: RequestHandler = requireDb) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.requestId = 'req-1';
    next();
  });
  app.use('/api/x', gate, (req, res) => {
    res.json({ ok: true, path: req.path });
  });
  return app;
}

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

afterEach(() => resetDbReadinessForTesting());

describe('dbGate', () => {
  it('answers API clients 503 with Retry-After and the JSON error shape until ready', async () => {
    for (const accept of [undefined, 'application/json', '*/*']) {
      const req = request(gatedApp()).get('/api/x/me');
      const res = accept ? await req.set('Accept', accept) : await req;
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('5');
      expect(res.body).toEqual({ error: DB_UNAVAILABLE_ERROR, requestId: 'req-1' });
    }
  });

  it('answers a browser navigation with a page that retries itself, not raw JSON', async () => {
    const res = await request(gatedApp()).get('/api/x/callback').set('Accept', BROWSER_ACCEPT);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('<meta http-equiv="refresh" content="5">');
    expect(res.text).toContain('href="/"');
    // A POST is never a navigation the page could replay; it keeps the JSON shape.
    const post = await request(gatedApp()).post('/api/x/callback').set('Accept', BROWSER_ACCEPT);
    expect(post.body).toEqual({ error: DB_UNAVAILABLE_ERROR, requestId: 'req-1' });
  });

  it('passes `except` paths and paths outside `only`, and adds `headers`', async () => {
    const except = gatedApp(dbGate({ except: ['/logout'] }));
    expect((await request(except).post('/api/x/logout')).status).toBe(200);
    expect((await request(except).post('/api/x/logout-all')).status).toBe(503);

    const only = gatedApp(dbGate({ only: ['/combos'], headers: { 'X-Test': 'closed' } }));
    expect((await request(only).get('/api/x/oracle-cards')).status).toBe(200);
    expect((await request(only).get('/api/x/combos-version')).status).toBe(200);
    const closed = await request(only).get('/api/x/combos');
    expect(closed.status).toBe(503);
    expect(closed.headers['x-test']).toBe('closed');
  });

  it('passes everything once the schema is ready', async () => {
    markDbReadyForTesting();
    const res = await request(gatedApp()).get('/api/x/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, path: '/me' });
  });
});

describe('retryWithBackoff and prepareDatabase', () => {
  it('retries with doubling backoff up to the ceiling', async () => {
    const waits: number[] = [];
    let calls = 0;
    const attempts = await retryWithBackoff(
      '[test] step failed',
      async () => {
        if (++calls < 5) throw new Error('connect ECONNREFUSED');
      },
      { baseMs: 100, maxMs: 300, sleep: async (ms) => void waits.push(ms) }
    );
    expect(attempts).toBe(5);
    expect(waits).toEqual([100, 200, 300, 300]);
  });

  it('opens the gate only after the schema succeeds', async () => {
    let resolved = false;
    void whenDbReady().then(() => (resolved = true));
    let calls = 0;
    await prepareDatabase(
      async () => {
        if (++calls < 3) throw new Error('relation does not exist');
        expect(isDbReady()).toBe(false);
      },
      { sleep: async () => {} }
    );
    await whenDbReady();
    expect(resolved).toBe(true);
    expect(isDbReady()).toBe(true);
    resetDbReadinessForTesting();
    expect(isDbReady()).toBe(false);
  });
});
