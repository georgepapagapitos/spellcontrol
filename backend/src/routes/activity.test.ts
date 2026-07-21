import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';

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
/** Guarantees a unique username/id across this whole file — one createTestEnv()
 *  is shared by every test here, so anything not scoped by an exact-match
 *  filter must be collision-proof (mirrors discover.test.ts's own uid()). */
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

/** Make two registered users accepted friends (A requests, B's reverse request auto-accepts). */
async function befriend(
  aCookie: string,
  aName: string,
  bCookie: string,
  bName: string
): Promise<void> {
  await request(app).post('/api/friends/requests').set('Cookie', aCookie).send({ username: bName });
  const auto = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', bCookie)
    .send({ username: aName });
  expect(auto.body.friendStatus).toBe('friends');
}

/** Publishing requires a display name (routes/publications.ts). */
async function setDisplayName(cookie: string, name: string): Promise<void> {
  const res = await request(app)
    .patch('/api/auth/profile')
    .set('Cookie', cookie)
    .send({ displayName: name });
  expect(res.status).toBe(200);
}

function makeDeckJson(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
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
  };
}

/** Registers an owner with one deck and publishes it. */
async function publishDeck(): Promise<{ cookie: string; deckId: string; slug: string }> {
  const deckId = uid('act-deck');
  const cookie = await makeUser(uid('act-owner'));
  await setDisplayName(cookie, uid('Act Display Name'));
  await setSnapshotViaSyncApi(request(app), cookie, {
    decks: [makeDeckJson(deckId, `Deck ${deckId}`)],
  });
  const res = await request(app).post(`/api/publications/decks/${deckId}`).set('Cookie', cookie);
  expect(res.status).toBe(201);
  return { cookie, deckId, slug: res.body.publication.slug as string };
}

async function stampShareTime(token: string, createdAt: number): Promise<void> {
  await pool.query(`UPDATE shares SET created_at = $2 WHERE token = $1`, [token, createdAt]);
}

async function stampFeedbackTime(id: string, createdAt: number): Promise<void> {
  await pool.query(`UPDATE deck_feedback SET created_at = $2 WHERE id = $1`, [id, createdAt]);
}

async function stampLikeTime(userId: string, slug: string, createdAt: number): Promise<void> {
  await pool.query(`UPDATE deck_likes SET created_at = $3 WHERE user_id = $1 AND slug = $2`, [
    userId,
    slug,
    createdAt,
  ]);
}

interface AnyActivityItem {
  type: string;
  [key: string]: unknown;
}

