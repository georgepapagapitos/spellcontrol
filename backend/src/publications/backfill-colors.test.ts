import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { backfillPublicationColors } from './backfill-colors';

let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  pool = env.pool;
  cleanup = env.cleanup;
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ('u-bf', 'bf', 1)`);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const slot = (name: string, color_identity: string[]) => ({
  slotId: name,
  card: { id: name, name, color_identity },
});

async function seed(deckId: string, data: unknown, colorIdentity: string[] = []): Promise<void> {
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, updated_at) VALUES ('u-bf', $1, $2, 7, 1)`,
    [deckId, JSON.stringify(data)]
  );
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, color_identity, deck_rev, published_at, updated_at)
     VALUES ('u-bf', $1, $1, 'x', 'pauper', $2::jsonb, 7, 1, 5)`,
    [deckId, JSON.stringify(colorIdentity)]
  );
}

async function row(deckId: string) {
  const r = await pool.query(
    `SELECT color_identity, deck_rev, updated_at FROM deck_publications WHERE deck_id = $1`,
    [deckId]
  );
  return r.rows[0];
}

describe('backfillPublicationColors', () => {
  it('colors a published Pauper deck stored as colorless, once', async () => {
    const pauper = {
      name: 'Mono Green Elves',
      format: 'pauper',
      commander: null,
      cards: [slot('Llanowar Elves', ['G']), slot('Llanowar Elves', ['G'])],
      sideboard: [slot('Duress', ['B'])],
    };
    await seed('pauper', pauper);
    await seed('artifacts', {
      name: 'Colorless',
      format: 'pauper',
      commander: null,
      cards: [slot('Ornithopter', [])],
    });
    await seed('already', { ...pauper, name: 'Already colored' }, ['R']);

    expect(await backfillPublicationColors(pool)).toBe(1);

    // Only the color moves: the rev and "updated" stamp stay, so a later sync
    // still refreshes the row and the Recently updated sort doesn't reshuffle.
    expect(await row('pauper')).toEqual({
      color_identity: ['G', 'B'],
      deck_rev: '7',
      updated_at: '5',
    });
    expect((await row('artifacts')).color_identity).toEqual([]);
    expect((await row('already')).color_identity).toEqual(['R']);

    // Gated: a second boot doesn't rescan.
    await pool.query(`UPDATE deck_publications SET color_identity = '[]' WHERE deck_id = 'pauper'`);
    expect(await backfillPublicationColors(pool)).toBe(0);
    expect((await row('pauper')).color_identity).toEqual([]);
  });
});
