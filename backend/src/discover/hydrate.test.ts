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
    ownerDisplayName: null,
    ownerAvatarUrl: null,
    format: 'commander',
    commanderName: 'Test Commander',
    colorIdentity: ['U'],
    bracket: 3,
    viewCount: 0,
    copyCount: 0,
    likeCount: 0,
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

  it('passes ownerDisplayName/ownerAvatarUrl through untouched, including when both are null', async () => {
    await makeUser('hyd-user-owner', 'hyd-owner-plain');
    await makeDeck('hyd-user-owner', 'deck-owner', { id: 'deck-owner', name: 'Deck', cards: [] });
    const rows = [
      listingRow({
        userId: 'hyd-user-owner',
        deckId: 'deck-owner',
        slug: 'slug-owner-fields',
        ownerUsername: 'hyd-owner-plain',
        ownerDisplayName: 'Hyd Display Name',
        ownerAvatarUrl: 'https://cards.scryfall.io/art_crop/x.jpg',
      }),
    ];
    const [result] = await hydratePublicationRows(rows);
    expect(result.ownerDisplayName).toBe('Hyd Display Name');
    expect(result.ownerAvatarUrl).toBe('https://cards.scryfall.io/art_crop/x.jpg');

    const [unset] = await hydratePublicationRows([
      listingRow({
        userId: 'hyd-user-owner',
        deckId: 'deck-owner',
        slug: 'slug-owner-unset',
      }),
    ]);
    expect(unset.ownerDisplayName).toBeNull();
    expect(unset.ownerAvatarUrl).toBeNull();
  });

  it('leaves likedByViewer/bookmarkedByViewer false for every row when no viewerId is passed (guest)', async () => {
    await makeUser('hyd-user-3', 'hyd-owner-3');
    await makeDeck('hyd-user-3', 'deck-guest', { id: 'deck-guest', name: 'Deck Guest', cards: [] });
    const rows = [
      listingRow({
        userId: 'hyd-user-3',
        deckId: 'deck-guest',
        slug: 'slug-guest',
        likeCount: 12,
      }),
    ];
    const [result] = await hydratePublicationRows(rows);
    expect(result.likeCount).toBe(12);
    expect(result.likedByViewer).toBe(false);
    expect(result.bookmarkedByViewer).toBe(false);
  });

  it('batch-checks deck_likes/deck_bookmarks for the given viewerId, scoped per row with no cross-slug bleed', async () => {
    await makeUser('hyd-user-4', 'hyd-owner-4');
    await makeUser('hyd-viewer-4', 'hyd-viewer-username-4');
    await makeDeck('hyd-user-4', 'deck-liked', { id: 'deck-liked', name: 'Liked', cards: [] });
    await makeDeck('hyd-user-4', 'deck-bookmarked', {
      id: 'deck-bookmarked',
      name: 'Bookmarked',
      cards: [],
    });
    await makeDeck('hyd-user-4', 'deck-neither', {
      id: 'deck-neither',
      name: 'Neither',
      cards: [],
    });

    await pool.query(
      `INSERT INTO deck_likes (user_id, slug, deck_owner_id, created_at) VALUES ($1, $2, $3, $4)`,
      ['hyd-viewer-4', 'slug-liked', 'hyd-user-4', Date.now()]
    );
    await pool.query(
      `INSERT INTO deck_bookmarks (user_id, slug, deck_owner_id, created_at) VALUES ($1, $2, $3, $4)`,
      ['hyd-viewer-4', 'slug-bookmarked', 'hyd-user-4', Date.now()]
    );

    const rows = [
      listingRow({ userId: 'hyd-user-4', deckId: 'deck-liked', slug: 'slug-liked' }),
      listingRow({ userId: 'hyd-user-4', deckId: 'deck-bookmarked', slug: 'slug-bookmarked' }),
      listingRow({ userId: 'hyd-user-4', deckId: 'deck-neither', slug: 'slug-neither' }),
    ];
    const results = await hydratePublicationRows(rows, 'hyd-viewer-4');
    const byslug = new Map(results.map((r) => [r.slug, r]));

    expect(byslug.get('slug-liked')).toMatchObject({
      likedByViewer: true,
      bookmarkedByViewer: false,
    });
    expect(byslug.get('slug-bookmarked')).toMatchObject({
      likedByViewer: false,
      bookmarkedByViewer: true,
    });
    expect(byslug.get('slug-neither')).toMatchObject({
      likedByViewer: false,
      bookmarkedByViewer: false,
    });
  });
});
