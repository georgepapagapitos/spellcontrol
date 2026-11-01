import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  createRefreshPricesHandler,
  REFRESH_LIVE_PER_IP,
  REFRESH_LIVE_PER_REQUEST,
} from './refresh-prices';
import type { ScryfallCard } from './types';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function setup(found: (id: string) => boolean = () => true) {
  const fetchLive = vi.fn(async (ids: string[]) =>
    ids.filter(found).map((id) => ({ id }) as unknown as ScryfallCard)
  );
  const handler = createRefreshPricesHandler({
    getCached: () => new Map(),
    fetchLive,
    buildPayload: (cards) => ({ n: cards.length }),
  });
  const app = express();
  app.use(express.json());
  app.post('/api/refresh-prices', handler);
  return { app, fetchLive };
}

describe('POST /api/refresh-prices live fallback', () => {
  it('forwards only valid UUIDs, capped per request', async () => {
    const { app, fetchLive } = setup();
    const ids = [
      ...Array.from({ length: 1000 }, (_, i) => uuid(i)),
      'not-a-uuid',
      '../../etc/passwd',
      '',
    ];
    const res = await request(app).post('/api/refresh-prices').send({ scryfallIds: ids });
    expect(res.status).toBe(200);
    const sent = fetchLive.mock.calls.flatMap((c) => c[0]);
    expect(sent).toHaveLength(REFRESH_LIVE_PER_REQUEST);
    expect(sent.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });

  it('answers a junk-only body without touching Scryfall', async () => {
    const { app, fetchLive } = setup();
    const res = await request(app)
      .post('/api/refresh-prices')
      .send({ scryfallIds: ['x', 'y'] });
    expect(res.body).toEqual({ prices: {} });
    expect(fetchLive).not.toHaveBeenCalled();
  });

  it('caps live ids per IP across requests', async () => {
    const { app, fetchLive } = setup();
    for (let r = 0; r < 8; r++) {
      const ids = Array.from({ length: 150 }, (_, i) => uuid(r * 1000 + i));
      await request(app).post('/api/refresh-prices').send({ scryfallIds: ids });
    }
    const total = fetchLive.mock.calls.reduce((n, c) => n + c[0].length, 0);
    expect(total).toBe(REFRESH_LIVE_PER_IP);
  });

  it('does not re-ask Scryfall for an id it just did not know', async () => {
    const { app, fetchLive } = setup((id) => id === uuid(1));
    const body = { scryfallIds: [uuid(1), uuid(2)] };
    await request(app).post('/api/refresh-prices').send(body);
    await request(app).post('/api/refresh-prices').send(body);
    expect(fetchLive).toHaveBeenCalledTimes(2);
    expect(fetchLive.mock.calls[1][0]).toEqual([uuid(1)]);
  });

  it('does not remember ids after an empty result (a failed fetch)', async () => {
    const { app, fetchLive } = setup(() => false);
    const body = { scryfallIds: [uuid(1), uuid(2)] };
    await request(app).post('/api/refresh-prices').send(body);
    await request(app).post('/api/refresh-prices').send(body);
    expect(fetchLive).toHaveBeenCalledTimes(2);
  });
});
