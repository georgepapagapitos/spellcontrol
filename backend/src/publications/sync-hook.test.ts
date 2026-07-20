/**
 * Real-Postgres tests for the fire-and-forget `/api/sync` → `deck_publications`
 * consistency hook, calling `refreshDeckPublications` directly against fixture
 * rows — faster and more targeted than driving the full HTTP `/api/sync` stack
 * for hook-only logic. The route-level fire-and-forget wiring itself (a sync
 * push still 200s when this hook throws) is covered separately in
 * routes/sync.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { refreshDeckPublications } from './sync-hook';
import type { AppliedRow } from '../routes/sync';

const { mockInvalidateDeckPublicationCache, mockInvalidatePublicUserCache } = vi.hoisted(() => ({
  mockInvalidateDeckPublicationCache: vi.fn(),
  mockInvalidatePublicUserCache: vi.fn(),
}));
vi.mock('./cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cache')>();
  return {
    ...actual,
    invalidateDeckPublicationCache: mockInvalidateDeckPublicationCache,
    invalidatePublicUserCache: mockInvalidatePublicUserCache,
  };
});

// Only the "per-row error swallow" test overrides this (via mockImplementationOnce);
// every other test falls through to the real implementation.
const { mockExtractListingFields } = vi.hoisted(() => ({ mockExtractListingFields: vi.fn() }));
vi.mock('./listing-fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./listing-fields')>();
  mockExtractListingFields.mockImplementation(actual.extractListingFields);
  return { ...actual, extractListingFields: mockExtractListingFields };
});

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

beforeEach(() => {
  mockInvalidateDeckPublicationCache.mockClear();
  mockInvalidatePublicUserCache.mockClear();
});

/** A realistic deck fixture — same shape as listing-fields.test.ts's baseDeck,
 *  with commander art_crop present so og_art_crop resolves to a real URL. */
function baseDeckData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Atraxa Superfriends',
    format: 'commander',
    commander: {
      id: 'atraxa',
      name: "Atraxa, Praetors' Voice",
      color_identity: ['W', 'U', 'B', 'G'],
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/atraxa.jpg',
        art_crop: 'https://cards.scryfall.io/art_crop/atraxa.jpg',
      },
    },
    partnerCommander: null,
    cards: [{ slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null }],
    ...overrides,
  };
}

async function seedUser(userId: string, username: string): Promise<void> {
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $2, $3)`, [
    userId,
    username,
    Date.now(),
  ]);
}

/** Upsert a `user_decks` row — mirrors the shape a sync push would have just committed. */
async function upsertDeck(
  userId: string,
  deckId: string,
  data: Record<string, unknown>,
  rev: number
): Promise<void> {
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, id) DO UPDATE
       SET data = EXCLUDED.data, rev = EXCLUDED.rev, updated_at = EXCLUDED.updated_at`,
    [userId, deckId, JSON.stringify(data), rev, Date.now()]
  );
}

interface PublicationFixtureOverrides {
  slug: string;
  deckName: string;
  format: string;
  commanderName: string | null;
  commanderImageNormal: string | null;
  ogArtCrop: string | null;
  colorIdentity: string[];
  bracket: number | null;
  cardCount: number;
  deckRev: number;
  publishedAt: number;
  updatedAt: number;
}

/** Seed a pre-existing `deck_publications` row with deliberately stale values,
 *  so a refresh test can prove the UPDATE actually overwrote them. */
