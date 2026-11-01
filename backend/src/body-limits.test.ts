import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountBodyParsers } from './body-limits';
import { attachRequestId, unhandledErrorHandler } from './request-context';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeApp() {
  const app = express();
  app.use(attachRequestId);
  mountBodyParsers(app);
  app.post('/api/auth/login', (_req, res) => res.status(401).json({ error: 'no' }));
  app.post('/api/sync', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
  app.use(unhandledErrorHandler);
  return app;
}

const big = (mb: number) => ({ pad: 'x'.repeat(mb * 1024 * 1024) });

describe('global JSON body limit', () => {
  it('rejects a 2 MB body to /api/auth/login with 413', async () => {
    const res = await request(makeApp()).post('/api/auth/login').send(big(2));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('rejects a 2 MB body to an unknown route with 413', async () => {
    const res = await request(makeApp()).post('/api/nope').send(big(2));
    expect(res.status).toBe(413);
  });

  it('still accepts a collection-sized body on /api/sync', async () => {
    const res = await request(makeApp()).post('/api/sync').send(big(5));
    expect(res.status).toBe(200);
  });
});

describe('server.ts wiring', () => {
  const src = readFileSync(join(__dirname, 'server.ts'), 'utf8');
  it('mounts the split parsers and no ad-hoc express.json', () => {
    expect(src).toContain('mountBodyParsers(app)');
    expect(src).not.toMatch(/express\.json\(/);
  });
  it('serves refresh-prices through the hardened handler', () => {
    expect(src).toContain('createRefreshPricesHandler(');
  });
});
