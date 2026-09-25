import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { insertPublication } from './insert';
import type { ListingFields } from './listing-fields';

let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  pool = env.pool;
  cleanup = env.cleanup;
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ('u-ins', 'ins', 1)`);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const fields: ListingFields = {
  name: 'Krenko Goes Wide',
  format: 'commander',
  commanderName: 'Krenko, Mob Boss',
  commanderImageNormal: null,
  ogArtCrop: null,
  colorIdentity: ['R'],
  bracket: 3,
  estimatedBracket: 4,
  cardCount: 100,
};

describe('insertPublication', () => {
  it('returns null, not an error, when another writer already made the row', async () => {
    // The publish route and the sync hook's default publish can race to a new
    // deck; the loser must see "already there", which each handles its own way.
    const first = await insertPublication('u-ins', 'd1', fields, 1, 10);
    expect(first?.unpublished_at).toBeNull();
    expect(await insertPublication('u-ins', 'd1', fields, 2, 20)).toBeNull();
    const rows = await pool.query(`SELECT slug FROM deck_publications WHERE deck_id = 'd1'`);
    expect(rows.rows).toEqual([{ slug: first!.slug }]);
  });

  it('can insert a row that is already private', async () => {
    const row = await insertPublication('u-ins', 'd2', fields, 1, 30, { unpublished: true });
    expect(Number(row!.unpublished_at)).toBe(30);
  });

  it('persists estimated_bracket alongside the stated bracket', async () => {
    await insertPublication('u-ins', 'd3', fields, 1, 40);
    const row = await pool.query(
      `SELECT bracket, estimated_bracket FROM deck_publications WHERE deck_id = 'd3'`
    );
    expect(row.rows[0]).toEqual({ bracket: 3, estimated_bracket: 4 });
  });
});
