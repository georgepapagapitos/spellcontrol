import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';
import { getScryfallCache } from '../scryfall-cache';
import type { ScryfallCard } from '../types';

let app: Express;
let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

let seq = 0;
/** Guarantees a unique id/username/commander-name across this whole file —
 *  the schema is shared by every test here (one createTestEnv() per file),
 *  so anything not isolated by an exact-match filter must be collision-proof. */
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function userIdFromCookie(cookie: string): Promise<string> {
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return me.body.user.id as string;
}

/** Publishing requires a display name (routes/publications.ts). */
async function setDisplayName(cookie: string, name: string): Promise<void> {
  const res = await request(app)
    .patch('/api/auth/profile')
    .set('Cookie', cookie)
    .send({ displayName: name });
  expect(res.status).toBe(200);
}

function makeDeckJson(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name: `Deck ${id}`,
    format: 'commander',
    source: 'manual',
    commander: {
      id: `${id}-cmdr`,
      oracle_id: `${id}-cmdr-oracle`,
      name: 'Test Commander',
      color_identity: ['U'],
    },
    partnerCommander: null,
    cards: [],
    sideboard: [],
    color: '#4B0082',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Registers a fresh user, syncs one deck, and publishes it. One user per
 *  deck throughout this file — decouples fixtures from the multi-deck
 *  setSnapshotViaSyncApi diffing behavior entirely. */
async function publishDeck(
  overrides: Record<string, unknown> = {}
): Promise<{ cookie: string; deckId: string; slug: string }> {
  const deckId = uid('disc-deck');
  const cookie = await makeUser(uid('disc-user'));
  await setDisplayName(cookie, uid('Disco Display Name'));
  await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeckJson(deckId, overrides)] });
  const res = await request(app).post(`/api/publications/decks/${deckId}`).set('Cookie', cookie);
  expect(res.status).toBe(201);
  return { cookie, deckId, slug: res.body.publication.slug as string };
}

async function unpublish(cookie: string, deckId: string): Promise<void> {
  const res = await request(app).delete(`/api/publications/decks/${deckId}`).set('Cookie', cookie);
  expect(res.status).toBe(204);
}

/** Direct-SQL stamp for fields the publish flow itself never sets (view/copy
 *  counts start at 0; published_at is frozen at first publish) — mirrors
 *  public.test.ts's own `UPDATE deck_publications SET updated_at = …` trick
 *  for deterministic ordering. */
