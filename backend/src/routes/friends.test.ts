import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

// ─── POST /api/friends/requests ───────────────────────────────────────────────

describe('POST /api/friends/requests', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).post('/api/friends/requests').send({ username: 'someone' });
    expect(res.status).toBe(401);
  });

  it('sends a friend request → 201 { friendStatus: request_sent }', async () => {
    const alice = await makeUser('fr-send-alice');
    await makeUser('fr-send-bob');
    const res = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-send-bob' });
    expect(res.status).toBe(201);
    expect(res.body.friendStatus).toBe('request_sent');
    expect(res.body.addressee.username).toBe('fr-send-bob');
  });

  it('normalizes the requested username (case-insensitive) → 201', async () => {
    const alice = await makeUser('fr-case-alice');
    await makeUser('fr-case-bob');
    const res = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: '  FR-Case-Bob  ' });
    expect(res.status).toBe(201);
    expect(res.body.addressee.username).toBe('fr-case-bob');
  });

  it('returns 400 when trying to friend yourself', async () => {
    const alice = await makeUser('fr-self');
    const res = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-self' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it('returns 404 for an unknown user', async () => {
    const alice = await makeUser('fr-unknown');
    const res = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'nobody-xyz' });
    expect(res.status).toBe(404);
  });

  it('returns 409 when a request to the same user already exists', async () => {
    const alice = await makeUser('fr-dup-alice');
    await makeUser('fr-dup-bob');
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-dup-bob' });
    const second = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-dup-bob' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already sent/i);
  });

  it('returns 409 when already friends', async () => {
    const alice = await makeUser('fr-already-alice');
    const bob = await makeUser('fr-already-bob');
    // Alice → Bob, then Bob accepts
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-already-bob' });
    // Get alice's id from the response
    const accept = await request(app)
      .post(`/api/friends/requests`)
      .set('Cookie', bob)
      .send({ username: 'fr-already-alice' });
    // This should auto-accept (reverse pending)
    expect(accept.status).toBe(201);
    expect(accept.body.friendStatus).toBe('friends');

    // Now trying again returns 409
    const third = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-already-bob' });
    expect(third.status).toBe(409);
    expect(third.body.error).toMatch(/already friends/i);
  });

  it('auto-accepts when the reverse pending request exists → 201 { friendStatus: friends }', async () => {
    const alice = await makeUser('fr-auto-alice');
    const bob = await makeUser('fr-auto-bob');
    // Alice sends to Bob
    const req1 = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-auto-bob' });
    expect(req1.status).toBe(201);
    expect(req1.body.friendStatus).toBe('request_sent');

    // Bob sends to Alice → auto-accept
    const req2 = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', bob)
      .send({ username: 'fr-auto-alice' });
    expect(req2.status).toBe(201);
    expect(req2.body.friendStatus).toBe('friends');
    expect(req2.body.addressee.username).toBe('fr-auto-alice');
  });
});

// ─── POST /api/friends/requests/:requesterId/accept ──────────────────────────

