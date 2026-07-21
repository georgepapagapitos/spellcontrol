/**
 * Integration tests for `lookupShareLandingMeta` — the OG/Twitter-tag
 * metadata builder that drives the server-side `/s/:token` landing page.
 * The pure HTML helpers (escape / build / inject) live in `og.test.ts`;
 * this file exercises the DB-bound path for every share kind plus the
 * "resource went missing" 404 case.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import {
  createTestEnv,
  extractSessionCookie,
  setSnapshotViaSyncApi,
  type SnapshotShape,
} from '../test-helpers';
import { lookupPublicDeckLandingMeta, lookupPublicUserLandingMeta } from '../routes/public';
import { shareCache } from './cache';
import { createShareLandingHandler, lookupShareLandingMeta } from './og';

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
  kind: 'collection' | 'binder' | 'deck' | 'list' | 'cube' | 'game-result',
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

/** Insert a canonical game_results row directly (bypassing a live game
 *  session) — this file only needs the row to exist, not to simulate play. */
async function insertGameResult(opts: {
  sessionId: string;
  format?: string;
  winnerSeat?: number | null;
  participants: Array<{ seat: number; userId: string | null; name: string }>;
  notableEvents?: Array<Record<string, unknown>>;
}): Promise<void> {
  const participants = opts.participants.map((p) => ({
    seat: p.seat,
    userId: p.userId,
    username: null,
    name: p.name,
    deckId: null,
    deckName: null,
    commander: null,
    colorIdentity: [],
    finalLife: 40,
    eliminated: false,
  }));
  const winnerSeat = opts.winnerSeat ?? null;
  const winnerUserId =
    winnerSeat != null
      ? (opts.participants.find((p) => p.seat === winnerSeat)?.userId ?? null)
      : null;
  await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_seat, winner_user_id,
        started_at, ended_at, duration_ms, participants, notable_events, created_at)
     VALUES ($1, 'CODE', $2, 40, $3, $4, 1000, 2000, 1000, $5, $6, 2000)`,
    [
      opts.sessionId,
      opts.format ?? 'commander',
      winnerSeat,
      winnerUserId,
      JSON.stringify(participants),
      JSON.stringify(opts.notableEvents ?? []),
    ]
  );
}

function makeLandingDeck(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name: 'Lands Matter',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#7aa6c2',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

/** Registers a user, sets a display name, syncs one deck, and publishes it. */
async function publishLandingDeck(
  username: string,
  deckId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ cookie: string; slug: string }> {
  const cookie = await makeUser(username);
  await setDisplayName(cookie, `${username} display`);
  await setSnapshot(cookie, 0, { decks: [makeLandingDeck(deckId, overrides)] });
  const res = await request(app).post(`/api/publications/decks/${deckId}`).set('Cookie', cookie);
  expect(res.status).toBe(201);
  return { cookie, slug: res.body.publication.slug as string };
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
    // Collections have no single representative card — static fallback only.
    expect(meta!.image).toBeUndefined();
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
    // Commander here has no image_uris at all — must resolve gracefully to
    // undefined, never throw. Locks in the no-crash/no-throw contract.
    expect(meta!.image).toBeUndefined();
  });

  it("uses the commander's art_crop as og:image when present", async () => {
    const cookie = await makeUser('og-deck-art');
    await setSnapshot(cookie, 0, {
      decks: [
        {
          id: 'd-art',
          name: 'Atraxa Superfriends',
          format: 'commander',
          source: 'manual',
          commander: {
            id: 'atraxa',
            name: "Atraxa, Praetors' Voice",
            image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/atraxa.jpg' },
          },
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: [],
          sideboard: [],
          generationContext: null,
          color: '#7aa6c2',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
    });
    const token = await mintShare(cookie, 'deck', 'd-art');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.image).toBe('https://cards.scryfall.io/art_crop/atraxa.jpg');
  });

  it("falls back to the first mainboard card's art for a non-Commander deck with no commander", async () => {
    const cookie = await makeUser('og-deck-nocmd');
    await setSnapshot(cookie, 0, {
      decks: [
        {
          id: 'd-modern',
          name: 'Boros Burn',
          format: 'modern',
          source: 'manual',
          commander: null,
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: [
            {
              slotId: 's1',
              card: {
                id: 'bolt',
                name: 'Lightning Bolt',
                image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/bolt.jpg' },
              },
              allocatedCopyId: null,
            },
          ],
          sideboard: [],
          generationContext: null,
          color: '#c23c3c',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
    });
    const token = await mintShare(cookie, 'deck', 'd-modern');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.image).toBe('https://cards.scryfall.io/art_crop/bolt.jpg');
  });

  it('builds cube metadata with name and card count', async () => {
    const cookie = await makeUser('og-cube');
    await setSnapshot(cookie, 0, {
      cubes: [
        { id: 'cube-1', name: 'Powered Vintage', size: 360, cube: { picks: [] }, savedAt: 1 },
      ],
    });
    const token = await mintShare(cookie, 'cube', 'cube-1');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Powered Vintage — shared by og-cube');
    expect(meta!.description).toContain('A 360-card cube shared by og-cube');
    expect(meta!.image).toBeUndefined();
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
    expect(meta!.image).toBeUndefined();
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
    expect(meta!.image).toBeUndefined();
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

  it('prefers the owner’s display name over username in title and description', async () => {
    const cookie = await makeUser('og-dname');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'OG Display Name' });
    await setSnapshot(cookie, 0, { collection: { cards: [] } });
    const token = await mintShare(cookie, 'collection');
    const meta = await lookupShareLandingMeta(token);
    expect(meta!.title).toBe("OG Display Name's collection — SpellControl");
    expect(meta!.description).toContain('shared by OG Display Name');
  });

  it('builds game-result metadata crediting the winner, with player + notable-moment counts', async () => {
    const cookie = await makeUser('og-gr-winner');
    const userId = await userIdFromCookie(cookie);
    await insertGameResult({
      sessionId: 'og-gr-session-1',
      winnerSeat: 0,
      participants: [
        { seat: 0, userId, name: 'Champ' },
        { seat: 1, userId: null, name: 'Runner-up' },
      ],
      notableEvents: [
        { id: 'e1', ts: 1, kind: 'eliminate', actorSeat: null, targetSeat: 1 },
        { id: 'e2', ts: 2, kind: 'end', actorSeat: null, targetSeat: 0 },
      ],
    });
    const token = await mintShare(cookie, 'game-result', 'og-gr-session-1');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('Champ wins — commander recap');
    expect(meta!.description).toContain('A commander game with 2 players');
    expect(meta!.description).toContain('2 notable moments');
    expect(meta!.description).toContain('Shared by og-gr-winner on SpellControl');
    // No image field on this kind yet (ShareLandingMeta has none on any kind
    // today) — text-only OG, same as every other kind.
    expect(meta!.image).toBeUndefined();
  });

  it('falls back to a winner-less title and omits the notable-moment clause for a declared-draw game', async () => {
    const cookie = await makeUser('og-gr-draw');
    const userId = await userIdFromCookie(cookie);
    await insertGameResult({
      sessionId: 'og-gr-session-2',
      winnerSeat: null,
      participants: [
        { seat: 0, userId, name: 'Alice' },
        { seat: 1, userId: null, name: 'Bob' },
      ],
    });
    const token = await mintShare(cookie, 'game-result', 'og-gr-session-2');
    const meta = await lookupShareLandingMeta(token);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('commander game recap');
    expect(meta!.description).not.toContain('notable moment');
  });

  it('falls back gracefully (null) when the game_results row behind a share token is gone', async () => {
    const cookie = await makeUser('og-gr-missing');
    const userId = await userIdFromCookie(cookie);
    await insertGameResult({
      sessionId: 'og-gr-session-3',
      winnerSeat: 0,
      participants: [{ seat: 0, userId, name: 'Alice' }],
    });
    const token = await mintShare(cookie, 'game-result', 'og-gr-session-3');
    await pool.query(`DELETE FROM game_results WHERE session_id = $1`, ['og-gr-session-3']);
    shareCache.clear();
    const meta = await lookupShareLandingMeta(token);
    expect(meta).toBeNull();
  });
});

describe('lookupPublicDeckLandingMeta', () => {
  it('is indexable, with the og_art_crop column as the image, for a published deck with commander art', async () => {
    const { slug } = await publishLandingDeck('land-deck-art', 'ld-art', {
      commander: {
        id: 'atraxa',
        name: "Atraxa, Praetors' Voice",
        image_uris: {
          normal: 'https://cards.scryfall.io/normal/atraxa.jpg',
          art_crop: 'https://cards.scryfall.io/art_crop/atraxa.jpg',
        },
      },
      cards: [{ slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null }],
    });
    const meta = await lookupPublicDeckLandingMeta(slug);
    expect(meta).not.toBeNull();
    expect(meta!.indexable).toBe(true);
    expect(meta!.image).toBe('https://cards.scryfall.io/art_crop/atraxa.jpg');
    expect(meta!.title).toBe('Lands Matter — commander deck');
    // card_count = 1 (commander) + 1 (mainboard card) = 2, per extractListingFields.
    expect(meta!.description).toContain('2 cards');
    expect(meta!.description).toContain('led by Atraxa');
    expect(meta!.url).toBe(`https://spellcontrol.com/d/${slug}`);
  });

  it('omits the image field (falls back to the static OG image downstream) for a commander-less deck with no art', async () => {
    const { slug } = await publishLandingDeck('land-deck-noart', 'ld-noart');
    const meta = await lookupPublicDeckLandingMeta(slug);
    expect(meta).not.toBeNull();
    expect(meta!.image).toBeUndefined();
    expect(meta!.indexable).toBe(true);
    expect(meta!.description).not.toContain('led by');
  });

  it('returns null for an unpublished slug — same stealth as GET /decks/:slug', async () => {
    const { cookie, slug } = await publishLandingDeck('land-deck-unpub', 'ld-unpub');
    const del = await request(app).delete('/api/publications/decks/ld-unpub').set('Cookie', cookie);
    expect(del.status).toBe(204);
    expect(await lookupPublicDeckLandingMeta(slug)).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await lookupPublicDeckLandingMeta('no-such-slug-at-all')).toBeNull();
  });
});

