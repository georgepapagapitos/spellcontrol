/**
 * Integration tests for `lookupShareLandingMeta` — the OG/Twitter-tag
 * metadata builder that drives the server-side `/s/:token` landing page.
 * The pure HTML helpers (escape / build / inject) live in `og.test.ts`;
 * this file exercises the DB-bound path for every share kind plus the
 * "resource went missing" 404 case.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  createTestEnv,
  extractSessionCookie,
  setSnapshotViaSyncApi,
  type SnapshotShape,
} from '../test-helpers';
import { shareCache } from './cache';
import { lookupShareLandingMeta } from './og';

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

// Cache is a process-global singleton — clear before each test so a hit
// from a previous test (or the route's own warmups) can't shadow the path
// we want to exercise.
beforeEach(() => {
  shareCache.clear();
});

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function setSnapshot(
  cookie: string,
  _baseVersion: number,
  body: SnapshotShape
): Promise<number> {
  return setSnapshotViaSyncApi(request(app), cookie, body);
}

async function mintShare(
  cookie: string,
  kind: 'collection' | 'binder' | 'deck' | 'list',
  resourceId?: string
): Promise<string> {
  const body: Record<string, unknown> = { kind };
  if (resourceId) body.resourceId = resourceId;
  const res = await request(app).post('/api/shares').set('Cookie', cookie).send(body);
  expect(res.status).toBeLessThan(300);
  return res.body.share.token as string;
}

function makeCard(name: string): Record<string, unknown> {
  return {
    copyId: `copy-${Math.random().toString(36).slice(2)}`,
    name,
    scryfallId: `${name.toLowerCase().replace(/\s+/g, '-')}-id`,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1.0,
    cmc: 1,
    typeLine: 'Artifact',
    importId: 'import-1',
    sourceFormat: 'manabox',
  };
}

describe('lookupShareLandingMeta', () => {
  it('returns null for unknown tokens', async () => {
    const meta = await lookupShareLandingMeta('definitely-not-a-real-token-xyz');
    expect(meta).toBeNull();
  });

  it('builds collection metadata with card count and owner username', async () => {
    const cookie = await makeUser('og-coll');
    await setSnapshot(cookie, 0, {
      collection: { cards: [makeCard('Sol Ring'), makeCard('Arcane Signet')] },
    });
    const token = await mintShare(cookie, 'collection');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe("og-coll's collection — SpellControl");
    expect(meta!.description).toContain('2 cards shared by og-coll');
    expect(meta!.url).toBe(`https://spellcontrol.com/s/${token}`);
  });

  it('handles an empty collection (zero cards) with pluralization', async () => {
    const cookie = await makeUser('og-coll-empty');
    await setSnapshot(cookie, 0, { collection: { cards: [] } });
    const token = await mintShare(cookie, 'collection');
    const meta = await lookupShareLandingMeta(token);
    expect(meta!.description).toContain('0 cards shared by og-coll-empty');
  });

  it('singularizes when a collection has exactly one card', async () => {
    const cookie = await makeUser('og-coll-one');
    await setSnapshot(cookie, 0, { collection: { cards: [makeCard('Sol Ring')] } });
    const token = await mintShare(cookie, 'collection');
    const meta = await lookupShareLandingMeta(token);
    expect(meta!.description).toContain('1 card shared by og-coll-one');
    // Defensive: not "1 cards"
    expect(meta!.description).not.toContain('1 cards');
  });

  it('builds deck metadata with format and card count', async () => {
    const cookie = await makeUser('og-deck');
    await setSnapshot(cookie, 0, {
      decks: [
        {
          id: 'd-1',
          name: 'Edric Combo',
          format: 'commander',
          source: 'manual',
          commander: { id: 'edric', name: 'Edric' },
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: [
            { slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null },
            { slotId: 's2', card: { id: 'signet', name: 'Arcane Signet' }, allocatedCopyId: null },
          ],
          sideboard: [],
          generationContext: null,
          color: '#7aa6c2',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
    });
    const token = await mintShare(cookie, 'deck', 'd-1');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Edric Combo — shared by og-deck');
    expect(meta!.description).toContain('A commander deck (2 cards)');
    expect(meta!.description).toContain('shared by og-deck');
  });

  it('returns null when the deck behind a share token was deleted', async () => {
    const cookie = await makeUser('og-deck-missing');
    const version = await setSnapshot(cookie, 0, {
      decks: [
        {
          id: 'd-gone',
          name: 'Doomed Deck',
          format: 'commander',
          source: 'manual',
          commander: null,
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: [],
          sideboard: [],
          generationContext: null,
          color: '#000000',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const token = await mintShare(cookie, 'deck', 'd-gone');
    // Owner deletes the deck out from under the share.
    await setSnapshot(cookie, version, { decks: [] });
    shareCache.clear();
    const meta = await lookupShareLandingMeta(token);
    expect(meta).toBeNull();
  });

  it('builds list metadata with entry count', async () => {
    const cookie = await makeUser('og-list');
    await setSnapshot(cookie, 0, {
      collection: {
        cards: [],
        lists: [
          {
            id: 'l-1',
            name: 'Wishlist',
            entries: [
              {
                id: 'e1',
                name: 'Force of Will',
                scryfallId: 'fow-id',
                setCode: 'all',
                collectorNumber: '1',
                finish: 'nonfoil',
                quantity: 1,
              },
              {
                id: 'e2',
                name: 'Mana Drain',
                scryfallId: 'md-id',
                setCode: 'leg',
                collectorNumber: '1',
                finish: 'nonfoil',
                quantity: 1,
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });
    const token = await mintShare(cookie, 'list', 'l-1');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Wishlist — shared by og-list');
    expect(meta!.description).toContain('A list (2 entries)');
  });

  it('returns null for a list whose id no longer exists', async () => {
    const cookie = await makeUser('og-list-missing');
    const version = await setSnapshot(cookie, 0, {
      collection: {
        cards: [],
        lists: [
          {
            id: 'l-gone',
            name: 'Doomed List',
            entries: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });
    const token = await mintShare(cookie, 'list', 'l-gone');
    await setSnapshot(cookie, version, { collection: { cards: [], lists: [] } });
    shareCache.clear();
    const meta = await lookupShareLandingMeta(token);
    expect(meta).toBeNull();
  });

  it('builds binder metadata with the binder name', async () => {
    const cookie = await makeUser('og-binder');
    await setSnapshot(cookie, 0, {
      binders: [
        {
          id: 'b-1',
          name: 'Commander Staples',
          color: '#7aa6c2',
          rules: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const token = await mintShare(cookie, 'binder', 'b-1');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Commander Staples — shared by og-binder');
    expect(meta!.description).toContain('A binder shared by og-binder');
  });

  it('returns null for a binder whose id no longer exists', async () => {
    const cookie = await makeUser('og-binder-missing');
    const version = await setSnapshot(cookie, 0, {
      binders: [
        {
          id: 'b-gone',
          name: 'Doomed Binder',
          color: '#000000',
          rules: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const token = await mintShare(cookie, 'binder', 'b-gone');
    await setSnapshot(cookie, version, { binders: [] });
    shareCache.clear();
    const meta = await lookupShareLandingMeta(token);
    expect(meta).toBeNull();
  });
});