describe('GET /api/activity', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(401);
  });

  it('puts an incoming pending friend request in actionRequired, never in recent', async () => {
    const aliceName = uid('act-fr-alice');
    const bobName = uid('act-fr-bob');
    const alice = await makeUser(aliceName);
    const bob = await makeUser(bobName);
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: bobName });

    const res = await request(app).get('/api/activity').set('Cookie', bob);
    expect(res.status).toBe(200);
    expect(res.body.actionRequired).toHaveLength(1);
    expect(res.body.actionRequired[0].type).toBe('friend_request');
    expect(res.body.actionRequired[0].requesterUsername).toBe(aliceName);
    expect((res.body.recent as AnyActivityItem[]).some((i) => i.type === 'friend_request')).toBe(
      false
    );

    // The sender sees no action-required item — the request is outgoing for them.
    const senderRes = await request(app).get('/api/activity').set('Cookie', alice);
    expect(senderRes.body.actionRequired).toHaveLength(0);
  });

  it('includes a direct share in recent, with sender + resolved label', async () => {
    const ownerName = uid('act-ds-owner');
    const friendName = uid('act-ds-friend');
    const owner = await makeUser(ownerName);
    const friend = await makeUser(friendName);
    await befriend(owner, ownerName, friend, friendName);
    const friendId = await userIdFromCookie(friend);

    const share = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'collection', audience: 'direct', addresseeId: friendId });
    expect(share.status).toBe(201);

    const res = await request(app).get('/api/activity').set('Cookie', friend);
    expect(res.status).toBe(200);
    const item = (res.body.recent as AnyActivityItem[]).find((i) => i.type === 'direct_share');
    expect(item).toBeDefined();
    expect(item!.fromUsername).toBe(ownerName);
    expect(item!.label).toBe('Collection');
    expect(item!.token).toBe(share.body.share.token);
  });

  it('drops a direct share item once its target deck is deleted', async () => {
    const ownerName = uid('act-ds-del-owner');
    const friendName = uid('act-ds-del-friend');
    const owner = await makeUser(ownerName);
    const friend = await makeUser(friendName);
    await befriend(owner, ownerName, friend, friendName);
    const friendId = await userIdFromCookie(friend);
    const deckId = uid('act-ds-del-deck');
    await setSnapshotViaSyncApi(request(app), owner, {
      decks: [makeDeckJson(deckId, 'Doomed Deck')],
    });

    const share = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'deck', resourceId: deckId, audience: 'direct', addresseeId: friendId });
    expect(share.status).toBe(201);

    const before = await request(app).get('/api/activity').set('Cookie', friend);
    expect((before.body.recent as AnyActivityItem[]).some((i) => i.type === 'direct_share')).toBe(
      true
    );

    // Tombstone the deck (delete it from the owner's collection via sync).
    await setSnapshotViaSyncApi(request(app), owner, { decks: [] });

    const after = await request(app).get('/api/activity').set('Cookie', friend);
    expect((after.body.recent as AnyActivityItem[]).some((i) => i.type === 'direct_share')).toBe(
      false
    );
  });

  it('includes a feedback submission in recent, with the target deck name resolved', async () => {
    const ownerName = uid('act-fb-owner');
    const owner = await makeUser(ownerName);
    const deckId = uid('act-fb-deck');
    await setSnapshotViaSyncApi(request(app), owner, {
      decks: [makeDeckJson(deckId, 'Feedback Target Deck')],
    });
    const share = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'feedback', resourceId: deckId });
    expect(share.status).toBe(201);
    const token = share.body.share.token as string;

    const submit = await request(app)
      .post(`/api/feedback/public/${token}`)
      .send({ authorName: 'A Reviewer', comment: 'Great deck!', suggestions: [] });
    expect(submit.status).toBe(201);

    const res = await request(app).get('/api/activity').set('Cookie', owner);
    expect(res.status).toBe(200);
    const item = (res.body.recent as AnyActivityItem[]).find((i) => i.type === 'feedback');
    expect(item).toBeDefined();
    expect(item!.deckId).toBe(deckId);
    expect(item!.deckName).toBe('Feedback Target Deck');
    expect(item!.authorName).toBe('A Reviewer');
    expect(item!.comment).toBe('Great deck!');
  });

  it('drops a feedback item once its target deck is deleted', async () => {
    const ownerName = uid('act-fb-del-owner');
    const owner = await makeUser(ownerName);
    const deckId = uid('act-fb-del-deck');
    await setSnapshotViaSyncApi(request(app), owner, {
      decks: [makeDeckJson(deckId, 'Doomed Feedback Deck')],
    });
    const share = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'feedback', resourceId: deckId });
    const submit = await request(app)
      .post(`/api/feedback/public/${share.body.share.token}`)
      .send({ authorName: 'Reviewer', comment: 'Nice.', suggestions: [] });
    expect(submit.status).toBe(201);

    const before = await request(app).get('/api/activity').set('Cookie', owner);
    expect((before.body.recent as AnyActivityItem[]).some((i) => i.type === 'feedback')).toBe(true);

    await setSnapshotViaSyncApi(request(app), owner, { decks: [] });

    const after = await request(app).get('/api/activity').set('Cookie', owner);
    expect((after.body.recent as AnyActivityItem[]).some((i) => i.type === 'feedback')).toBe(false);
  });

  it('groups likes on the same deck into one item with the correct count', async () => {
    const { cookie: owner, slug } = await publishDeck();
    const likerA = await makeUser(uid('act-like-a'));
    const likerB = await makeUser(uid('act-like-b'));

    expect(
      (await request(app).post(`/api/discover/decks/${slug}/like`).set('Cookie', likerA)).status
    ).toBe(201);
    expect(
      (await request(app).post(`/api/discover/decks/${slug}/like`).set('Cookie', likerB)).status
    ).toBe(201);

    const res = await request(app).get('/api/activity').set('Cookie', owner);
    expect(res.status).toBe(200);
    const item = (res.body.recent as AnyActivityItem[]).find(
      (i) => i.type === 'deck_liked' && i.slug === slug
    );
    expect(item).toBeDefined();
    expect(item!.count).toBe(2);
  });

  it('excludes a like older than 7 days', async () => {
    const { cookie: owner, slug } = await publishDeck();
    const liker = await makeUser(uid('act-like-old'));
    const likerId = await userIdFromCookie(liker);
    expect(
      (await request(app).post(`/api/discover/decks/${slug}/like`).set('Cookie', liker)).status
    ).toBe(201);
    await stampLikeTime(likerId, slug, Date.now() - 8 * 24 * 60 * 60 * 1000);

    const res = await request(app).get('/api/activity').set('Cookie', owner);
    const item = (res.body.recent as AnyActivityItem[]).find(
      (i) => i.type === 'deck_liked' && i.slug === slug
    );
    expect(item).toBeUndefined();
  });

  it('drops a deck_liked item once its deck is unpublished (INNER join, not LEFT)', async () => {
    const { cookie: owner, deckId, slug } = await publishDeck();
    const liker = await makeUser(uid('act-like-unpub'));
    expect(
      (await request(app).post(`/api/discover/decks/${slug}/like`).set('Cookie', liker)).status
    ).toBe(201);

    const before = await request(app).get('/api/activity').set('Cookie', owner);
    expect(
      (before.body.recent as AnyActivityItem[]).some(
        (i) => i.type === 'deck_liked' && i.slug === slug
      )
    ).toBe(true);

    const unpub = await request(app)
      .delete(`/api/publications/decks/${deckId}`)
      .set('Cookie', owner);
    expect(unpub.status).toBe(204);

    const after = await request(app).get('/api/activity').set('Cookie', owner);
    expect(
      (after.body.recent as AnyActivityItem[]).some(
        (i) => i.type === 'deck_liked' && i.slug === slug
      )
    ).toBe(false);
  });

  it('sorts recent items newest-first across interleaved-timestamp sources', async () => {
    const ownerName = uid('act-sort-owner');
    const owner = await makeUser(ownerName);
    const ownerId = await userIdFromCookie(owner);

    // Feedback on owner's own deck.
    const deckId = uid('act-sort-deck');
    await setSnapshotViaSyncApi(request(app), owner, {
      decks: [makeDeckJson(deckId, 'Sort Deck')],
    });
    const fbShare = await request(app)
      .post('/api/shares')
      .set('Cookie', owner)
      .send({ kind: 'feedback', resourceId: deckId });
    const fbSubmit = await request(app)
      .post(`/api/feedback/public/${fbShare.body.share.token}`)
      .send({ authorName: 'Mid Reviewer', comment: 'Solid.', suggestions: [] });
    const feedbackId = fbSubmit.body.feedback.id as string;

    // A friend directs a share TO owner (owner is the addressee, not the sender
    // — a direct share only appears in its recipient's feed).
    const senderName = uid('act-sort-sender');
    const sender = await makeUser(senderName);
    await befriend(owner, ownerName, sender, senderName);
    const dsShare = await request(app)
      .post('/api/shares')
      .set('Cookie', sender)
      .send({ kind: 'collection', audience: 'direct', addresseeId: ownerId });
    const shareToken = dsShare.body.share.token as string;

    // Owner publishes their deck and someone else likes it.
    await setDisplayName(owner, uid('Act Sort Display'));
    const pub = await request(app).post(`/api/publications/decks/${deckId}`).set('Cookie', owner);
    expect(pub.status).toBe(201);
    const slug = pub.body.publication.slug as string;
    const liker = await makeUser(uid('act-sort-liker'));
    const likerId = await userIdFromCookie(liker);
    expect(
      (await request(app).post(`/api/discover/decks/${slug}/like`).set('Cookie', liker)).status
    ).toBe(201);

    // Stamp all three to known, interleaved timestamps: direct share oldest,
    // feedback in the middle, the like newest.
    const base = Date.now() - 1000;
    await stampShareTime(shareToken, base);
    await stampFeedbackTime(feedbackId, base + 500);
    await stampLikeTime(likerId, slug, base + 1000);

    const res = await request(app).get('/api/activity').set('Cookie', owner);
    expect(res.status).toBe(200);
    const types = (res.body.recent as AnyActivityItem[]).map((i) => i.type);
    // Newest first: like (base+1000), feedback (base+500), direct share (base).
    expect(types).toEqual(['deck_liked', 'feedback', 'direct_share']);
  });
});
