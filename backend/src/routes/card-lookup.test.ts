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
const NAME = `Lookup Currency Probe ${process.pid}`;

function seedPrintings(): void {
  const cache = getScryfallCache();
  // Real Scryfall shape: prices are strings, an absent price is null. The
  // USD-cheapest printing (cheap-usd) is the EUR-dearest, and vice versa.
  const printings: ScryfallCard[] = [
    {
      id: 'lookup-cur-cheap-usd',
      name: NAME,
      rarity: 'rare',
      set: 'aaa',
      set_name: 'AAA',
      collector_number: '1',
      prices: { usd: '1.00', usd_foil: null, eur: '4.00', eur_foil: null },
    },
    {
      id: 'lookup-cur-cheap-eur',
      name: NAME,
      rarity: 'rare',
      set: 'bbb',
      set_name: 'BBB',
      collector_number: '2',
      prices: { usd: '3.00', usd_foil: null, eur: '0.50', eur_foil: null },
    },
  ] as unknown as ScryfallCard[];
  cache.setMany(printings);
  cache.setLookups(
    printings.map((p) => ({ key: `ns:${NAME.toLowerCase()}|${p.set}`, scryfallId: p.id }))
  );
}

describe('POST /api/cards/lookup currency (E522)', () => {
  it('returns the USD-cheapest printing by default and for usd', async () => {
    seedPrintings();
    const dflt = await request(app)
      .post('/api/cards/lookup')
      .send({ names: [NAME] });
    expect(dflt.status).toBe(200);
    expect(dflt.body.byName[NAME].id).toBe('lookup-cur-cheap-usd');
    const usd = await request(app)
      .post('/api/cards/lookup')
      .send({ names: [NAME], currency: 'usd' });
    expect(usd.body.byName[NAME].id).toBe('lookup-cur-cheap-usd');
  });

  it('returns the EUR-cheapest printing for eur', async () => {
    seedPrintings();
    const res = await request(app)
      .post('/api/cards/lookup')
      .send({ names: [NAME], currency: 'eur' });
    expect(res.status).toBe(200);
    expect(res.body.byName[NAME].id).toBe('lookup-cur-cheap-eur');
  });

  it('rejects any other currency', async () => {
    const res = await request(app)
      .post('/api/cards/lookup')
      .send({ names: [NAME], currency: 'gbp' });
    expect(res.status).toBe(400);
  });
});
