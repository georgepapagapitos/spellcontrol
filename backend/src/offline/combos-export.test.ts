import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __resetCombosBulkForTesting, getCombosBulk } from './combos-export';
import { createTestEnv } from '../test-helpers';
import { getDb } from '../db';
import { combos, comboCards } from '../db/schema';
import type { OfflineCombo } from './types';

let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  cleanup = env.cleanup;
  const db = getDb();
  await db.insert(combos).values([
    {
      id: 'c-popular',
      identity: 'wu',
      produces: ['Win the game'],
      prerequisites: { easy: 'No blockers' },
      description: 'Step 1: tap. Step 2: win.',
      manaNeeded: '{W}{U}',
      popularity: 1000,
      legalities: { commander: 'legal' },
      cardCount: 2,
      bracket: 3,
      updatedAt: Date.now(),
    },
    {
      id: 'c-niche',
      identity: 'b',
      produces: ['Infinite mana'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 10,
      legalities: { commander: 'legal' },
      cardCount: 1,
      bracket: null,
      updatedAt: Date.now(),
    },
    // Combo with no cards — exporter should skip it.
    {
      id: 'c-empty',
      identity: '',
      produces: [],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 0,
      legalities: {},
      cardCount: 0,
      bracket: null,
      updatedAt: Date.now(),
    },
  ]);
  await db.insert(comboCards).values([
    {
      comboId: 'c-popular',
      oracleId: 'o-a',
      cardName: 'Card A',
      quantity: 1,
      position: 1,
    },
    {
      comboId: 'c-popular',
      oracleId: 'o-b',
      cardName: 'Card B',
      quantity: 2,
      position: 0,
    },
    {
      comboId: 'c-niche',
      oracleId: 'o-c',
      cardName: 'Card C',
      quantity: 1,
      position: 0,
    },
  ]);
  __resetCombosBulkForTesting();
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe('getCombosBulk', () => {
  it('serves a gzipped JSON payload with one row per non-empty combo', async () => {
    const bulk = await getCombosBulk();
    expect(bulk.gzippedBytes).toBeGreaterThan(0);
    expect(bulk.gzippedBytes).toBeLessThan(bulk.rawBytes);

    const decoded = gunzipSync(bulk.gzipped).toString('utf-8');
    const rows = JSON.parse(decoded) as OfflineCombo[];
    expect(rows.map((r) => r.id).sort()).toEqual(['c-niche', 'c-popular']);
  });

  it('orders cards within a combo by position', async () => {
    const bulk = await getCombosBulk();
    const rows = JSON.parse(gunzipSync(bulk.gzipped).toString('utf-8')) as OfflineCombo[];
    const popular = rows.find((r) => r.id === 'c-popular')!;
    expect(popular.cards.map((c) => c.oracleId)).toEqual(['o-b', 'o-a']);
  });

  it('reuses the cached payload across calls within the rebuild window', async () => {
    const a = await getCombosBulk();
    const b = await getCombosBulk();
    expect(b.version).toBe(a.version);
    // Same buffer reference indicates no rebuild happened.
    expect(b.gzipped).toBe(a.gzipped);
  });
});
