import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv } from '../test-helpers';
import { __resetOracleBulkForTesting, refreshOracleBulk } from '../offline/bulk-cache';
import { __resetCombosBulkForTesting } from '../offline/combos-export';

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;

  // Stub the Scryfall bulk index + download so the route tests don't hit
  // the live API. Returns a single-card bulk so the slim projection has
  // something to work with.
  await __resetOracleBulkForTesting();
  __resetCombosBulkForTesting();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.includes('/bulk-data')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              type: 'oracle_cards',
              download_uri: 'https://example/bulk-oracle.json',
              updated_at: '2026-05-19T00:00:00Z',
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('bulk-oracle.json')) {
      return new Response(
        JSON.stringify([
          {
            id: 's-1',
            oracle_id: 'o-1',
            name: 'Test Card',
            cmc: 1,
            type_line: 'Creature — Bear',
            colors: ['G'],
            color_identity: ['G'],
            keywords: [],
            legalities: { commander: 'legal' },
            set: 'tst',
            set_name: 'Test Set',
            collector_number: '1',
            games: ['paper'],
          },
        ]),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected fetch in test: ${u}`);
  });

  // Build the bulk synchronously so the route tests get a 200 path. The
  // separate "bulk-still-building" suite below resets state to test the
  // 503 fast path.
  await refreshOracleBulk();
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (cleanup) await cleanup();
});

describe('GET /api/offline/manifest', () => {
  it('returns versions, counts, and byte sizes when the bulk is ready', async () => {
    const res = await request(app).get('/api/offline/manifest');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      oracleCardCount: expect.any(Number),
      oracleByteSize: expect.any(Number),
      oracleVersion: expect.any(String),
      combosVersion: expect.any(String),
    });
    expect(res.body.oracleCardCount).toBeGreaterThan(0);
  });
});

describe('GET /api/offline/oracle-cards', () => {
  it('serves gzipped JSON with an ETag', async () => {
    const res = await request(app)
      .get('/api/offline/oracle-cards')
      .buffer(true)
      // Tell supertest not to auto-decompress so we can inspect the body
      .set('Accept-Encoding', 'identity');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['etag']).toMatch(/^".+"$/);
    expect(res.headers['x-offline-card-count']).toBeDefined();
  });

  it('returns 304 when If-None-Match matches the current version', async () => {
    const first = await request(app).get('/api/offline/oracle-cards');
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();
    const second = await request(app).get('/api/offline/oracle-cards').set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });
});

describe('GET /api/offline/combos', () => {
  it('serves gzipped JSON with an ETag', async () => {
    const res = await request(app)
      .get('/api/offline/combos')
      .buffer(true)
      .set('Accept-Encoding', 'identity');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['etag']).toMatch(/^".+"$/);
  });

  it('returns 304 when If-None-Match matches', async () => {
    const first = await request(app).get('/api/offline/combos');
    const second = await request(app)
      .get('/api/offline/combos')
      .set('If-None-Match', first.headers['etag']);
    expect(second.status).toBe(304);
  });
});

describe('POST /api/offline/admin/refresh-oracle', () => {
  it('returns version + counts after a refresh', async () => {
    const res = await request(app).post('/api/offline/admin/refresh-oracle');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: expect.any(String),
      cardCount: expect.any(Number),
      gzippedBytes: expect.any(Number),
    });
  });
});

/**
 * Separate suite for the 503-fast-path: reset the in-memory bulk so the
 * route sees `state === 'idle'/'building'`. Must run after the happy-path
 * tests since it tears down the cached payload.
 */
describe('GET /api/offline/manifest before the bulk is ready', () => {
  it('returns 503 with Retry-After and kicks off a background build', async () => {
    await __resetOracleBulkForTesting();
    const res = await request(app).get('/api/offline/manifest');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body).toMatchObject({ state: expect.any(String) });
    // Re-prime so trailing tests in this file aren't affected.
    await refreshOracleBulk();
  });

  it('oracle-cards returns 503 fast (no body) when bulk is rebuilding', async () => {
    await __resetOracleBulkForTesting();
    const res = await request(app).get('/api/offline/oracle-cards');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBeDefined();
    await refreshOracleBulk();
  });
});