async function stampPublication(
  deckId: string,
  fields: Partial<{ viewCount: number; copyCount: number; publishedAt: number }>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [deckId];
  if (fields.viewCount !== undefined) {
    params.push(fields.viewCount);
    sets.push(`view_count = $${params.length}`);
  }
  if (fields.copyCount !== undefined) {
    params.push(fields.copyCount);
    sets.push(`copy_count = $${params.length}`);
  }
  if (fields.publishedAt !== undefined) {
    params.push(fields.publishedAt);
    sets.push(`published_at = $${params.length}`);
  }
  if (sets.length === 0) return;
  await pool.query(`UPDATE deck_publications SET ${sets.join(', ')} WHERE deck_id = $1`, params);
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

interface DecksResponseBody {
  decks: Array<{
    slug: string;
    name: string;
    ownerUsername: string;
    format: string;
    commanderName: string | null;
    colorIdentity: string[];
    bracket: number | null;
    estimatedValueUsd: number | null;
    viewCount: number;
    copyCount: number;
    publishedAt: number;
    cardOracleIds: string[];
  }>;
  page: number;
  hasMore: boolean;
}

function slugsOf(body: DecksResponseBody): string[] {
  return body.decks.map((d) => d.slug);
}

describe('GET /api/discover/decks', () => {
  it('excludes unpublished decks', async () => {
    const cmdr = uid('Disco Unpub Cmdr');
    const live = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const gone = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    await unpublish(gone.cookie, gone.deckId);

    const res = await request(app).get('/api/discover/decks').query({ commander: cmdr });
    expect(res.status).toBe(200);
    const slugs = slugsOf(res.body);
    expect(slugs).toContain(live.slug);
    expect(slugs).not.toContain(gone.slug);
  });

  it('filters by exact commander name', async () => {
    const cmdrA = uid('Disco Cmdr Alpha');
    const cmdrB = uid('Disco Cmdr Beta');
    const a = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdrA, color_identity: ['U'] },
    });
    const b = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdrB, color_identity: ['U'] },
    });

    const res = await request(app).get('/api/discover/decks').query({ commander: cmdrA });
    expect(res.status).toBe(200);
    const slugs = slugsOf(res.body);
    expect(slugs).toContain(a.slug);
    expect(slugs).not.toContain(b.slug);
  });

  it('filters colors by identity-subset containment — a WU deck matches W,U,B but not W alone', async () => {
    const cmdr = uid('Disco Colors Cmdr');
    const wu = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['W', 'U'] },
    });

    const matches = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, colors: 'W,U,B' });
    expect(matches.status).toBe(200);
    expect(slugsOf(matches.body)).toEqual([wu.slug]);

    const excludes = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, colors: 'W' });
    expect(excludes.status).toBe(200);
    expect(slugsOf(excludes.body)).not.toContain(wu.slug);
  });

  it('filters by exact format', async () => {
    const cmdr = uid('Disco Format Cmdr');
    const pioneer = await publishDeck({
      format: 'pioneer',
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const commander = await publishDeck({
      format: 'commander',
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });

    const res = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, format: 'pioneer' });
    expect(res.status).toBe(200);
    const slugs = slugsOf(res.body);
    expect(slugs).toContain(pioneer.slug);
    expect(slugs).not.toContain(commander.slug);
  });

  it('filters by bracket set membership, and combines with format', async () => {
    const cmdr = uid('Disco Bracket Cmdr');
    const b1 = await publishDeck({
      format: 'legacy',
      bracketOverride: 1,
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const b2 = await publishDeck({
      format: 'legacy',
      bracketOverride: 2,
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const b3OtherFormat = await publishDeck({
      format: 'vintage',
      bracketOverride: 1,
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });

    const bracketOnly = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, bracket: '1,3' });
    expect(bracketOnly.status).toBe(200);
    const bracketSlugs = slugsOf(bracketOnly.body);
    expect(bracketSlugs).toContain(b1.slug);
    expect(bracketSlugs).toContain(b3OtherFormat.slug);
    expect(bracketSlugs).not.toContain(b2.slug);

    const combined = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, format: 'legacy', bracket: '1' });
    expect(combined.status).toBe(200);
    expect(slugsOf(combined.body)).toEqual([b1.slug]);
  });

  it('sorts by newest, most-copied, and most-viewed', async () => {
    const cmdr = uid('Disco Sort Cmdr');
    const first = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const second = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const third = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    // Deterministic published_at ordering: third is newest, first is oldest.
    await stampPublication(first.deckId, { publishedAt: 1_000, viewCount: 5, copyCount: 30 });
    await stampPublication(second.deckId, { publishedAt: 2_000, viewCount: 30, copyCount: 5 });
    await stampPublication(third.deckId, { publishedAt: 3_000, viewCount: 15, copyCount: 15 });

    const newest = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, sort: 'newest' });
    expect(slugsOf(newest.body)).toEqual([third.slug, second.slug, first.slug]);

    const mostViewed = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, sort: 'most-viewed' });
    expect(slugsOf(mostViewed.body)).toEqual([second.slug, third.slug, first.slug]);

    const mostCopied = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, sort: 'most-copied' });
    expect(slugsOf(mostCopied.body)).toEqual([first.slug, third.slug, second.slug]);
  });

  it('budget band includes only in-range decks and excludes a deck with zero Scryfall cache coverage — which still appears under sort=newest', async () => {
    const cmdr = uid('Disco Budget Cmdr');
    const cheapCard = uid('disc-budget-cheap-card');
    const cheapCardOracle = uid('disc-budget-cheap-card-oracle');
    const cheapCmdrId = uid('disc-budget-cheap-cmdr');
    const cheapCmdrOracle = uid('disc-budget-cheap-cmdr-oracle');
    const midCard = uid('disc-budget-mid-card');
    const midCardOracle = uid('disc-budget-mid-card-oracle');
    const midCmdrId = uid('disc-budget-mid-cmdr');
    const midCmdrOracle = uid('disc-budget-mid-cmdr-oracle');
    const uncachedCard = uid('disc-budget-uncached-card'); // never seeded
    const uncachedCardOracle = uid('disc-budget-uncached-card-oracle');
    const uncachedCmdrId = uid('disc-budget-uncached-cmdr');
    const uncachedCmdrOracle = uid('disc-budget-uncached-cmdr-oracle');

    getScryfallCache().setMany([
      scryfallCard(cheapCmdrId, cheapCmdrOracle, '5.00'),
      scryfallCard(cheapCard, cheapCardOracle, '10.00'),
      scryfallCard(midCmdrId, midCmdrOracle, '5.00'),
      scryfallCard(midCard, midCardOracle, '100.00'),
      scryfallCard(uncachedCmdrId, uncachedCmdrOracle, '5.00'),
      // uncachedCard is deliberately never cached.
    ]);

    const cheap = await publishDeck({
      commander: { id: cheapCmdrId, oracle_id: cheapCmdrOracle, name: cmdr, color_identity: ['U'] },
      cards: [
        {
          slotId: 's1',
          card: { id: cheapCard, oracle_id: cheapCardOracle },
          allocatedCopyId: null,
        },
      ],
    });
    const mid = await publishDeck({
      commander: { id: midCmdrId, oracle_id: midCmdrOracle, name: cmdr, color_identity: ['U'] },
      cards: [
        { slotId: 's1', card: { id: midCard, oracle_id: midCardOracle }, allocatedCopyId: null },
      ],
    });
    const uncached = await publishDeck({
      commander: {
        id: uncachedCmdrId,
        oracle_id: uncachedCmdrOracle,
        name: cmdr,
        color_identity: ['U'],
      },
      cards: [
        {
          slotId: 's1',
          card: { id: uncachedCard, oracle_id: uncachedCardOracle },
          allocatedCopyId: null,
        },
      ],
    });

    const under50 = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, budget: 'under50' });
    expect(under50.status).toBe(200);
    expect(slugsOf(under50.body)).toEqual([cheap.slug]);
    expect(under50.body.decks[0].estimatedValueUsd).toBe(15);

    const midBand = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, budget: '50to150' });
    expect(slugsOf(midBand.body)).toEqual([mid.slug]);
    expect(midBand.body.decks[0].estimatedValueUsd).toBe(105);

    // The folded fix: no active budget filter -> the uncached deck still shows.
    const unfiltered = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, sort: 'newest' });
    const unfilteredSlugs = slugsOf(unfiltered.body);
    expect(unfilteredSlugs).toEqual(expect.arrayContaining([cheap.slug, mid.slug, uncached.slug]));
    const uncachedEntry = unfiltered.body.decks.find(
      (d: { slug: string }) => d.slug === uncached.slug
    );
    expect(uncachedEntry?.estimatedValueUsd).toBeNull();
  });

  it('paginates with correct hasMore/page math', async () => {
    const cmdr = uid('Disco Page Cmdr');
    const one = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const two = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    const three = await publishDeck({
      commander: { id: uid('c'), oracle_id: uid('o'), name: cmdr, color_identity: ['U'] },
    });
    await stampPublication(one.deckId, { publishedAt: 1_000 });
    await stampPublication(two.deckId, { publishedAt: 2_000 });
    await stampPublication(three.deckId, { publishedAt: 3_000 });

    const page1 = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, pageSize: 2, page: 1 });
    expect(page1.status).toBe(200);
    expect(page1.body.page).toBe(1);
    expect(page1.body.hasMore).toBe(true);
    expect(slugsOf(page1.body)).toEqual([three.slug, two.slug]);

    const page2 = await request(app)
      .get('/api/discover/decks')
      .query({ commander: cmdr, pageSize: 2, page: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.page).toBe(2);
    expect(page2.body.hasMore).toBe(false);
    expect(slugsOf(page2.body)).toEqual([one.slug]);
  });

  it('attributes cardOracleIds/estimatedValueUsd per deck with no cross-deck bleed when multiple decks hydrate together', async () => {
    const cmdr = uid('Disco Bleed Cmdr');
    const aCmdrId = uid('disc-bleed-a-cmdr');
    const aCmdrOracle = uid('disc-bleed-a-cmdr-oracle');
    const bCmdrId = uid('disc-bleed-b-cmdr');
    const bCmdrOracle = uid('disc-bleed-b-cmdr-oracle');

    getScryfallCache().setMany([
      scryfallCard(aCmdrId, aCmdrOracle, '7.00'),
      scryfallCard(bCmdrId, bCmdrOracle, '9.00'),
    ]);

    const a = await publishDeck({
      commander: { id: aCmdrId, oracle_id: aCmdrOracle, name: cmdr, color_identity: ['U'] },
    });
    const b = await publishDeck({
      commander: { id: bCmdrId, oracle_id: bCmdrOracle, name: cmdr, color_identity: ['U'] },
    });

    const res = await request(app).get('/api/discover/decks').query({ commander: cmdr });
    expect(res.status).toBe(200);
    const aEntry = res.body.decks.find((d: { slug: string }) => d.slug === a.slug);
    const bEntry = res.body.decks.find((d: { slug: string }) => d.slug === b.slug);
    expect(aEntry.estimatedValueUsd).toBe(7);
    expect(aEntry.cardOracleIds).toEqual([aCmdrOracle]);
    expect(bEntry.estimatedValueUsd).toBe(9);
    expect(bEntry.cardOracleIds).toEqual([bCmdrOracle]);
  });
});

