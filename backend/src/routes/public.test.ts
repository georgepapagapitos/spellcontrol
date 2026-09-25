import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';
import { deckPublicationCache, publicUserCache } from '../publications/cache';
import { lookupPublicUserLandingMeta } from './public';

import type { ShareLandingMeta, ShareLandingResult } from '../shares/og';

/** Narrows a landing lookup to the metadata case, failing loudly on the
 *  rename-redirect case so a test never silently asserts against `undefined`. */
function asMeta(result: ShareLandingResult | null): ShareLandingMeta {
  if (!result || 'redirectTo' in result) {
    throw new Error(`expected landing meta, got ${JSON.stringify(result)}`);
  }
  return result;
}

let app: Server;
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
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
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
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/atraxa.jpg',
        art_crop: 'https://cards.scryfall.io/art_crop/atraxa.jpg',
      },
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

/** Registers a fresh user, sets a display name, syncs one deck, and
 *  publishes it. Returns everything a test typically needs next. */
async function publishDeck(
  username: string,
  deckId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ cookie: string; userId: string; slug: string }> {
  const cookie = await makeUser(username);
  await setDisplayName(cookie, `${username} display`);
  await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck(deckId, overrides)] });
  const res = await request(app).post(`/api/publications/decks/${deckId}`).set('Cookie', cookie);
  expect(res.status).toBe(201);
  const userId = await userIdFromCookie(cookie);
  return { cookie, userId, slug: res.body.publication.slug as string };
}

