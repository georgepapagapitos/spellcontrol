import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv } from '../test-helpers';
import { getScryfallCache } from '../scryfall-cache';
import type { ScryfallCard } from '../types';

let app: Server;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

// Unique per run: the SQLite card cache is shared by every test file.
const id = (n: number) => `card-images-test-${process.pid}-${n}`;
const printing = (scryfallId: string, normal?: string) =>
  ({
    id: scryfallId,
    name: scryfallId,
    ...(normal ? { image_uris: { normal } } : {}),
  }) as unknown as ScryfallCard;

describe('POST /api/cards/image-versions', () => {
  it('returns the stamp of each cached printing and skips the rest', async () => {
    getScryfallCache().setMany([
      printing(id(1), `https://cards.scryfall.io/normal/front/8/1/${id(1)}.jpg?1791120518`),
      printing(id(2)),
    ]);
    const res = await request(app)
      .post('/api/cards/image-versions')
      .send({ scryfallIds: [id(1), id(2), id(3), 7, '', id(1)] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageVersions: { [id(1)]: '1791120518' } });
  });

  it('rejects a body without an id list', async () => {
    const res = await request(app).post('/api/cards/image-versions').send({ ids: [] });
    expect(res.status).toBe(400);
  });
});