describe('POST /api/friends/requests/:requesterId/accept', () => {
  it('accepts a pending request → 200 { friend }', async () => {
    const alice = await makeUser('accept-alice');
    const bob = await makeUser('accept-bob');

    // Get alice's user id from a request
    const sent = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'accept-bob' });
    expect(sent.status).toBe(201);

    // Bob gets alice's id from the addressee field in alice's request, but
    // we need Alice's id to accept. Fetch it via /api/users/search
    const search = await request(app).get('/api/users/search?q=accept-alice').set('Cookie', bob);
    expect(search.status).toBe(200);
    const aliceId = search.body.users[0].id as string;

    const accept = await request(app)
      .post(`/api/friends/requests/${aliceId}/accept`)
      .set('Cookie', bob);
    expect(accept.status).toBe(200);
    expect(accept.body.friend.username).toBe('accept-alice');
    expect(typeof accept.body.friend.friendedAt).toBe('number');
  });

  it('returns 404 when the pending row does not exist', async () => {
    const alice = await makeUser('accept-404-alice');
    const res = await request(app)
      .post('/api/friends/requests/nonexistent-user-id/accept')
      .set('Cookie', alice);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/friends/requests/:requesterId/decline ─────────────────────────

describe('POST /api/friends/requests/:requesterId/decline', () => {
  it('declines a pending request → 204 and row is gone', async () => {
    const alice = await makeUser('decline-alice');
    const bob = await makeUser('decline-bob');

    const sent = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'decline-bob' });
    expect(sent.status).toBe(201);

    // Bob declines; needs alice's id
    const search = await request(app).get('/api/users/search?q=decline-alice').set('Cookie', bob);
    const aliceId = search.body.users[0].id as string;

    const decline = await request(app)
      .post(`/api/friends/requests/${aliceId}/decline`)
      .set('Cookie', bob);
    expect(decline.status).toBe(204);

    // No pending rows remain
    const reqs = await request(app).get('/api/friends/requests').set('Cookie', alice);
    expect(reqs.body.outgoing).toHaveLength(0);
  });

  it('returns 404 when the pending row does not exist', async () => {
    const alice = await makeUser('decline-404-alice');
    const res = await request(app)
      .post('/api/friends/requests/nonexistent-user-id/decline')
      .set('Cookie', alice);
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/friends/requests/:addresseeId (cancel outgoing) ─────────────

describe('DELETE /api/friends/requests/:addresseeId', () => {
  it('cancels an outgoing request → 204', async () => {
    const alice = await makeUser('cancel-alice');
    const bob = await makeUser('cancel-bob');

    const sent = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'cancel-bob' });
    expect(sent.status).toBe(201);

    const bobId = sent.body.addressee.id as string;

    const cancel = await request(app).delete(`/api/friends/requests/${bobId}`).set('Cookie', alice);
    expect(cancel.status).toBe(204);

    // Bob sees no incoming requests
    const reqs = await request(app).get('/api/friends/requests').set('Cookie', bob);
    expect(reqs.body.incoming).toHaveLength(0);
  });

  it('returns 404 when no outgoing request exists', async () => {
    const alice = await makeUser('cancel-404-alice');
    const res = await request(app)
      .delete('/api/friends/requests/nonexistent-user-id')
      .set('Cookie', alice);
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/friends/:friendId ────────────────────────────────────────────

describe('DELETE /api/friends/:friendId', () => {
  it('unfriends from the requester side → 204', async () => {
    const alice = await makeUser('unfriend-r-alice');
    const bob = await makeUser('unfriend-r-bob');

    // Alice → Bob, Bob auto-accepts via reverse
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'unfriend-r-bob' });
    // Bob sends to Alice to auto-accept
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', bob)
      .send({ username: 'unfriend-r-alice' });

    const bobId = (
      await request(app).get('/api/users/search?q=unfriend-r-bob').set('Cookie', alice)
    ).body.users[0].id as string;

    const del = await request(app).delete(`/api/friends/${bobId}`).set('Cookie', alice);
    expect(del.status).toBe(204);

    const friends = await request(app).get('/api/friends').set('Cookie', alice);
    expect(friends.body.friends).toHaveLength(0);
  });

  it('unfriends from the addressee side → 204', async () => {
    const alice = await makeUser('unfriend-a-alice');
    const bob = await makeUser('unfriend-a-bob');

    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'unfriend-a-bob' });
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', bob)
      .send({ username: 'unfriend-a-alice' });

    const aliceId = (
      await request(app).get('/api/users/search?q=unfriend-a-alice').set('Cookie', bob)
    ).body.users[0].id as string;

    const del = await request(app).delete(`/api/friends/${aliceId}`).set('Cookie', bob);
    expect(del.status).toBe(204);

    const friends = await request(app).get('/api/friends').set('Cookie', bob);
    expect(friends.body.friends).toHaveLength(0);
  });

  it('returns 404 when the friendship does not exist', async () => {
    const alice = await makeUser('unfriend-404-alice');
    const res = await request(app).delete('/api/friends/nonexistent-user-id').set('Cookie', alice);
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/friends ─────────────────────────────────────────────────────────

describe('GET /api/friends', () => {
  it('returns only accepted friends from both perspectives', async () => {
    const alice = await makeUser('gf-alice');
    const bob = await makeUser('gf-bob');
    const carol = await makeUser('gf-carol');

    // Alice → Bob (pending, not accepted)
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'gf-bob' });

    // Alice ↔ Carol (accepted)
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'gf-carol' });
    // Carol auto-accepts
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', carol)
      .send({ username: 'gf-alice' });

    // Alice's friends = [carol] only
    const aliceFriends = await request(app).get('/api/friends').set('Cookie', alice);
    expect(aliceFriends.status).toBe(200);
    expect(aliceFriends.body.friends).toHaveLength(1);
    expect(aliceFriends.body.friends[0].username).toBe('gf-carol');

    // Carol's friends = [alice]
    const carolFriends = await request(app).get('/api/friends').set('Cookie', carol);
    expect(carolFriends.body.friends).toHaveLength(1);
    expect(carolFriends.body.friends[0].username).toBe('gf-alice');

    // Bob only has pending request, no accepted friends
    const bobFriends = await request(app).get('/api/friends').set('Cookie', bob);
    expect(bobFriends.body.friends).toHaveLength(0);
  });

  it('reports per-friend unique card count (distinct oracleId, excludes deleted, 0 when empty)', async () => {
    const alice = await makeUserFull('gfc-alice');
    const bob = await makeUserFull('gfc-bob');
    await befriend(alice, bob);

    // Bob: 3 rows but only 2 unique oracle ids (Sol Ring duplicated).
    await seedUserCards(bob.id, [
      { name: 'Sol Ring', oracleId: 'o-sol' },
      { name: 'Sol Ring', oracleId: 'o-sol' },
      { name: 'Counterspell', oracleId: 'o-counter' },
    ]);
    // A soft-deleted row must not be counted.
    await pool.query(
      `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, nextval('user_data_rev_seq'), $5, $6)`,
      [
        bob.id,
        `card-${bob.id}-deleted`,
        'import-1',
        JSON.stringify({ name: 'Wrath of God', oracleId: 'o-wrath' }),
        Date.now(),
        Date.now(),
      ]
    );

    const aliceFriends = await request(app).get('/api/friends').set('Cookie', alice.cookie);
    const bobRow = aliceFriends.body.friends.find(
      (f: { username: string }) => f.username === 'gfc-bob'
    );
    expect(bobRow.cardCount).toBe(2);

    // Alice has no cards → 0 (COALESCE), not null/undefined.
    const bobFriends = await request(app).get('/api/friends').set('Cookie', bob.cookie);
    const aliceRow = bobFriends.body.friends.find(
      (f: { username: string }) => f.username === 'gfc-alice'
    );
    expect(aliceRow.cardCount).toBe(0);
  });
});

// ─── GET /api/friends/requests ────────────────────────────────────────────────

describe('GET /api/friends/requests', () => {
  it('splits into incoming and outgoing', async () => {
    const alice = await makeUser('req-split-alice');
    await makeUser('req-split-bob');
    const carol = await makeUser('req-split-carol');

    // Alice → Bob (outgoing from alice)
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'req-split-bob' });

    // Carol → Alice (incoming to alice)
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', carol)
      .send({ username: 'req-split-alice' });

    const reqs = await request(app).get('/api/friends/requests').set('Cookie', alice);
    expect(reqs.status).toBe(200);
    expect(reqs.body.outgoing).toHaveLength(1);
    expect(reqs.body.outgoing[0].addresseeUsername).toBe('req-split-bob');
    expect(reqs.body.incoming).toHaveLength(1);
    expect(reqs.body.incoming[0].requesterUsername).toBe('req-split-carol');
  });

  it('returns empty arrays when no requests exist', async () => {
    const alice = await makeUser('req-empty-alice');
    const reqs = await request(app).get('/api/friends/requests').set('Cookie', alice);
    expect(reqs.status).toBe(200);
    expect(reqs.body.incoming).toEqual([]);
    expect(reqs.body.outgoing).toEqual([]);
  });
});