async function seedPublication(
  userId: string,
  deckId: string,
  overrides: Partial<PublicationFixtureOverrides> = {}
): Promise<void> {
  const o: PublicationFixtureOverrides = {
    slug: `stale-slug-${deckId}`,
    deckName: 'Stale Name',
    format: 'standard',
    commanderName: null,
    commanderImageNormal: null,
    ogArtCrop: null,
    colorIdentity: [],
    bracket: null,
    cardCount: 0,
    deckRev: 0,
    publishedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, commander_name, commander_image_normal,
        og_art_crop, color_identity, bracket, card_count, deck_rev, published_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)`,
    [
      userId,
      deckId,
      o.slug,
      o.deckName,
      o.format,
      o.commanderName,
      o.commanderImageNormal,
      o.ogArtCrop,
      JSON.stringify(o.colorIdentity),
      o.bracket,
      o.cardCount,
      o.deckRev,
      o.publishedAt,
      o.updatedAt,
    ]
  );
}

interface PublicationFixtureRow {
  slug: string;
  deck_name: string;
  format: string;
  commander_name: string | null;
  commander_image_normal: string | null;
  og_art_crop: string | null;
  color_identity: string[];
  bracket: number | null;
  card_count: number;
  deck_rev: string;
  updated_at: string;
}

async function readPublication(
  userId: string,
  deckId: string
): Promise<PublicationFixtureRow | undefined> {
  const res = await pool.query<PublicationFixtureRow>(
    `SELECT slug, deck_name, format, commander_name, commander_image_normal, og_art_crop,
            color_identity, bracket, card_count, deck_rev, updated_at
       FROM deck_publications WHERE user_id = $1 AND deck_id = $2`,
    [userId, deckId]
  );
  return res.rows[0];
}

describe('refreshDeckPublications — upserts', () => {
  it('refreshes every denormalized column (incl. og_art_crop) and bumps updated_at/deck_rev', async () => {
    const userId = 'u-refresh-all';
    await seedUser(userId, 'refresh-all');
    await upsertDeck(userId, 'deck-1', baseDeckData(), 5);
    await seedPublication(userId, 'deck-1', { slug: 'frozen-slug', deckRev: 1 });

    const applied: AppliedRow[] = [{ kind: 'deck', id: 'deck-1', rev: 5, deletedAt: null }];
    await refreshDeckPublications(userId, applied);

    const row = await readPublication(userId, 'deck-1');
    expect(row).toBeDefined();
    expect(row!.slug).toBe('frozen-slug'); // slug is never touched by a refresh
    expect(row!.deck_name).toBe('Atraxa Superfriends');
    expect(row!.format).toBe('commander');
    expect(row!.commander_name).toBe("Atraxa, Praetors' Voice");
    expect(row!.commander_image_normal).toBe('https://cards.scryfall.io/normal/atraxa.jpg');
    expect(row!.og_art_crop).toBe('https://cards.scryfall.io/art_crop/atraxa.jpg');
    expect(row!.color_identity).toEqual(['W', 'U', 'B', 'G']);
    expect(row!.card_count).toBe(2); // commander + 1 mainboard card
    expect(Number(row!.deck_rev)).toBe(5);
    expect(Number(row!.updated_at)).toBeGreaterThan(1000);
  });

  it('is a no-op for a never-published deck — publish stays explicit-only', async () => {
    const userId = 'u-never-pub';
    await seedUser(userId, 'never-pub');
    await upsertDeck(userId, 'deck-2', baseDeckData(), 3);

    await refreshDeckPublications(userId, [
      { kind: 'deck', id: 'deck-2', rev: 3, deletedAt: null },
    ]);

    expect(await readPublication(userId, 'deck-2')).toBeUndefined();
  });

  it('redelivering the identical (id, rev) a second time is a no-op', async () => {
    const userId = 'u-idempotent';
    await seedUser(userId, 'idempotent');
    await upsertDeck(userId, 'deck-3', baseDeckData({ name: 'Original Name' }), 10);
    await seedPublication(userId, 'deck-3', { deckRev: 5 });

    await refreshDeckPublications(userId, [
      { kind: 'deck', id: 'deck-3', rev: 10, deletedAt: null },
    ]);
    const afterFirst = await readPublication(userId, 'deck-3');
    expect(afterFirst!.deck_name).toBe('Original Name');
    expect(Number(afterFirst!.deck_rev)).toBe(10);

    // Underlying storage changes WITHOUT a fresh rev — simulates a redelivered
    // push for the same (id, rev). The guard must key off rev, not content.
    await upsertDeck(userId, 'deck-3', baseDeckData({ name: 'Renamed After First Refresh' }), 10);
    await refreshDeckPublications(userId, [
      { kind: 'deck', id: 'deck-3', rev: 10, deletedAt: null },
    ]);

    const afterSecond = await readPublication(userId, 'deck-3');
    expect(afterSecond!.deck_name).toBe('Original Name'); // deck_rev(10) < rev(10) is false
  });

  it('catches a per-row error and still processes the rest of the batch', async () => {
    const userId = 'u-partial-fail';
    await seedUser(userId, 'partial-fail');
    await upsertDeck(userId, 'deck-bad', baseDeckData(), 4);
    await seedPublication(userId, 'deck-bad', { deckRev: 1 });
    await upsertDeck(userId, 'deck-good', baseDeckData({ name: 'Healthy Deck' }), 9);
    await seedPublication(userId, 'deck-good', { deckRev: 1 });

    mockExtractListingFields.mockImplementationOnce(() => {
      throw new Error('simulated row failure');
    });

    const applied: AppliedRow[] = [
      { kind: 'deck', id: 'deck-bad', rev: 4, deletedAt: null },
      { kind: 'deck', id: 'deck-good', rev: 9, deletedAt: null },
    ];
    await expect(refreshDeckPublications(userId, applied)).resolves.toBeUndefined();

    const badRow = await readPublication(userId, 'deck-bad');
    expect(Number(badRow!.deck_rev)).toBe(1); // its own refresh blew up — untouched

    const goodRow = await readPublication(userId, 'deck-good');
    expect(goodRow!.deck_name).toBe('Healthy Deck'); // second row in the batch still processed
    expect(Number(goodRow!.deck_rev)).toBe(9);
  });
});

describe('refreshDeckPublications — tombstones', () => {
  it('deletes the row and invalidates both caches for a published deck', async () => {
    const userId = 'u-tombstone-pub';
    await seedUser(userId, 'tombstone-pub');
    await upsertDeck(userId, 'deck-4', baseDeckData(), 7);
    await seedPublication(userId, 'deck-4', { slug: 'tombstone-slug' });

    await refreshDeckPublications(userId, [
      { kind: 'deck', id: 'deck-4', rev: 8, deletedAt: Date.now() },
    ]);

    expect(await readPublication(userId, 'deck-4')).toBeUndefined();
    expect(mockInvalidateDeckPublicationCache).toHaveBeenCalledWith('tombstone-slug');
    expect(mockInvalidatePublicUserCache).toHaveBeenCalledWith('tombstone-pub');
  });

  it('is a no-op for a never-published deck — neither cache invalidation fires', async () => {
    const userId = 'u-tombstone-never';
    await seedUser(userId, 'tombstone-never');
    await upsertDeck(userId, 'deck-5', baseDeckData(), 2);

    await refreshDeckPublications(userId, [
      { kind: 'deck', id: 'deck-5', rev: 3, deletedAt: Date.now() },
    ]);

    expect(await readPublication(userId, 'deck-5')).toBeUndefined();
    expect(mockInvalidateDeckPublicationCache).not.toHaveBeenCalled();
    expect(mockInvalidatePublicUserCache).not.toHaveBeenCalled();
  });
});
