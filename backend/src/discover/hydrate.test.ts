import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { getScryfallCache } from '../scryfall-cache';
import type { ScryfallCard } from '../types';
import { hydratePublicationRows, type PublicationListingRow } from './hydrate';

let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function makeUser(id: string, username: string): Promise<void> {
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $2, $3)`, [
    id,
    username,
    Date.now(),
  ]);
}

async function makeDeck(
  userId: string,
  deckId: string,
  deck: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, updated_at) VALUES ($1, $2, $3::jsonb, 1, $4)`,
    [userId, deckId, JSON.stringify(deck), Date.now()]
  );
}

function scryfallCard(id: string, oracleId: string, usd: string): ScryfallCard {
  return {
    id,
    oracle_id: oracleId,
    name: id,
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    prices: { usd },
  };
}

function listingRow(overrides: Partial<PublicationListingRow>): PublicationListingRow {
  return {
    userId: 'hyd-user',
    deckId: 'hyd-deck',
    slug: 'hyd-deck-slug',
    name: 'Hydrate Test Deck',
    ownerUsername: 'hyd-owner',
    format: 'commander',
    commanderName: 'Test Commander',
    colorIdentity: ['U'],
    bracket: 3,
    viewCount: 0,
    copyCount: 0,
    publishedAt: Date.now(),
    ...overrides,
  };
}

describe('hydratePublicationRows', () => {
  it('returns [] for empty input', async () => {
    expect(await hydratePublicationRows([])).toEqual([]);
  });

  it('sums price per physical copy, dedupes cardOracleIds, nulls the value on partial cache coverage, and attributes both correctly per deck with no cross-deck bleed', async () => {
    await makeUser('hyd-user-1', 'hyd-owner-1');

    getScryfallCache().setMany([
      scryfallCard('disc-hyd-a', 'disc-hyd-oracle-a', '10.00'),
      scryfallCard('disc-hyd-b', 'disc-hyd-oracle-b', '5.00'),
      // disc-hyd-c is deliberately never cached (cache miss).
    ]);

    // Deck A: fully priced. Two physical copies of card B (same scryfallId)
    // so price sums per copy while cardOracleIds still dedupes.
    await makeDeck('hyd-user-1', 'deck-a', {
      id: 'deck-a',
      name: 'Deck A',
      format: 'commander',
      commander: { id: 'disc-hyd-a', oracle_id: 'disc-hyd-oracle-a', name: 'Card A' },
      partnerCommander: null,
      cards: [
        {
          slotId: 's1',
          card: { id: 'disc-hyd-b', oracle_id: 'disc-hyd-oracle-b', name: 'Card B' },
        },
        {
          slotId: 's2',
          card: { id: 'disc-hyd-b', oracle_id: 'disc-hyd-oracle-b', name: 'Card B' },
        },
      ],
      sideboard: [],
    });

    // Deck B: one mainboard card (C) is never cached -> the whole deck's
    // value must be null, not a partial sum, even though its commander (A)
    // and card C's oracle id both still resolve.
    await makeDeck('hyd-user-1', 'deck-b', {
      id: 'deck-b',
      name: 'Deck B',
      format: 'commander',
      commander: { id: 'disc-hyd-a', oracle_id: 'disc-hyd-oracle-a', name: 'Card A' },
      partnerCommander: null,
      cards: [
        {
          slotId: 's1',
          card: { id: 'disc-hyd-c', oracle_id: 'disc-hyd-oracle-c', name: 'Card C' },
        },
      ],
      sideboard: [
        // Sideboard is excluded from both price and cardOracleIds.
        { slotId: 's2', card: { id: 'disc-hyd-b', oracle_id: 'disc-hyd-oracle-sideboard-only' } },
      ],
    });

    const rows: PublicationListingRow[] = [
      listingRow({ userId: 'hyd-user-1', deckId: 'deck-a', slug: 'slug-a', name: 'Deck A' }),
      listingRow({ userId: 'hyd-user-1', deckId: 'deck-b', slug: 'slug-b', name: 'Deck B' }),
    ];

    const [a, b] = await hydratePublicationRows(rows);

    expect(a.slug).toBe('slug-a');
    expect(a.estimatedValueUsd).toBe(20); // 10 (commander) + 5 + 5 (two copies of B)
    expect([...a.cardOracleIds].sort()).toEqual(['disc-hyd-oracle-a', 'disc-hyd-oracle-b']);

    expect(b.slug).toBe('slug-b');
    expect(b.estimatedValueUsd).toBeNull(); // card C misses the cache
    // No bleed from deck A's card B, and the sideboard-only oracle id is excluded.
    expect([...b.cardOracleIds].sort()).toEqual(['disc-hyd-oracle-a', 'disc-hyd-oracle-c']);
  });

  it('surfaces a publication row with no backing user_decks row as empty/null rather than throwing', async () => {
    await makeUser('hyd-user-2', 'hyd-owner-2');
    const rows = [
      listingRow({ userId: 'hyd-user-2', deckId: 'missing-deck', slug: 'slug-missing' }),
    ];
    const [result] = await hydratePublicationRows(rows);
    expect(result.cardOracleIds).toEqual([]);
    expect(result.estimatedValueUsd).toBeNull();
    expect(result.slug).toBe('slug-missing');
  });
});
