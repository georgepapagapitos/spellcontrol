import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';

// Stub only the slug's random suffix so a test can force a real Postgres
// unique-violation on `deck_publications_slug_idx`; the real slugify logic
// (and its own suite in slug.test.ts) stays untouched — this just overrides
// the returned value on demand via mockReturnValueOnce.
const { mockGenerateDeckSlug } = vi.hoisted(() => ({ mockGenerateDeckSlug: vi.fn() }));
vi.mock('../publications/slug', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publications/slug')>();
  mockGenerateDeckSlug.mockImplementation(actual.generateDeckSlug);
  return { ...actual, generateDeckSlug: mockGenerateDeckSlug };
});

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

/** Register a user, return the session cookie. */
async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function setDisplayName(cookie: string, name: string): Promise<void> {
  const res = await request(app)
    .patch('/api/auth/profile')
    .set('Cookie', cookie)
    .send({ displayName: name });
  expect(res.status).toBe(200);
}

async function userIdFromCookie(cookie: string): Promise<string> {
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return me.body.user.id as string;
}

function makeDeck(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: 'Atraxa Superfriends',
    format: 'commander',
    source: 'manual',
    commander: {
      id: 'atraxa',
      name: "Atraxa, Praetors' Voice",
      color_identity: ['W', 'U', 'B', 'G'],
      image_uris: { normal: 'https://cards.scryfall.io/normal/atraxa.jpg' },
    },
    partnerCommander: null,
    cards: [{ slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null }],
    sideboard: [],
    color: '#4B0082',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Seeds a deck row directly, bypassing setSnapshotViaSyncApi/app-level
 *  validation — only for a shape the normal path can't produce (an
 *  empty-name deck). Mirrors friends.test.ts's seedUserDeck. */
async function seedRawDeck(
  userId: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, updated_at)
     VALUES ($1, $2, $3, nextval('user_data_rev_seq'), $4)`,
    [userId, id, JSON.stringify(data), Date.now()]
  );
}

describe('POST /api/publications/decks/:deckId', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await request(app).post('/api/publications/decks/whatever');
    expect(res.status).toBe(401);
  });

  it('publishes a fresh deck when a display name is set', async () => {
    const cookie = await makeUser('pub-fresh');
    await setDisplayName(cookie, 'Fresh Publisher');
    await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck('deck-fresh')] });

    const res = await request(app).post('/api/publications/decks/deck-fresh').set('Cookie', cookie);

    expect(res.status).toBe(201);
    expect(res.body.publication.slug).toMatch(/^atraxa-superfriends-[0-9a-f]{8}$/);
    expect(res.body.publication.url).toBe(
      `https://spellcontrol.com/d/${res.body.publication.slug}`
    );
    expect(res.body.publication.publishedAt).toBe(res.body.publication.updatedAt);
    expect(res.body.publication.unpublishedAt).toBeNull();
    expect(res.body.publication.viewCount).toBe(0);
    expect(res.body.publication.copyCount).toBe(0);
  });

  it('requires a display name before publishing', async () => {
    const cookie = await makeUser('pub-nodisplay');
    await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck('deck-nodisplay')] });

    const res = await request(app)
      .post('/api/publications/decks/deck-nodisplay')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('display_name_required');
    expect(res.body.message).toBe('Set a display name before publishing.');
  });

  it('rejects an empty-name deck seeded via a raw SQL fixture', async () => {
    const cookie = await makeUser('pub-emptyname');
    await setDisplayName(cookie, 'Empty Name Tester');
    const userId = await userIdFromCookie(cookie);
    // The normal sync path never produces an empty deck name; bypass it.
    await seedRawDeck(userId, 'deck-empty-name', { id: 'deck-empty-name', name: '', cards: [] });

    const res = await request(app)
      .post('/api/publications/decks/deck-empty-name')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This deck needs a name before it can be published.');
  });

  it('404s when publishing someone else’s deckId', async () => {
    const owner = await makeUser('pub-owner-404');
    await setDisplayName(owner, 'Owner');
    await setSnapshotViaSyncApi(request(app), owner, { decks: [makeDeck('deck-owned')] });

    const stranger = await makeUser('pub-stranger-404');
    const res = await request(app)
      .post('/api/publications/decks/deck-owned')
      .set('Cookie', stranger);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Deck not found.');
  });

  it('republishes an already-published deck with the same slug and a bumped updatedAt', async () => {
    const cookie = await makeUser('pub-republish');
    await setDisplayName(cookie, 'Republisher');
    await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck('deck-republish')] });

    const first = await request(app)
      .post('/api/publications/decks/deck-republish')
      .set('Cookie', cookie);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/publications/decks/deck-republish')
      .set('Cookie', cookie);
    expect(second.status).toBe(200);
    expect(second.body.publication.slug).toBe(first.body.publication.slug);
    expect(second.body.publication.publishedAt).toBe(first.body.publication.publishedAt);
    expect(second.body.publication.updatedAt).toBeGreaterThanOrEqual(
      first.body.publication.updatedAt
    );
  });

  it('retries slug generation on a forced collision and eventually succeeds', async () => {
    const cookie = await makeUser('pub-collision');
    await setDisplayName(cookie, 'Collision Tester');
    await setSnapshotViaSyncApi(request(app), cookie, {
      decks: [makeDeck('deck-collide-a'), makeDeck('deck-collide-b')],
    });

    mockGenerateDeckSlug.mockReturnValueOnce('forced-collision-slug');
    const first = await request(app)
      .post('/api/publications/decks/deck-collide-a')
      .set('Cookie', cookie);
    expect(first.status).toBe(201);
    expect(first.body.publication.slug).toBe('forced-collision-slug');

    // Next publish's first two slug attempts collide with deck-a's slug; the
    // third call falls through to the real (mocked-passthrough) generator.
    mockGenerateDeckSlug
      .mockReturnValueOnce('forced-collision-slug')
      .mockReturnValueOnce('forced-collision-slug');
    const second = await request(app)
      .post('/api/publications/decks/deck-collide-b')
      .set('Cookie', cookie);
    expect(second.status).toBe(201);
    expect(second.body.publication.slug).not.toBe('forced-collision-slug');
    expect(second.body.publication.slug).toMatch(/-[0-9a-f]{8}$/);
  });

  it('500s if every slug attempt collides', async () => {
    const cookie = await makeUser('pub-exhaust');
    await setDisplayName(cookie, 'Exhaust Tester');
    await setSnapshotViaSyncApi(request(app), cookie, {
      decks: [makeDeck('deck-exhaust-a'), makeDeck('deck-exhaust-b')],
    });

    mockGenerateDeckSlug.mockReturnValueOnce('always-collide-slug');
    const first = await request(app)
      .post('/api/publications/decks/deck-exhaust-a')
      .set('Cookie', cookie);
    expect(first.status).toBe(201);

    mockGenerateDeckSlug
      .mockReturnValueOnce('always-collide-slug')
      .mockReturnValueOnce('always-collide-slug')
      .mockReturnValueOnce('always-collide-slug');
    const second = await request(app)
      .post('/api/publications/decks/deck-exhaust-b')
      .set('Cookie', cookie);
    expect(second.status).toBe(500);
  });
});