describe('GET /api/discover/decks/commanders', () => {
  it('returns prefix matches case-insensitively and excludes unpublished decks', async () => {
    const prefix = uid('Disco Type Match');
    await publishDeck({
      commander: {
        id: uid('c'),
        oracle_id: uid('o'),
        name: `${prefix} Alpha`,
        color_identity: ['U'],
      },
    });
    await publishDeck({
      commander: {
        id: uid('c'),
        oracle_id: uid('o'),
        name: `${prefix} Beta`,
        color_identity: ['U'],
      },
    });
    const gone = await publishDeck({
      commander: {
        id: uid('c'),
        oracle_id: uid('o'),
        name: `${prefix} Gone`,
        color_identity: ['U'],
      },
    });
    await unpublish(gone.cookie, gone.deckId);
    await publishDeck({
      commander: {
        id: uid('c'),
        oracle_id: uid('o'),
        name: uid('Disco Type Nomatch'),
        color_identity: ['U'],
      },
    });

    const res = await request(app)
      .get('/api/discover/decks/commanders')
      .query({ q: prefix.toUpperCase() }); // opposite case from storage
    expect(res.status).toBe(200);
    const names: string[] = res.body.commanders;
    expect(names).toContain(`${prefix} Alpha`);
    expect(names).toContain(`${prefix} Beta`);
    expect(names).not.toContain(`${prefix} Gone`);
  });

  it('caps results at 10', async () => {
    const cookie = await makeUser(uid('disc-cap-user'));
    const userId = await userIdFromCookie(cookie);
    const prefix = uid('Disco Cap Commander');
    await pool.query(
      `INSERT INTO deck_publications
         (user_id, deck_id, slug, deck_name, format, commander_name, color_identity, published_at, updated_at)
       SELECT $1, 'disc-cap-deck-' || g || '-' || $2, 'disc-cap-slug-' || g || '-' || $2, 'Deck ' || g,
              'commander', $2 || ' ' || g, '[]'::jsonb, g::bigint, g::bigint
         FROM generate_series(1, 11) AS g`,
      [userId, prefix]
    );

    const res = await request(app).get('/api/discover/decks/commanders').query({ q: prefix });
    expect(res.status).toBe(200);
    expect(res.body.commanders).toHaveLength(10);
  });

  it('requires q and rejects an overlong q', async () => {
    const empty = await request(app).get('/api/discover/decks/commanders').query({ q: '' });
    expect(empty.status).toBe(400);

    const tooLong = await request(app)
      .get('/api/discover/decks/commanders')
      .query({ q: 'x'.repeat(41) });
    expect(tooLong.status).toBe(400);
  });
});
