import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv } from '../test-helpers';
import { getScryfallCache } from '../scryfall-cache';
import type { ScryfallCard } from '../types';
import { resetMpcSourcesCache } from '../mpc/order';
// Recorded from mpcfill.com and api.scryfall.com on 2026-11-06, trimmed.
import mpcfill from '../mpc/__fixtures__/mpcfill-2026-11-06.json';
import twoNameCards from '../mpc/__fixtures__/scryfall-two-name-cards.json';

let app: Server;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  cleanup = env.cleanup;
  const cards = twoNameCards as unknown as ScryfallCard[];
  const cache = getScryfallCache();
  cache.setMany(cards);
  cache.setLookups(
    // Multi-face names are keyed by the front face, as the bulk ingest writes them.
    cards.map((c) => ({
      key: `ns:${c.name.split(' // ')[0].toLowerCase()}|${c.set}`,
      scryfallId: c.id,
    }))
  );
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetMpcSourcesCache();
});

/** Answers the four index endpoints from the recorded fixture; anything else throws. */
function stubMpcfill(status = 200) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    expect(new Headers(init?.headers).get('User-Agent')).toMatch(/^SpellControl\//);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (status !== 200) return new Response('down', { status });
    const path = url.replace('https://mpcfill.com', '');
    const body = (
      {
        '/2/sources/': mpcfill.sources,
        '/2/editorSearch/': mpcfill.editorSearch,
        '/2/cardbacks/': mpcfill.cardbacks,
        '/2/cards/': mpcfill.cards,
      } as Record<string, unknown>
    )[path];
    if (!body) throw new Error(`Unexpected fetch in test: ${url}`);
    return Response.json(body);
  });
  return calls;
}

const top = (q: string) =>
  (mpcfill.editorSearch.results as Record<string, { CARD: string[] }>)[q].CARD[0];

describe('POST /api/mpc/order', () => {
  it('builds an order with fronts, a printed back for a DFC, and the cardback', async () => {
    stubMpcfill();
    const res = await request(app)
      .post('/api/mpc/order')
      .send({
        list: [
          '1x Sol Ring',
          '2x Delver of Secrets // Insectile Aberration',
          '1x Fire // Ice',
          '1x Not A Real Card Xyzzy',
        ].join('\n'),
      });
    expect(res.status).toBe(200);
    expect(res.body.slots).toBe(4);
    expect(res.body.missing).toEqual(['Not A Real Card Xyzzy']);
    const xml: string = res.body.xml;
    expect(xml).toContain('<quantity>4</quantity>');
    expect(xml).toContain('<bracket>18</bracket>');
    // Sol Ring at slot 0, Delver twice at 1-2 with its back on the same slots,
    // Fire // Ice (a split card, one image) at 3 with no back.
    expect(xml).toMatch(
      new RegExp(
        `<id>${top('sol ring')}</id>\\s*<sourceType>Google Drive</sourceType>\\s*<slots>0</slots>`
      )
    );
    expect(xml).toMatch(
      new RegExp(`<id>${top('delver of secrets')}</id>[\\s\\S]*?<slots>1,2</slots>`)
    );
    expect(xml).toMatch(
      new RegExp(
        `<backs>[\\s\\S]*<id>${top('insectile aberration')}</id>[\\s\\S]*?<slots>1,2</slots>`
      )
    );
    expect(xml).toMatch(new RegExp(`<id>${top('fire // ice')}</id>[\\s\\S]*?<slots>3</slots>`));
    expect(xml).toContain(`<cardback>${mpcfill.cardbacks.cardbacks[0]}</cardback>`);
    expect(xml).toMatch(/<name>[^<]+\.(png|jpg|jpeg)<\/name>/);
  });

  it('answers 502 with readable copy when the index is down', async () => {
    stubMpcfill(503);
    const res = await request(app).post('/api/mpc/order').send({ list: '1x Sol Ring' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Couldn't reach MPC Autofill/);
  });

  it('rejects a bad body, an empty list and an order past 612 cards without calling out', async () => {
    const calls = stubMpcfill();
    expect((await request(app).post('/api/mpc/order').send({})).status).toBe(400);
    expect((await request(app).post('/api/mpc/order').send({ list: 'Commander\n' })).status).toBe(
      400
    );
    const big = await request(app).post('/api/mpc/order').send({ list: '613x Island' });
    expect(big.status).toBe(400);
    expect(big.body.error).toContain('612');
    expect(calls).toEqual([]);
  });
});