describe('GET /api/public/decks/:slug', () => {
  it('returns the full public deck page for a published deck', async () => {
    const { slug } = await publishDeck('pub-deck-full', 'deck-full');
    const res = await request(app).get(`/api/public/decks/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug,
      viewCount: 0,
      copyCount: 0,
    });
    expect(res.body.deck.name).toBe('Atraxa Superfriends');
    expect(res.body.deck.ownerUsername).toBe('pub-deck-full');
    expect(res.body.deck.ownerDisplayName).toBe('pub-deck-full display');
  });

  it('404s for an unknown slug', async () => {
    const res = await request(app).get('/api/public/decks/no-such-slug');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Deck not found.');
  });

  it('404s for an unpublished deck, with the same message as unknown', async () => {
    const { cookie, slug } = await publishDeck('pub-deck-unpub', 'deck-unpub-read');
    const del = await request(app)
      .delete('/api/publications/decks/deck-unpub-read')
      .set('Cookie', cookie);
    expect(del.status).toBe(204);

    const res = await request(app).get(`/api/public/decks/${slug}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Deck not found.');
  });

  it('404s when the deck row was hard-deleted under a live publication row', async () => {
    const { userId, slug } = await publishDeck('pub-deck-orphan', 'deck-orphan');
    // Force the race the spec calls out: the publication row survives its
    // own deck's tombstone. No app path produces this — direct SQL fixture.
    await pool.query(`DELETE FROM user_decks WHERE user_id = $1 AND id = $2`, [
      userId,
      'deck-orphan',
    ]);

    const res = await request(app).get(`/api/public/decks/${slug}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Deck not found.');
  });

  it('never increments view_count on its own, even across repeated warm-cache reads', async () => {
    const { slug } = await publishDeck('pub-deck-noinc', 'deck-noinc');
    await request(app).get(`/api/public/decks/${slug}`);
    await request(app).get(`/api/public/decks/${slug}`);
    const third = await request(app).get(`/api/public/decks/${slug}`);
    expect(third.status).toBe(200);
    const row = await pool.query<{ view_count: number }>(
      `SELECT view_count FROM deck_publications WHERE slug = $1`,
      [slug]
    );
    expect(row.rows[0].view_count).toBe(0);
  });
});

describe('POST /api/public/decks/:slug/view', () => {
  it('increments view_count by 1 per anonymous call', async () => {
    const { slug } = await publishDeck('pub-view-anon', 'deck-view-anon');
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(`/api/public/decks/${slug}/view`);
      expect(res.status).toBe(204);
    }
    const row = await pool.query<{ view_count: number }>(
      `SELECT view_count FROM deck_publications WHERE slug = $1`,
      [slug]
    );
    expect(row.rows[0].view_count).toBe(3);
  });

  it('is a no-op for the authed owner (count unchanged)', async () => {
    const { cookie, slug } = await publishDeck('pub-view-owner', 'deck-view-owner');
    const res = await request(app).post(`/api/public/decks/${slug}/view`).set('Cookie', cookie);
    expect(res.status).toBe(204);
    const row = await pool.query<{ view_count: number }>(
      `SELECT view_count FROM deck_publications WHERE slug = $1`,
      [slug]
    );
    expect(row.rows[0].view_count).toBe(0);
  });

  it('still increments for a signed-in caller who is not the owner', async () => {
    const { slug } = await publishDeck('pub-view-owned2', 'deck-view-owned2');
    const stranger = await makeUser('pub-view-stranger');
    const res = await request(app).post(`/api/public/decks/${slug}/view`).set('Cookie', stranger);
    expect(res.status).toBe(204);
    const row = await pool.query<{ view_count: number }>(
      `SELECT view_count FROM deck_publications WHERE slug = $1`,
      [slug]
    );
    expect(row.rows[0].view_count).toBe(1);
  });

  it('204s an unknown slug with no increment (zero-information beacon)', async () => {
    const res = await request(app).post('/api/public/decks/no-such-slug/view');
    expect(res.status).toBe(204);
  });

  it('204s an unpublished slug with no increment', async () => {
    const { cookie, slug } = await publishDeck('pub-view-unpub', 'deck-view-unpub');
    await request(app).delete('/api/publications/decks/deck-view-unpub').set('Cookie', cookie);

    const res = await request(app).post(`/api/public/decks/${slug}/view`);
    expect(res.status).toBe(204);
    const row = await pool.query<{ view_count: number }>(
      `SELECT view_count FROM deck_publications WHERE slug = $1`,
      [slug]
    );
    expect(row.rows[0].view_count).toBe(0);
  });
});

describe('POST /api/public/decks/:slug/copy', () => {
  it('increments copy_count and returns 204', async () => {
    const { slug } = await publishDeck('pub-copy-ok', 'deck-copy-ok');
    const res = await request(app).post(`/api/public/decks/${slug}/copy`);
    expect(res.status).toBe(204);
    const row = await pool.query<{ copy_count: number }>(
      `SELECT copy_count FROM deck_publications WHERE slug = $1`,
      [slug]
    );
    expect(row.rows[0].copy_count).toBe(1);
  });

  it('404s an unpublished slug (unlike the zero-information view beacon)', async () => {
    const { cookie, slug } = await publishDeck('pub-copy-unpub', 'deck-copy-unpub');
    await request(app).delete('/api/publications/decks/deck-copy-unpub').set('Cookie', cookie);

    const res = await request(app).post(`/api/public/decks/${slug}/copy`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Deck not found.');
  });

  it('404s an unknown slug', async () => {
    const res = await request(app).post('/api/public/decks/no-such-slug/copy');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/users/:username', () => {
  it('returns the profile with its published decks, newest-updated first, art-crop commanderImage', async () => {
    const { cookie } = await publishDeck('pub-profile-a', 'deck-profile-a1');
    await setSnapshotViaSyncApi(request(app), cookie, {
      decks: [makeDeck('deck-profile-a1'), makeDeck('deck-profile-a2', { name: 'Second Deck' })],
    });
    const second = await request(app)
      .post('/api/publications/decks/deck-profile-a2')
      .set('Cookie', cookie);
    expect(second.status).toBe(201);
    // Force a deterministic ordering rather than trusting two Date.now()
    // calls in separate requests to land in different milliseconds.
    await pool.query(
      `UPDATE deck_publications SET updated_at = updated_at + 1000 WHERE deck_id = $1`,
      ['deck-profile-a2']
    );

    const res = await request(app).get('/api/public/users/pub-profile-a');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('pub-profile-a');
    expect(res.body.joinedAt).toBeTypeOf('number');
    expect(res.body.isOwner).toBe(false);
    expect(res.body.moderationHidden).toBe(false);
    expect(res.body.deckCount).toBe(2);
    expect(res.body.decks).toHaveLength(2);
    expect(res.body.decks[0].name).toBe('Second Deck');
    expect(res.body.decks[0].commanderImage).toBe('https://cards.scryfall.io/art_crop/atraxa.jpg');
  });

  it('resolves a profile with no public decks for a stranger: click an author, see their page (T136)', async () => {
    await makeUser('pub-profile-empty');
    const res = await request(app).get('/api/public/users/pub-profile-empty');
    expect(res.status).toBe(200);
    expect(res.body.decks).toEqual([]);
    expect(res.body.isOwner).toBe(false);
  });

  it('200s with an empty decks array for the owner viewing their own 0-deck profile', async () => {
    const cookie = await makeUser('pub-profile-empty-owner');
    const res = await request(app)
      .get('/api/public/users/pub-profile-empty-owner')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.moderationHidden).toBe(false);
    expect(res.body.decks).toEqual([]);
    expect(res.body.deckCount).toBe(0);
  });

  it('200s for the owner viewing their own profile, with isOwner true', async () => {
    const { cookie } = await publishDeck('pub-profile-owner', 'deck-profile-owner');
    const res = await request(app).get('/api/public/users/pub-profile-owner').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.moderationHidden).toBe(false);
    expect(res.body.decks).toHaveLength(1);
  });

  it('shows a stranger only the still-live publications once one of three has been unpublished', async () => {
    const cookie = await makeUser('pub-profile-mixed');
    await setDisplayName(cookie, 'pub-profile-mixed display');
    await setSnapshotViaSyncApi(request(app), cookie, {
      decks: [
        makeDeck('deck-mixed-1'),
        makeDeck('deck-mixed-2', { name: 'Second' }),
        makeDeck('deck-mixed-3', { name: 'Third' }),
      ],
    });
    for (const id of ['deck-mixed-1', 'deck-mixed-2', 'deck-mixed-3']) {
      const res = await request(app).post(`/api/publications/decks/${id}`).set('Cookie', cookie);
      expect(res.status).toBe(201);
    }
    const unpub = await request(app)
      .delete('/api/publications/decks/deck-mixed-3')
      .set('Cookie', cookie);
    expect(unpub.status).toBe(204);

    const res = await request(app).get('/api/public/users/pub-profile-mixed');
    expect(res.status).toBe(200);
    expect(res.body.deckCount).toBe(2);
    expect(res.body.decks).toHaveLength(2);
    expect(res.body.decks.some((d: { name: string }) => d.name === 'Third')).toBe(false);
  });

  it('404s a moderation-hidden profile for a stranger', async () => {
    const { userId } = await publishDeck('pub-profile-hidden', 'deck-hidden-1');
    await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [userId, Date.now()]);

    const res = await request(app).get('/api/public/users/pub-profile-hidden');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found.');
  });

  it('200s a moderation-hidden profile for its own owner, with moderationHidden true and an empty deck list', async () => {
    const { cookie, userId } = await publishDeck('pub-profile-hidden-owner', 'deck-hidden-2');
    await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [userId, Date.now()]);

    const res = await request(app)
      .get('/api/public/users/pub-profile-hidden-owner')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.moderationHidden).toBe(true);
    expect(res.body.decks).toEqual([]);
  });

  it('surfaces the resolved bracket (override beats estimation) through the reused deck-summary mapping', async () => {
    await publishDeck('pub-profile-bracket', 'deck-bracket-1', {
      bracketOverride: 4,
      bracketEstimation: { bracket: 2 },
    });
    const res = await request(app).get('/api/public/users/pub-profile-bracket');
    expect(res.status).toBe(200);
    expect(res.body.decks[0].bracket).toBe(4);
    // The raw estimate rides alongside the stated bracket — a stated number
    // never hides what the deck actually estimates at (2026-09-24 ruling).
    expect(res.body.decks[0].estimatedBracket).toBe(2);
  });

  it('404s an unknown username', async () => {
    const res = await request(app).get('/api/public/users/no-such-user');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found.');
  });

  it('404s a malformed username', async () => {
    const res = await request(app).get('/api/public/users/a');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found.');
  });

  it('caps the decks list at 200 while deckCount reflects the true total', async () => {
    const cookie = await makeUser('pub-profile-cap');
    const userId = await userIdFromCookie(cookie);
    await pool.query(
      `INSERT INTO deck_publications
         (user_id, deck_id, slug, deck_name, format, color_identity, published_at, updated_at)
       SELECT $1, 'deck-' || g, 'slug-cap-' || g, 'Deck ' || g, 'commander', '[]'::jsonb,
              g::bigint, g::bigint
         FROM generate_series(1, 201) AS g`,
      [userId]
    );

    const res = await request(app).get('/api/public/users/pub-profile-cap');
    expect(res.status).toBe(200);
    expect(res.body.deckCount).toBe(201);
    expect(res.body.decks).toHaveLength(200);
    // updated_at DESC: deck 201 is newest and present; deck 1 (oldest) is the
    // one truncated away by the 200 cap.
    expect(res.body.decks[0].slug).toBe('slug-cap-201');
    expect(res.body.decks.some((d: { slug: string }) => d.slug === 'slug-cap-1')).toBe(false);
  });
});

describe('cache warm state (sanity for the invalidation tests in publications.test.ts)', () => {
  it('populates deckPublicationCache and publicUserCache on a successful read', async () => {
    const { slug } = await publishDeck('pub-cache-sanity', 'deck-cache-sanity');
    expect(deckPublicationCache.get(slug)).toBeNull();
    await request(app).get(`/api/public/decks/${slug}`);
    expect(deckPublicationCache.get(slug)).not.toBeNull();

    expect(publicUserCache.get('pub-cache-sanity')).toBeNull();
    await request(app).get('/api/public/users/pub-cache-sanity');
    expect(publicUserCache.get('pub-cache-sanity')).not.toBeNull();
  });
});

describe('lookupPublicUserLandingMeta', () => {
  // Playtest batch 11: /u/TradePal served a canonical of .../u/TradePal while
  // /u/tradepal served .../u/tradepal — two canonical URLs for one profile.
  it('emits the normalized handle as the canonical URL whatever case the visitor typed', async () => {
    await publishDeck('landingcase', 'deck-landing-case');
    const meta = asMeta(await lookupPublicUserLandingMeta('LandingCase'));
    expect(meta.url).toBe('https://spellcontrol.com/u/landingcase');
    expect(meta.indexable).toBe(true);
  });

  it('is null for a user with nothing live (noindex, matching the JSON 404)', async () => {
    const cookie = await makeUser('landingquiet');
    await setDisplayName(cookie, 'Quiet');
    expect(await lookupPublicUserLandingMeta('LandingQuiet')).toBeNull();
  });
});

describe('a released handle keeps pointing at the account that had it', () => {
  async function rename(cookie: string, username: string): Promise<void> {
    const res = await request(app)
      .patch('/api/auth/me/username')
      .set('Cookie', cookie)
      .send({ username });
    expect(res.status).toBe(200);
  }

  it('answers the old handle with a 404 carrying the new one, so the SPA can correct its URL', async () => {
    const { cookie } = await publishDeck('renameold', 'deck-rename-1');
    await rename(cookie, 'renamenew');

    const res = await request(app).get('/api/public/users/renameold');

    // A 3xx would be followed transparently by fetch() and the client would
    // never learn to replace the address it is showing.
    expect(res.status).toBe(404);
    expect(res.body.renamedTo).toBe('renamenew');

    const moved = await request(app).get('/api/public/users/renamenew');
    expect(moved.status).toBe(200);
  });

  it('301s the crawlable landing URL to the handle the account has now', async () => {
    const { cookie } = await publishDeck('landoldname', 'deck-rename-2');
    await rename(cookie, 'landnewname');

    expect(await lookupPublicUserLandingMeta('landoldname')).toEqual({
      redirectTo: '/u/landnewname',
    });
  });

  it('follows a chain of renames rather than stopping at the first hop', async () => {
    const { cookie } = await publishDeck('chainone', 'deck-rename-3');
    await rename(cookie, 'chaintwo');
    // The cooldown is a product rule, not the thing under test here.
    await pool.query('UPDATE users SET username_changed_at = NULL WHERE username = $1', [
      'chaintwo',
    ]);
    const second = await request(app)
      .patch('/api/auth/me/username')
      .set('Cookie', cookie)
      .send({ username: 'chainthree' });
    expect(second.status).toBe(200);

    const res = await request(app).get('/api/public/users/chainone');
    expect(res.body.renamedTo).toBe('chainthree');
  });

  it('stops redirecting once somebody else holds the handle', async () => {
    const { cookie } = await publishDeck('handedover', 'deck-rename-4');
    await rename(cookie, 'movedalong');
    // Age the reserve out so the handle is genuinely on the market.
    await pool.query('UPDATE username_history SET reserved_until = $1 WHERE username = $2', [
      Date.now() - 1000,
      'handedover',
    ]);
    const { cookie: other } = await publishDeck('newcomer', 'deck-rename-5');
    await rename(other, 'handedover');

    // The old owner's redirect must NOT survive: it would send visitors to
    // the wrong person's profile.
    const res = await request(app).get('/api/public/users/handedover');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('handedover');
    expect(res.body.renamedTo).toBeUndefined();
  });

  it('leaves a handle that was never released alone', async () => {
    await publishDeck('neverrenamed', 'deck-rename-6');
    const res = await request(app).get('/api/public/users/doesnotexist');
    expect(res.status).toBe(404);
    expect(res.body.renamedTo).toBeUndefined();
    expect(await lookupPublicUserLandingMeta('doesnotexist')).toBeNull();
  });
});

describe('a profile Collection tab (T136)', () => {
  function card(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      copyId: `copy-${Math.random().toString(36).slice(2)}`,
      name: 'Sol Ring',
      scryfallId: 'sol-ring-id',
      setCode: 'cmr',
      collectorNumber: '472',
      rarity: 'uncommon',
      finish: 'nonfoil',
      foil: false,
      purchasePrice: 1.5,
      cmc: 1,
      typeLine: 'Artifact',
      importId: 'import-1',
      ...overrides,
    };
  }
  async function owner(username: string, visibility: string | null) {
    const cookie = await makeUser(username);
    await setSnapshotViaSyncApi(request(app), cookie, {
      collection: { cards: [card(), card({ name: 'Rhystic Study', scryfallId: 'rhystic-id' })] },
    });
    const id = await userIdFromCookie(cookie);
    await pool.query(`UPDATE users SET collection_visibility = $2 WHERE id = $1`, [id, visibility]);
    return cookie;
  }
  async function befriend(a: string, aName: string, b: string, bName: string) {
    await request(app).post('/api/friends/requests').set('Cookie', a).send({ username: bName });
    const r = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', b)
      .send({ username: aName });
    expect(r.body.friendStatus).toBe('friends');
  }
  const collection = (username: string, cookie?: string) => {
    const r = request(app).get(`/api/public/users/${username}/collection`);
    return cookie ? r.set('Cookie', cookie) : r;
  };

  it('a new account starts public: anyone sees every copy, with printing and finish', async () => {
    await makeUser('coll-new');
    const cookie = await makeUser('coll-new-owner');
    await setSnapshotViaSyncApi(request(app), cookie, { collection: { cards: [card(), card()] } });
    const res = await collection('coll-new-owner');
    expect(res.status).toBe(200);
    expect(res.body.ownerUsername).toBe('coll-new-owner');
    expect(res.body.cards).toHaveLength(2);
    expect(res.body.cards[0]).toMatchObject({
      name: 'Sol Ring',
      setCode: 'cmr',
      finish: 'nonfoil',
    });
    const profile = await request(app).get('/api/public/users/coll-new-owner');
    expect(profile.body.collection).toEqual({ visibility: 'public', canView: true });
  });

  it('friends-only opens for a friend, not a stranger or a guest', async () => {
    const o = await owner('coll-fr-owner', 'friends');
    const friend = await makeUser('coll-fr-friend');
    const stranger = await makeUser('coll-fr-stranger');
    await befriend(o, 'coll-fr-owner', friend, 'coll-fr-friend');
    expect((await collection('coll-fr-owner', friend)).status).toBe(200);
    expect((await collection('coll-fr-owner', stranger)).status).toBe(404);
    expect((await collection('coll-fr-owner')).status).toBe(404);
    const asFriend = await request(app)
      .get('/api/public/users/coll-fr-owner')
      .set('Cookie', friend);
    expect(asFriend.body.collection.canView).toBe(true);
  });

  it('private opens for its owner only, and answers everyone else like a missing page', async () => {
    const o = await owner('coll-priv-owner', 'private');
    const friend = await makeUser('coll-priv-friend');
    await befriend(o, 'coll-priv-owner', friend, 'coll-priv-friend');
    const asFriend = await collection('coll-priv-owner', friend);
    expect(asFriend.status).toBe(404);
    expect(asFriend.body.error).toBe('User not found.');
    expect((await collection('coll-priv-owner', o)).status).toBe(200);
  });

  it('an account that never chose keeps its old promise: no quantities or prices, even to a friend', async () => {
    const o = await owner('coll-null-owner', null);
    const friend = await makeUser('coll-null-friend');
    await befriend(o, 'coll-null-owner', friend, 'coll-null-friend');
    expect((await collection('coll-null-owner', friend)).status).toBe(404);
    const profile = await request(app)
      .get('/api/public/users/coll-null-owner')
      .set('Cookie', friend);
    expect(profile.body.collection).toEqual({ visibility: null, canView: false });
  });

  it('a moderator-hidden account shows its collection to nobody else', async () => {
    const o = await owner('coll-hidden-owner', 'public');
    await pool.query(`UPDATE users SET profile_hidden_at = 1 WHERE id = $1`, [
      await userIdFromCookie(o),
    ]);
    expect((await collection('coll-hidden-owner')).status).toBe(404);
  });
});