// ─── GET /api/friends/:friendId/collection ────────────────────────────────────

/** Register user and return { cookie, id, username }. */
async function makeUserFull(
  username: string
): Promise<{ cookie: string; id: string; username: string }> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  const cookie = extractSessionCookie(reg.headers['set-cookie'])!;
  // Get our own id via /api/friends (or auth me) — simpler: look ourselves up via users search
  // Actually use the pool directly for the id
  const row = await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [
    username,
  ]);
  return { cookie, id: row.rows[0].id, username };
}

/** Make two users friends via the mutual-send auto-accept path. */
async function befriend(
  a: { cookie: string; username: string },
  b: { cookie: string; username: string }
): Promise<void> {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', a.cookie)
    .send({ username: b.username });
  const res = await request(app)
    .post('/api/friends/requests')
    .set('Cookie', b.cookie)
    .send({ username: a.username });
  expect(res.status).toBe(201);
  expect(res.body.friendStatus).toBe('friends');
}

/** Seed user_cards rows directly via the pool. */
async function seedUserCards(userId: string, cards: Array<Record<string, unknown>>): Promise<void> {
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    await pool.query(
      `INSERT INTO user_cards (user_id, id, import_id, data, rev, updated_at)
       VALUES ($1, $2, $3, $4, nextval('user_data_rev_seq'), $5)`,
      [userId, `card-${userId}-${i}`, 'import-1', JSON.stringify(card), Date.now()]
    );
  }
}