describe('DELETE /api/publications/decks/:deckId', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await request(app).delete('/api/publications/decks/whatever');
    expect(res.status).toBe(401);
  });

  it('unpublishes a published deck, and GET then shows unpublishedAt set with the same slug', async () => {
    const cookie = await makeUser('unpub-basic');
    await setDisplayName(cookie, 'Unpublisher');
    await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck('deck-unpub')] });

    const published = await request(app)
      .post('/api/publications/decks/deck-unpub')
      .set('Cookie', cookie);
    expect(published.status).toBe(201);
    const slug = published.body.publication.slug;

    const del = await request(app)
      .delete('/api/publications/decks/deck-unpub')
      .set('Cookie', cookie);
    expect(del.status).toBe(204);

    const status = await request(app)
      .get('/api/publications/decks/deck-unpub')
      .set('Cookie', cookie);
    expect(status.status).toBe(200);
    expect(status.body.publication.slug).toBe(slug);
    expect(status.body.publication.unpublishedAt).not.toBeNull();
  });

  it('404s unpublishing a never-published deck', async () => {
    const cookie = await makeUser('unpub-never');
    await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck('deck-never-pub')] });

    const res = await request(app)
      .delete('/api/publications/decks/deck-never-pub')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('This deck is not published.');
  });

  it('404s (never 403) unpublishing someone else’s published deck', async () => {
    const owner = await makeUser('unpub-owner-404');
    await setDisplayName(owner, 'Owner');
    await setSnapshotViaSyncApi(request(app), owner, { decks: [makeDeck('deck-owned-unpub')] });
    const published = await request(app)
      .post('/api/publications/decks/deck-owned-unpub')
      .set('Cookie', owner);
    expect(published.status).toBe(201);

    const stranger = await makeUser('unpub-stranger-404');
    const res = await request(app)
      .delete('/api/publications/decks/deck-owned-unpub')
      .set('Cookie', stranger);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/publications/decks/:deckId', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await request(app).get('/api/publications/decks/whatever');
    expect(res.status).toBe(401);
  });

  it('returns publication: null for a never-published deck', async () => {
    const cookie = await makeUser('get-never-pub');
    const res = await request(app)
      .get('/api/publications/decks/deck-not-published')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.publication).toBeNull();
  });
});

describe('publish → unpublish → republish cycle', () => {
  it('preserves the slug and counters across the whole cycle', async () => {
    const cookie = await makeUser('cycle-owner');
    await setDisplayName(cookie, 'Cycle Owner');
    await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck('deck-cycle')] });

    const first = await request(app)
      .post('/api/publications/decks/deck-cycle')
      .set('Cookie', cookie);
    expect(first.status).toBe(201);
    const slug = first.body.publication.slug;

    // No endpoint bumps view/copy counts yet (that lands in
    // w0-publish-public-reads) — seed nonzero values directly to prove the
    // republish path leaves them alone.
    await pool.query(
      `UPDATE deck_publications SET view_count = 42, copy_count = 7 WHERE deck_id = $1`,
      ['deck-cycle']
    );

    const unpub = await request(app)
      .delete('/api/publications/decks/deck-cycle')
      .set('Cookie', cookie);
    expect(unpub.status).toBe(204);

    const republish = await request(app)
      .post('/api/publications/decks/deck-cycle')
      .set('Cookie', cookie);
    expect(republish.status).toBe(200);
    expect(republish.body.publication.slug).toBe(slug);
    expect(republish.body.publication.publishedAt).toBe(first.body.publication.publishedAt);
    expect(republish.body.publication.unpublishedAt).toBeNull();
    expect(republish.body.publication.viewCount).toBe(42);
    expect(republish.body.publication.copyCount).toBe(7);
  });
});
