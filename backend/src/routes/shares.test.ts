import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  createTestEnv,
  extractSessionCookie,
  setSnapshotViaSyncApi,
  type SnapshotShape,
} from '../test-helpers';

let app: Express;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  app = env.app;
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

/**
 * Replace the user's full sync state. `baseVersion` is accepted for source-
 * compatibility with the old `setSnapshot` signature but is unused — the new
 * sync API has no document-level version. The helper diffs against current
 * server state and translates the blob shape into per-entity upserts + tombstones.
 */
async function setSnapshot(
  cookie: string,
  _baseVersion: number,
  body: SnapshotShape
): Promise<number> {
  return setSnapshotViaSyncApi(request(app), cookie, body);
}

function makeCard(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    copyId: `copy-${Math.random().toString(36).slice(2)}`,
    name: 'Sol Ring',
    scryfallId: 'sol-ring-id',
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '472',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1.5,
    cmc: 1,
    typeLine: 'Artifact',
    importId: 'import-1',
    sourceFormat: 'manabox',
    sourceCategory: 'My Binder',
    ...overrides,
  };
}

describe('POST /api/shares', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await request(app).post('/api/shares').send({ kind: 'collection' });
    expect(res.status).toBe(401);
  });

  it('creates a collection share token', async () => {
    const cookie = await makeUser('share-alice');
    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    expect(res.status).toBe(201);
    expect(res.body.share.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.share.kind).toBe('collection');
  });

  it('is idempotent — re-share returns the same active token', async () => {
    const cookie = await makeUser('share-bob');
    const a = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    const b = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    expect(b.body.share.token).toBe(a.body.share.token);
  });

  it('rejects an unknown kind', async () => {
    const cookie = await makeUser('share-cora');
    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'playmat' });
    expect(res.status).toBe(400);
  });

  it('requires resourceId for non-collection kinds', async () => {
    const cookie = await makeUser('share-dan');
    const res = await request(app).post('/api/shares').set('Cookie', cookie).send({ kind: 'deck' });
    expect(res.status).toBe(400);
  });

  it('creates a binder share token', async () => {
    const cookie = await makeUser('share-binder-create');
    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'binder', resourceId: 'b-1' });
    expect(res.status).toBe(201);
    expect(res.body.share.kind).toBe('binder');
    expect(res.body.share.resourceId).toBe('b-1');
  });

  it('requires resourceId for kind=binder', async () => {
    const cookie = await makeUser('share-binder-noid');
    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'binder' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/shares', () => {
  it('lists only the caller’s active shares', async () => {
    const alice = await makeUser('share-list-alice');
    const bob = await makeUser('share-list-bob');
    await request(app).post('/api/shares').set('Cookie', alice).send({ kind: 'collection' });
    await request(app).post('/api/shares').set('Cookie', bob).send({ kind: 'collection' });
    const res = await request(app).get('/api/shares').set('Cookie', alice);
    expect(res.status).toBe(200);
    expect(res.body.shares).toHaveLength(1);
  });
});

describe('DELETE /api/shares/:token', () => {
  it('revokes an active token', async () => {
    const cookie = await makeUser('share-revoke');
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    const token = create.body.share.token as string;
    const del = await request(app).delete(`/api/shares/${token}`).set('Cookie', cookie);
    expect(del.status).toBe(204);
    const after = await request(app).get(`/api/shares/public/${token}`);
    expect(after.status).toBe(404);
  });

  it('returns 404 when revoking someone else’s token', async () => {
    const alice = await makeUser('share-revoke-alice');
    const mallory = await makeUser('share-revoke-mallory');
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', alice)
      .send({ kind: 'collection' });
    const token = create.body.share.token as string;
    const del = await request(app).delete(`/api/shares/${token}`).set('Cookie', mallory);
    expect(del.status).toBe(404);
  });

  it('re-share after revoke mints a new token', async () => {
    const cookie = await makeUser('share-revoke-then-reshare');
    const a = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    await request(app).delete(`/api/shares/${a.body.share.token}`).set('Cookie', cookie);
    const b = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    expect(b.body.share.token).not.toBe(a.body.share.token);
  });

  it('invalidates the LRU cache so a revoked token 404s immediately', async () => {
    // Warm the cache with a public read first — if revoke didn't invalidate,
    // the next read would still hit the cache and serve the now-revoked
    // share until the TTL expired.
    const cookie = await makeUser('share-revoke-cache');
    await setSnapshot(cookie, 0, { collection: { cards: [makeCard()] } });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    const token = create.body.share.token as string;
    const warm = await request(app).get(`/api/shares/public/${token}`);
    expect(warm.status).toBe(200);
    const del = await request(app).delete(`/api/shares/${token}`).set('Cookie', cookie);
    expect(del.status).toBe(204);
    const after = await request(app).get(`/api/shares/public/${token}`);
    expect(after.status).toBe(404);
  });
});

