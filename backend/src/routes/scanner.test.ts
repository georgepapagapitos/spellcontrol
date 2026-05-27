import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv } from '../test-helpers';
import { resetMatcherForTests } from '../scanner/matcher';

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;

  // Point the route at an empty dir so getMatcher() takes the
  // "data files missing" branch deterministically — no need to ship
  // 70 MB of test fixtures into CI.
  process.env.SCANNER_DATA_DIR = '/tmp/spellcontrol-scanner-test-empty';
  resetMatcherForTests();
});

afterAll(async () => {
  delete process.env.SCANNER_DATA_DIR;
  resetMatcherForTests();
  await cleanup();
});

describe('POST /api/scanner/match', () => {
  it('returns 415 when no image is uploaded', async () => {
    const res = await request(app).post('/api/scanner/match').send({});
    expect(res.status).toBe(415);
  });

  it('returns 503 when scanner data files are missing on the server', async () => {
    const res = await request(app)
      .post('/api/scanner/match')
      .attach('image', Buffer.from([0, 1, 2, 3]), {
        filename: 'tiny.bin',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(503);
    expect(res.body.kind).toBe('unavailable');
  });
});

describe('GET /api/scanner/stats', () => {
  it('returns 503 when scanner data files are missing on the server', async () => {
    const res = await request(app).get('/api/scanner/stats');
    expect(res.status).toBe(503);
  });
});