describe('GET /api/friends/:friendId/collection', () => {
  it('401 — unauthenticated caller', async () => {
    const res = await request(app).get('/api/friends/some-user-id/collection');
    expect(res.status).toBe(401);
  }, 15000);

  it('403 — unknown friendId (indistinguishable from non-friend)', async () => {
    const alice = await makeUserFull('fc-404-alice');
    const res = await request(app)
      .get('/api/friends/nonexistent-user-id/collection')
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not friends/i);
  }, 15000);

  it('403 — no friendship row (strangers)', async () => {
    const alice = await makeUserFull('fc-403-alice');
    const bob = await makeUserFull('fc-403-bob');
    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not friends/i);
  }, 15000);

  it('403 — only a pending request (not accepted)', async () => {
    const alice = await makeUserFull('fc-pend-alice');
    const bob = await makeUserFull('fc-pend-bob');
    // Alice sends a request but Bob does NOT accept
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice.cookie)
      .send({ username: bob.username });
    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not friends/i);
  }, 15000);

  it('403 — self-request', async () => {
    const alice = await makeUserFull('fc-self-alice');
    const res = await request(app)
      .get(`/api/friends/${alice.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
  }, 15000);

  it('200 — empty collection returns { ownerUsername, cards: [] }', async () => {
    const alice = await makeUserFull('fc-empty-alice');
    const bob = await makeUserFull('fc-empty-bob');
    await befriend(alice, bob);
    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.ownerUsername).toBe(bob.username);
    expect(res.body.cards).toEqual([]);
  }, 15000);

  it('200 — dedupes multiple copies of the same oracleId to one card', async () => {
    const alice = await makeUserFull('fc-dedup-alice');
    const bob = await makeUserFull('fc-dedup-bob');
    await befriend(alice, bob);

    // Seed 3 copies of Sol Ring (same oracleId), one card with a different oracleId
    await seedUserCards(bob.id, [
      {
        name: 'Sol Ring',
        oracleId: 'oracle-solring',
        scryfallId: 'sf-solring-1',
        colors: [],
        cmc: 1,
        typeLine: 'Artifact',
      },
      {
        name: 'Sol Ring',
        oracleId: 'oracle-solring',
        scryfallId: 'sf-solring-2',
        colors: [],
        cmc: 1,
        typeLine: 'Artifact',
      },
      {
        name: 'Sol Ring',
        oracleId: 'oracle-solring',
        scryfallId: 'sf-solring-3',
        colors: [],
        cmc: 1,
        typeLine: 'Artifact',
      },
      {
        name: 'Command Tower',
        oracleId: 'oracle-cmdtower',
        scryfallId: 'sf-cmdtower',
        colors: [],
        cmc: 0,
        typeLine: 'Land',
      },
    ]);

    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.ownerUsername).toBe(bob.username);
    expect(res.body.cards).toHaveLength(2);
    const oracleIds = (res.body.cards as Array<{ oracleId: string }>).map((c) => c.oracleId);
    expect(oracleIds).toContain('oracle-solring');
    expect(oracleIds).toContain('oracle-cmdtower');
  }, 15000);

  it('200 — response contains only public fields, no private fields', async () => {
    const alice = await makeUserFull('fc-priv-alice');
    const bob = await makeUserFull('fc-priv-bob');
    await befriend(alice, bob);

    await seedUserCards(bob.id, [
      {
        name: 'Black Lotus',
        oracleId: 'oracle-black-lotus',
        scryfallId: 'sf-black-lotus',
        colors: [],
        cmc: 0,
        typeLine: 'Artifact',
        // private fields that must NOT appear in the response
        condition: 'NM',
        language: 'EN',
        altered: false,
        proxy: false,
        misprint: false,
        purchasePrice: 999.99,
      },
    ]);

    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);

    const card = res.body.cards[0] as Record<string, unknown>;
    // public fields present
    expect(card.name).toBe('Black Lotus');
    expect(card.oracleId).toBe('oracle-black-lotus');
    expect(card.colors).toEqual([]);
    expect(card.cmc).toBe(0);
    expect(card.typeLine).toBe('Artifact');

    // private fields absent
    expect(card).not.toHaveProperty('condition');
    expect(card).not.toHaveProperty('language');
    expect(card).not.toHaveProperty('altered');
    expect(card).not.toHaveProperty('proxy');
    expect(card).not.toHaveProperty('misprint');
    expect(card).not.toHaveProperty('purchasePrice');
    expect(card).not.toHaveProperty('scryfallId');
  }, 15000);

  it('200 — cards with missing/empty oracleId are skipped', async () => {
    const alice = await makeUserFull('fc-nooid-alice');
    const bob = await makeUserFull('fc-nooid-bob');
    await befriend(alice, bob);

    await seedUserCards(bob.id, [
      {
        name: 'Card Without OracleId',
        oracleId: '',
        scryfallId: 'sf-no-oracle',
        colors: [],
        cmc: 2,
        typeLine: 'Creature',
      },
      {
        name: 'Valid Card',
        oracleId: 'oracle-valid',
        scryfallId: 'sf-valid',
        colors: ['W'],
        cmc: 1,
        typeLine: 'Creature — Human',
      },
    ]);

    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].name).toBe('Valid Card');
  }, 15000);
});

// ─── GET /api/friends/:friendId/shares (friend hub) ──────────────────────────

async function seedUserDeck(userId: string, id: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, updated_at)
     VALUES ($1, $2, $3, nextval('user_data_rev_seq'), $4)`,
    [userId, id, JSON.stringify({ id, name }), Date.now()]
  );
}

async function createShare(
  cookie: string,
  body: Record<string, unknown>
): Promise<{ token: string }> {
  const res = await request(app).post('/api/shares').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return { token: res.body.share.token as string };
}

describe('GET /api/friends/:friendId/shares', () => {
  it('rejects an unauthenticated caller (401)', async () => {
    const owner = await makeUserFull('hub-anon-owner');
    const res = await request(app).get(`/api/friends/${owner.id}/shares`);
    expect(res.status).toBe(401);
  });

  it('403s when the caller is not a friend', async () => {
    const owner = await makeUserFull('hub-stranger-owner');
    const stranger = await makeUserFull('hub-stranger');
    const res = await request(app)
      .get(`/api/friends/${owner.id}/shares`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(403);
  });

  it('403s for an unknown user id (indistinguishable from non-friend)', async () => {
    const me = await makeUserFull('hub-unknown-target');
    const res = await request(app)
      .get('/api/friends/nonexistent-id/shares')
      .set('Cookie', me.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not friends/i);
  });

  it('returns a friend’s friends-audience shares with labels, excluding link shares', async () => {
    const owner = await makeUserFull('hub-owner');
    const friend = await makeUserFull('hub-friend');
    await befriend(owner, friend);
    await seedUserDeck(owner.id, 'deck-1', 'Goblin Tribal');

    await createShare(owner.cookie, { kind: 'deck', resourceId: 'deck-1', audience: 'friends' });
    await createShare(owner.cookie, { kind: 'collection', audience: 'friends' });
    // A public link share must NOT surface in the friend hub.
    await createShare(owner.cookie, { kind: 'collection', audience: 'link' });

    const res = await request(app)
      .get(`/api/friends/${owner.id}/shares`)
      .set('Cookie', friend.cookie);
    expect(res.status).toBe(200);
    expect(res.body.ownerUsername).toBe('hub-owner');
    const kinds = (res.body.shares as Array<{ kind: string; label: string }>).map((s) => s.kind);
    expect(kinds).toContain('deck');
    expect(kinds).toContain('collection');
    const deck = res.body.shares.find((s: { kind: string }) => s.kind === 'deck');
    expect(deck.label).toBe('Goblin Tribal');
    const coll = res.body.shares.find((s: { kind: string }) => s.kind === 'collection');
    expect(coll.label).toBe('Collection');
    // Exactly the two friends shares — the link share is filtered out.
    expect(res.body.shares).toHaveLength(2);
  });

  it('drops a friends share whose underlying resource was deleted', async () => {
    const owner = await makeUserFull('hub-deleted-owner');
    const friend = await makeUserFull('hub-deleted-friend');
    await befriend(owner, friend);
    // Friends-audience deck share pointing at a deck that doesn't exist.
    await createShare(owner.cookie, {
      kind: 'deck',
      resourceId: 'ghost-deck',
      audience: 'friends',
    });

    const res = await request(app)
      .get(`/api/friends/${owner.id}/shares`)
      .set('Cookie', friend.cookie);
    expect(res.status).toBe(200);
    expect(res.body.shares).toHaveLength(0);
  });

  it('excludes revoked shares from the hub', async () => {
    const owner = await makeUserFull('hub-revoke-owner');
    const friend = await makeUserFull('hub-revoke-friend');
    await befriend(owner, friend);
    const { token } = await createShare(owner.cookie, { kind: 'collection', audience: 'friends' });
    await request(app).delete(`/api/shares/${token}`).set('Cookie', owner.cookie);

    const res = await request(app)
      .get(`/api/friends/${owner.id}/shares`)
      .set('Cookie', friend.cookie);
    expect(res.status).toBe(200);
    expect(res.body.shares).toHaveLength(0);
  });
});