describe('lookupPublicUserLandingMeta', () => {
  it('is indexable for a user with at least one live publication', async () => {
    await publishLandingDeck('land-user-live', 'lu-live');
    const meta = await lookupPublicUserLandingMeta('land-user-live');
    expect(meta).not.toBeNull();
    expect(meta!.indexable).toBe(true);
    expect(meta!.title).toBe('land-user-live display on SpellControl');
    expect(meta!.url).toBe('https://spellcontrol.com/u/land-user-live');
  });

  it('returns null (Folded blocking fix #2) for a user with zero live publications', async () => {
    await makeUser('land-user-empty');
    expect(await lookupPublicUserLandingMeta('land-user-empty')).toBeNull();
  });

  it('returns null (Folded blocking fix #2) for a moderator-hidden profile even with a live publication', async () => {
    const { cookie } = await publishLandingDeck('land-user-hidden', 'lu-hidden');
    const userId = await userIdFromCookie(cookie);
    await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [userId, Date.now()]);
    expect(await lookupPublicUserLandingMeta('land-user-hidden')).toBeNull();
  });

  it('returns null for an unknown username', async () => {
    expect(await lookupPublicUserLandingMeta('no-such-user-at-all')).toBeNull();
  });
});

describe('route registration order (server.ts contract)', () => {
  it("the /d/:token and /u/:token landing handlers are not shadowed by express.static's SPA fallback", async () => {
    // Mirrors server.ts's exact registration order: the dynamic landing
    // routes registered BEFORE express.static, so a hit is always answered
    // by createShareLandingHandler (which injects noindex/canonical into
    // <head>) rather than falling through to the bare static index.html —
    // the bare shell below deliberately has no such markup, so its presence
    // in the response proves the dynamic handler ran.
    const spaDir = mkdtempSync(path.join(tmpdir(), 'og-spa-shadow-'));
    writeFileSync(
      path.join(spaDir, 'index.html'),
      '<!doctype html><html><head><title>SpellControl</title></head><body></body></html>'
    );
    const miniApp = express();
    miniApp.get('/d/:token', createShareLandingHandler(spaDir, lookupPublicDeckLandingMeta));
    miniApp.get('/u/:token', createShareLandingHandler(spaDir, lookupPublicUserLandingMeta));
    miniApp.use(express.static(spaDir));

    const deckRes = await request(miniApp).get('/d/no-such-slug-at-all');
    expect(deckRes.status).toBe(200);
    expect(deckRes.text).toContain('<meta name="robots" content="noindex,nofollow"');

    const userRes = await request(miniApp).get('/u/no-such-user-at-all');
    expect(userRes.status).toBe(200);
    expect(userRes.text).toContain('<meta name="robots" content="noindex,nofollow"');
  });
});