describe('GET /api/shares/public/:token — collection', () => {
  it('returns the owner’s projected collection, stripping internal fields', async () => {
    const cookie = await makeUser('share-pub-coll');
    await setSnapshot(cookie, 0, {
      collection: {
        fileName: 'export.csv',
        cards: [makeCard({ name: 'Sol Ring' }), makeCard({ name: 'Arcane Signet' })],
        scryfallHits: 2,
        scryfallMisses: 0,
        uploadedAt: 1700000000000,
      },
    });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('collection');
    expect(res.body.data.ownerUsername).toBe('share-pub-coll');
    expect(res.body.data.cards).toHaveLength(2);
    const firstCard = res.body.data.cards[0];
    expect(firstCard.name).toBe('Sol Ring');
    expect(firstCard.importId).toBeUndefined();
    expect(firstCard.sourceFormat).toBeUndefined();
    expect(firstCard.sourceCategory).toBeUndefined();
    expect(firstCard.copyId).toBeUndefined();
  });

  it('returns an empty cards array for a user with no collection', async () => {
    const cookie = await makeUser('share-pub-empty');
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toEqual([]);
  });

  it('404s on unknown tokens', async () => {
    const res = await request(app).get('/api/shares/public/does-not-exist-12345');
    expect(res.status).toBe(404);
  });

  it('does not require authentication', async () => {
    const cookie = await makeUser('share-pub-noauth');
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'collection' });
    const token = create.body.share.token as string;
    // No Cookie header on the public read.
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/shares/public/:token — deck', () => {
  it('projects a single deck by resourceId', async () => {
    const cookie = await makeUser('share-pub-deck');
    const deckId = 'd-1';
    await setSnapshot(cookie, 0, {
      decks: [
        {
          id: deckId,
          name: 'Edric Combo',
          format: 'commander',
          source: 'manual',
          commander: { id: 'edric-id', name: 'Edric' },
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: [
            { slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null },
            {
              slotId: 's2',
              card: { id: 'arcane-signet', name: 'Arcane Signet' },
              allocatedCopyId: null,
            },
          ],
          sideboard: [],
          generationContext: null,
          color: '#7aa6c2',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        {
          id: 'd-2',
          name: 'Other',
          format: 'commander',
          source: 'manual',
          commander: null,
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: [],
          sideboard: [],
          generationContext: null,
          color: '#888',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
    });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'deck', resourceId: deckId });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('deck');
    expect(res.body.data.id).toBe(deckId);
    expect(res.body.data.name).toBe('Edric Combo');
    expect(res.body.data.cards).toHaveLength(2);
    // slotId / allocatedCopyId are owner-side; should not be exposed.
    expect(res.body.data.cards[0].slotId).toBeUndefined();
    expect(res.body.data.cards[0].allocatedCopyId).toBeUndefined();
    // card payload passes through as-is.
    expect(res.body.data.cards[0].card.name).toBe('Sol Ring');
  });

  it('404s when the deck no longer exists in the owner’s data', async () => {
    const cookie = await makeUser('share-pub-deck-missing');
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'deck', resourceId: 'never-existed' });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(404);
  });
});

function makeBinder(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'b-1',
    name: 'Artifacts',
    position: 0,
    filterGroups: [
      { filter: { typeChips: { chips: [{ value: 'artifact', negate: false }], joiners: [] } } },
    ],
    sorts: [{ field: 'color', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#c2a14a',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe('GET /api/shares/public/:token — binder', () => {
  it('materializes a single binder and projects its cards', async () => {
    const cookie = await makeUser('share-pub-binder');
    await setSnapshot(cookie, 0, {
      collection: {
        fileName: 'export.csv',
        cards: [
          makeCard({ name: 'Sol Ring', typeLine: 'Artifact' }),
          makeCard({ name: 'Arcane Signet', typeLine: 'Artifact' }),
          makeCard({ name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid' }),
        ],
        scryfallHits: 3,
        scryfallMisses: 0,
        uploadedAt: 1700000000000,
      },
      binders: [makeBinder()],
    });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'binder', resourceId: 'b-1' });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('binder');
    expect(res.body.data.name).toBe('Artifacts');
    // Only the two artifacts route into the binder; the creature does not.
    expect(res.body.data.totalCards).toBe(2);
    const allCards = res.body.data.sections.flatMap((s: { cards: unknown[] }) => s.cards);
    expect(allCards).toHaveLength(2);
    expect(allCards.map((c: { name: string }) => c.name).sort()).toEqual([
      'Arcane Signet',
      'Sol Ring',
    ]);
    // Internal per-copy fields are stripped.
    expect(allCards[0].copyId).toBeUndefined();
    expect(allCards[0].sourceFormat).toBeUndefined();
  });

  it('404s when the binder id is unknown', async () => {
    const cookie = await makeUser('share-pub-binder-missing');
    await setSnapshot(cookie, 0, { binders: [makeBinder()] });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'binder', resourceId: 'no-such-binder' });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/shares/public/:token — list', () => {
  it('projects a single list and keeps note + targetPrice', async () => {
    const cookie = await makeUser('share-pub-list');
    const listId = 'l-1';
    await setSnapshot(cookie, 0, {
      collection: {
        fileName: 'x.csv',
        cards: [],
        scryfallHits: 0,
        scryfallMisses: 0,
        uploadedAt: 1700000000000,
        lists: [
          {
            id: listId,
            name: 'Wantlist',
            entries: [
              {
                id: 'e1',
                name: 'Mana Crypt',
                scryfallId: 'mana-crypt-id',
                setCode: 'eld',
                collectorNumber: '1',
                finish: 'nonfoil',
                quantity: 1,
                note: 'find at LGS',
                targetPrice: 120,
              },
            ],
            order: 0,
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
      },
    });
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'list', resourceId: listId });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('list');
    expect(res.body.data.name).toBe('Wantlist');
    expect(res.body.data.entries[0].note).toBe('find at LGS');
    expect(res.body.data.entries[0].targetPrice).toBe(120);
  });

  it('404s when the list id is unknown', async () => {
    const cookie = await makeUser('share-pub-list-missing');
    const create = await request(app)
      .post('/api/shares')
      .set('Cookie', cookie)
      .send({ kind: 'list', resourceId: 'no-such-list' });
    const token = create.body.share.token as string;
    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(404);
  });
});
