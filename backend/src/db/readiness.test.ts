import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  DB_UNAVAILABLE_ERROR,
  isDbReady,
  prepareDatabase,
  requireDb,
  resetDbReadinessForTesting,
  whenDbReady,
} from './readiness';

function gatedApp() {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.requestId = 'req-1';
    next();
  });
  app.get('/db', requireDb, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

afterEach(() => resetDbReadinessForTesting());

describe('requireDb', () => {
  it('answers 503 with Retry-After and the error shape until the schema is ready', async () => {
    const res = await request(gatedApp()).get('/db');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toEqual({ error: DB_UNAVAILABLE_ERROR, requestId: 'req-1' });
  });

  it('passes through once prepareDatabase succeeds', async () => {
    await prepareDatabase(async () => {});
    expect(isDbReady()).toBe(true);
    const res = await request(gatedApp()).get('/db');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('prepareDatabase', () => {
  it('retries with doubling backoff up to the ceiling, then opens the gate', async () => {
    const waits: number[] = [];
    let calls = 0;
    let resolved = false;
    void whenDbReady().then(() => (resolved = true));
    const attempts = await prepareDatabase(
      async () => {
        calls++;
        if (calls < 5) throw new Error('connect ECONNREFUSED');
        expect(isDbReady()).toBe(false);
      },
      { baseMs: 100, maxMs: 300, sleep: async (ms) => void waits.push(ms) }
    );
    expect(attempts).toBe(5);
    expect(waits).toEqual([100, 200, 300, 300]);
    await whenDbReady();
    expect(resolved).toBe(true);
    expect(isDbReady()).toBe(true);
  });

  it('is not ready again after a test reset', async () => {
    await prepareDatabase(async () => {});
    resetDbReadinessForTesting();
    expect(isDbReady()).toBe(false);
  });
});
