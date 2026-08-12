import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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

// The status assertions below carry the response body: a bare
// "expected 400 to be 201" from a registration helper is undiagnosable after
// the fact, and this file hit exactly that as an intermittent failure. Whatever
// the server objected to now travels with the failure.
async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status, `register(${username}) → ${JSON.stringify(reg.body)}`).toBe(201);
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
    expect(res.body.addressee.displayName).toBeNull();
  });

  it('includes the addressee’s display name when set', async () => {
    const alice = await makeUser('fr-dname-alice');
    const bob = await makeUser('fr-dname-bob');
    await request(app).patch('/api/auth/profile').set('Cookie', bob).send({ displayName: 'Bobby' });
    const res = await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'fr-dname-bob' });
    expect(res.status).toBe(201);
    expect(res.body.addressee.displayName).toBe('Bobby');
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

  it('concurrent mutual requests never leave two rows for the pair (E69)', async () => {
    // A→B and B→A fired together: whatever the interleaving, the pair-unique
    // index guarantees a single friendships row, and the 23505 fallback in the
    // route resolves the loser's insert instead of erroring. Run a few rounds
    // to give the race a chance to actually interleave.
    for (let round = 0; round < 3; round++) {
      const a = await makeUser(`fr-race-a-${round}`);
      const b = await makeUser(`fr-race-b-${round}`);
      const [ra, rb] = await Promise.all([
        request(app)
          .post('/api/friends/requests')
          .set('Cookie', a)
          .send({ username: `fr-race-b-${round}` }),
        request(app)
          .post('/api/friends/requests')
          .set('Cookie', b)
          .send({ username: `fr-race-a-${round}` }),
      ]);
      // Both callers get a non-error outcome (201 sent/friends, or 409 dup).
      for (const r of [ra, rb]) {
        expect([201, 409]).toContain(r.status);
      }
      const idRows = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE username = ANY($1::text[])`,
        [[`fr-race-a-${round}`, `fr-race-b-${round}`]]
      );
      const ids = idRows.rows.map((r) => r.id);
      const pair = await pool.query<{ status: string }>(
        `SELECT status FROM friendships
         WHERE requester_id = ANY($1::text[]) AND addressee_id = ANY($1::text[])`,
        [ids]
      );
      // The invariant the old code violated: exactly one row, never two.
      expect(pair.rows.length).toBe(1);
      // Mutual sends resolve to accepted or a single pending — never stuck double-pending.
      expect(['pending', 'accepted']).toContain(pair.rows[0].status);
    }
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

    expect(search.body.users[0].displayName).toBeNull();

    const accept = await request(app)
      .post(`/api/friends/requests/${aliceId}/accept`)
      .set('Cookie', bob);
    expect(accept.status).toBe(200);
    expect(accept.body.friend.username).toBe('accept-alice');
    expect(accept.body.friend.displayName).toBeNull();
    expect(typeof accept.body.friend.friendedAt).toBe('number');
  });

  it('prefers the requester’s display name when set', async () => {
    const alice = await makeUser('accept-dn-alice');
    const bob = await makeUser('accept-dn-bob');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', alice)
      .send({ displayName: 'Alice A.' });
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'accept-dn-bob' });
    const search = await request(app).get('/api/users/search?q=accept-dn-alice').set('Cookie', bob);
    const aliceId = search.body.users[0].id as string;
    expect(search.body.users[0].displayName).toBe('Alice A.');

    const accept = await request(app)
      .post(`/api/friends/requests/${aliceId}/accept`)
      .set('Cookie', bob);
    expect(accept.body.friend.displayName).toBe('Alice A.');
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
    expect(aliceFriends.body.friends[0].displayName).toBeNull();

    // Carol's friends = [alice]
    const carolFriends = await request(app).get('/api/friends').set('Cookie', carol);
    expect(carolFriends.body.friends).toHaveLength(1);
    expect(carolFriends.body.friends[0].username).toBe('gf-alice');

    // Bob only has pending request, no accepted friends
    const bobFriends = await request(app).get('/api/friends').set('Cookie', bob);
    expect(bobFriends.body.friends).toHaveLength(0);
  });

  it('prefers a friend’s display name when set', async () => {
    const alice = await makeUser('gf-dn-alice');
    const carol = await makeUser('gf-dn-carol');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', carol)
      .send({ displayName: 'Carol C.' });
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice)
      .send({ username: 'gf-dn-carol' });
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', carol)
      .send({ username: 'gf-dn-alice' });

    const aliceFriends = await request(app).get('/api/friends').set('Cookie', alice);
    expect(aliceFriends.body.friends[0].displayName).toBe('Carol C.');
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
    expect(reqs.body.outgoing[0].addresseeDisplayName).toBeNull();
    expect(reqs.body.incoming).toHaveLength(1);
    expect(reqs.body.incoming[0].requesterUsername).toBe('req-split-carol');
    expect(reqs.body.incoming[0].requesterDisplayName).toBeNull();
  });

  it('prefers a display name over username on both sides of a request', async () => {
    const alice = await makeUser('req-dn-alice');
    const carol = await makeUser('req-dn-carol');
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', carol)
      .send({ displayName: 'Carol C.' });
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', carol)
      .send({ username: 'req-dn-alice' });

    const reqs = await request(app).get('/api/friends/requests').set('Cookie', alice);
    expect(reqs.body.incoming[0].requesterDisplayName).toBe('Carol C.');
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
  expect(reg.status, `register(${username}) → ${JSON.stringify(reg.body)}`).toBe(201);
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
    expect(res.body.ownerDisplayName).toBeNull();
    expect(res.body.cards).toEqual([]);
  }, 15000);

  it('200 — prefers the friend’s display name when set', async () => {
    const alice = await makeUserFull('fc-dn-alice');
    const bob = await makeUserFull('fc-dn-bob');
    await befriend(alice, bob);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', bob.cookie)
      .send({ displayName: 'Bobby' });
    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.body.ownerDisplayName).toBe('Bobby');
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

  it('200 — projects colorIdentity and rarity for client-side ci:/r: search', async () => {
    // E237: without colorIdentity on the wire the client matcher reads the
    // absent value as the EMPTY set, and an empty set is a subset of every
    // needle — so `ci<=…` matched the entire collection. Both fields are a
    // handful of bytes and are already public card facts.
    const alice = await makeUserFull('fc-ci-alice');
    const bob = await makeUserFull('fc-ci-bob');
    await befriend(alice, bob);

    await seedUserCards(bob.id, [
      {
        name: 'Llanowar Elves',
        oracleId: 'oracle-llanowar',
        scryfallId: 'sf-llanowar',
        colors: ['G'],
        colorIdentity: ['G'],
        cmc: 1,
        typeLine: 'Creature — Elf Druid',
        rarity: 'common',
      },
    ]);

    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].colorIdentity).toEqual(['G']);
    expect(res.body.cards[0].rarity).toBe('common');
  }, 15000);

  it('200 — colorIdentity is [] (not missing) when the stored row lacks it', async () => {
    // The client distinguishes absent (fall back to `colors`) from empty
    // (genuinely colourless), so the wire shape must stay stable.
    const alice = await makeUserFull('fc-ci2-alice');
    const bob = await makeUserFull('fc-ci2-bob');
    await befriend(alice, bob);

    await seedUserCards(bob.id, [
      { name: 'Sol Ring', oracleId: 'oracle-sol', colors: [], cmc: 1, typeLine: 'Artifact' },
    ]);

    const res = await request(app)
      .get(`/api/friends/${bob.id}/collection`)
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.cards[0].colorIdentity).toEqual([]);
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

// ─── GET /api/friends/:friendId/wants ────────────────────────────────────────

/** Seed a user_lists row directly via the pool. `data` is the ListDef JSONB the
 *  sync layer stores verbatim, so these fixtures are the real client shape. */
async function seedUserList(
  userId: string,
  id: string,
  list: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO user_lists (user_id, id, data, rev, updated_at)
     VALUES ($1, $2, $3, nextval('user_data_rev_seq'), $4)`,
    [userId, id, JSON.stringify({ id, ...list }), Date.now()]
  );
}

describe('GET /api/friends/:friendId/wants', () => {
  it('401 — unauthenticated caller', async () => {
    const res = await request(app).get('/api/friends/some-user-id/wants');
    expect(res.status).toBe(401);
  }, 15000);

  it('403 — unknown friendId (indistinguishable from non-friend)', async () => {
    const alice = await makeUserFull('fw-404-alice');
    const res = await request(app)
      .get('/api/friends/nonexistent-user-id/wants')
      .set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not friends/i);
  }, 15000);

  it('403 — no friendship row (strangers), even with wants seeded', async () => {
    const alice = await makeUserFull('fw-403-alice');
    const bob = await makeUserFull('fw-403-bob');
    await seedUserList(bob.id, 'l1', {
      name: 'Wants',
      entries: [{ name: 'Sol Ring', oracleId: 'oracle-solring', quantity: 1 }],
    });
    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not friends/i);
  }, 15000);

  it('403 — only a pending request (not accepted)', async () => {
    const alice = await makeUserFull('fw-pend-alice');
    const bob = await makeUserFull('fw-pend-bob');
    await request(app)
      .post('/api/friends/requests')
      .set('Cookie', alice.cookie)
      .send({ username: bob.username });
    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(403);
  }, 15000);

  it('200 — no lists returns { ownerUsername, wants: [] }', async () => {
    const alice = await makeUserFull('fw-empty-alice');
    const bob = await makeUserFull('fw-empty-bob');
    await befriend(alice, bob);
    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.ownerUsername).toBe(bob.username);
    expect(res.body.ownerDisplayName).toBeNull();
    expect(res.body.wants).toEqual([]);
  }, 15000);

  it('200 — prefers the friend’s display name when set', async () => {
    const alice = await makeUserFull('fw-dn-alice');
    const bob = await makeUserFull('fw-dn-bob');
    await befriend(alice, bob);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', bob.cookie)
      .send({ displayName: 'Bobby' });
    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.body.ownerDisplayName).toBe('Bobby');
  }, 15000);

  // ⚠️ THE PRIVACY CONTRACT. Ambient friendship visibility is
  // contents-yes-value-no, so a want travels as {name, oracleId} and nothing
  // else. A quantity is a count (the line every other friend surface holds), a
  // target price is a negotiating position, and a note is text the owner wrote
  // for themselves. Asserting the exact key SET — not merely that today's
  // fields are absent — is what stops a future "just one more field" landing.
  it('200 — projects to {name, oracleId} ONLY: no quantity, targetPrice, currency, note, or list name', async () => {
    const alice = await makeUserFull('fw-proj-alice');
    const bob = await makeUserFull('fw-proj-bob');
    await befriend(alice, bob);
    await seedUserList(bob.id, 'l1', {
      name: 'Get this cheap off Dave',
      entries: [
        {
          name: 'Sol Ring',
          oracleId: 'oracle-solring',
          quantity: 4,
          targetPrice: 1.5,
          currency: 'EUR',
          note: 'lowball him',
        },
      ],
    });

    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.wants).toEqual([{ name: 'Sol Ring', oracleId: 'oracle-solring' }]);
    expect(Object.keys(res.body.wants[0]).sort()).toEqual(['name', 'oracleId']);
    // The list's own name is the owner's private label for the group, and the
    // per-entry note is a message to themselves — neither may appear anywhere.
    expect(JSON.stringify(res.body)).not.toContain('Get this cheap off Dave');
    expect(JSON.stringify(res.body)).not.toContain('lowball him');
  }, 15000);

  it('200 — skips tracking lists (a catalogue of what they OWN is not a want)', async () => {
    const alice = await makeUserFull('fw-track-alice');
    const bob = await makeUserFull('fw-track-bob');
    await befriend(alice, bob);
    await seedUserList(bob.id, 'want', {
      name: 'Wants',
      entries: [{ name: 'Sol Ring', oracleId: 'oracle-solring', quantity: 1 }],
    });
    await seedUserList(bob.id, 'track', {
      name: 'My commanders',
      kind: 'tracking',
      entries: [{ name: 'Atraxa', oracleId: 'oracle-atraxa', quantity: 1 }],
    });

    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.wants).toEqual([{ name: 'Sol Ring', oracleId: 'oracle-solring' }]);
  }, 15000);

  it('200 — an absent `kind` is a want list (the default)', async () => {
    const alice = await makeUserFull('fw-kind-alice');
    const bob = await makeUserFull('fw-kind-bob');
    await befriend(alice, bob);
    await seedUserList(bob.id, 'l1', {
      name: 'Untyped',
      entries: [{ name: 'Sol Ring', oracleId: 'oracle-solring', quantity: 1 }],
    });
    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.body.wants).toHaveLength(1);
  }, 15000);

  it('200 — dedupes one card wanted by three lists down to one want', async () => {
    const alice = await makeUserFull('fw-dedup-alice');
    const bob = await makeUserFull('fw-dedup-bob');
    await befriend(alice, bob);
    for (const id of ['l1', 'l2', 'l3']) {
      await seedUserList(bob.id, id, {
        name: `List ${id}`,
        entries: [
          { name: 'Sol Ring', oracleId: 'oracle-solring', quantity: 2 },
          { name: `Only in ${id}`, oracleId: `oracle-${id}`, quantity: 1 },
        ],
      });
    }

    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.wants.filter((w: { name: string }) => w.name === 'Sol Ring')).toHaveLength(1);
    expect(res.body.wants).toHaveLength(4);
  }, 15000);

  it('200 — dedupes legacy entries with no oracleId by name (case-insensitively)', async () => {
    const alice = await makeUserFull('fw-legacy-alice');
    const bob = await makeUserFull('fw-legacy-bob');
    await befriend(alice, bob);
    await seedUserList(bob.id, 'l1', {
      name: 'Old',
      entries: [{ name: 'Sol Ring', quantity: 1 }],
    });
    await seedUserList(bob.id, 'l2', {
      name: 'Older',
      entries: [{ name: 'sol ring', quantity: 1 }],
    });

    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.body.wants).toEqual([{ name: 'Sol Ring', oracleId: '' }]);
  }, 15000);

  it('200 — skips deleted lists, dynamic lists, and malformed rows', async () => {
    const alice = await makeUserFull('fw-skip-alice');
    const bob = await makeUserFull('fw-skip-bob');
    await befriend(alice, bob);
    await seedUserList(bob.id, 'keep', {
      name: 'Wants',
      entries: [{ name: 'Sol Ring', oracleId: 'oracle-solring', quantity: 1 }],
    });
    // Dynamic list: membership is computed live from the owner's own
    // collection, so `entries` is empty by construction — nothing here is a want.
    await seedUserList(bob.id, 'dynamic', {
      name: 'Dynamic',
      rule: [{ conditions: [] }],
      entries: [],
    });
    await seedUserList(bob.id, 'noentries', { name: 'Broken' });
    await seedUserList(bob.id, 'nameless', {
      name: 'Has a blank entry',
      entries: [{ oracleId: 'oracle-nameless', quantity: 1 }, null, 'not-an-object'],
    });
    await pool.query(
      `INSERT INTO user_lists (user_id, id, data, rev, deleted_at, updated_at)
       VALUES ($1, 'gone', $2, nextval('user_data_rev_seq'), $3, $3)`,
      [
        bob.id,
        JSON.stringify({
          id: 'gone',
          name: 'Deleted',
          entries: [{ name: 'Black Lotus', oracleId: 'oracle-lotus', quantity: 1 }],
        }),
        Date.now(),
      ]
    );

    const res = await request(app).get(`/api/friends/${bob.id}/wants`).set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.wants).toEqual([{ name: 'Sol Ring', oracleId: 'oracle-solring' }]);
  }, 15000);

  it('200 — the gate is symmetric: both friends can read the other’s wants', async () => {
    const alice = await makeUserFull('fw-sym-alice');
    const bob = await makeUserFull('fw-sym-bob');
    await befriend(alice, bob);
    await seedUserList(alice.id, 'l1', {
      name: 'Alice wants',
      entries: [{ name: 'Black Lotus', oracleId: 'oracle-lotus', quantity: 1 }],
    });
    const res = await request(app).get(`/api/friends/${alice.id}/wants`).set('Cookie', bob.cookie);
    expect(res.status).toBe(200);
    expect(res.body.wants).toEqual([{ name: 'Black Lotus', oracleId: 'oracle-lotus' }]);
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

async function seedDeckPublication(
  userId: string,
  deckId: string,
  overrides: Partial<{
    slug: string;
    deckName: string;
    format: string;
    publishedAt: number;
    unpublishedAt: number | null;
  }> = {}
): Promise<void> {
  const now = Date.now();
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, published_at, updated_at, unpublished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      userId,
      deckId,
      overrides.slug ?? `slug-${deckId}`,
      overrides.deckName ?? 'Test Deck',
      overrides.format ?? 'commander',
      overrides.publishedAt ?? now,
      overrides.unpublishedAt ?? null,
    ]
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
    expect(res.body.ownerDisplayName).toBeNull();
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

  it('prefers the owner’s display name when set', async () => {
    const owner = await makeUserFull('hub-dn-owner');
    const friend = await makeUserFull('hub-dn-friend');
    await befriend(owner, friend);
    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'Owner O.' });

    const res = await request(app)
      .get(`/api/friends/${owner.id}/shares`)
      .set('Cookie', friend.cookie);
    expect(res.body.ownerDisplayName).toBe('Owner O.');
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

// ─── GET /api/friends/activity (new-from-friends) ────────────────────────────

describe('GET /api/friends/activity', () => {
  it('rejects an unauthenticated caller (401)', async () => {
    const res = await request(app).get('/api/friends/activity');
    expect(res.status).toBe(401);
  });

  it('a friendless caller gets { items: [] }, no error', async () => {
    const alice = await makeUserFull('act-lonely-alice');
    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('a friend’s newly-public deck appears with the right slug/format/name', async () => {
    const alice = await makeUserFull('act-pub-alice');
    const bob = await makeUserFull('act-pub-bob');
    await befriend(alice, bob);
    await seedUserDeck(bob.id, 'deck-pub-1', 'Boros Aggro');
    await seedDeckPublication(bob.id, 'deck-pub-1', {
      slug: 'boros-aggro-xy12',
      deckName: 'Boros Aggro',
      format: 'commander',
    });

    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.type).toBe('published_deck');
    expect(item.friendUsername).toBe('act-pub-bob');
    expect(item.deckName).toBe('Boros Aggro');
    expect(item.slug).toBe('boros-aggro-xy12');
    expect(item.format).toBe('commander');
    expect(typeof item.occurredAt).toBe('number');
  });

  it('a friend’s unpublished deck does not appear', async () => {
    const alice = await makeUserFull('act-unpub-alice');
    const bob = await makeUserFull('act-unpub-bob');
    await befriend(alice, bob);
    await seedUserDeck(bob.id, 'deck-unpub-1', 'Retired Deck');
    await seedDeckPublication(bob.id, 'deck-unpub-1', { unpublishedAt: Date.now() });

    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('a friend’s friends-audience share appears with its resolved label, matching GET /:friendId/shares', async () => {
    const alice = await makeUserFull('act-share-alice');
    const bob = await makeUserFull('act-share-bob');
    await befriend(alice, bob);
    await seedUserDeck(bob.id, 'deck-share-1', 'Golgari Midrange');
    await createShare(bob.cookie, {
      kind: 'deck',
      resourceId: 'deck-share-1',
      audience: 'friends',
    });

    const hub = await request(app).get(`/api/friends/${bob.id}/shares`).set('Cookie', alice.cookie);
    expect(hub.status).toBe(200);

    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.type).toBe('shared_content');
    expect(item.friendUsername).toBe('act-share-bob');
    expect(item.kind).toBe('deck');
    expect(item.label).toBe(hub.body.shares[0].label);
    expect(item.token).toBe(hub.body.shares[0].token);
  });

  it('items from two different friends interleave correctly by recency', async () => {
    const alice = await makeUserFull('act-inter-alice');
    const bob = await makeUserFull('act-inter-bob');
    const carol = await makeUserFull('act-inter-carol');
    await befriend(alice, bob);
    await befriend(alice, carol);

    await seedUserDeck(bob.id, 'deck-inter-bob', 'Bob Deck');
    await seedDeckPublication(bob.id, 'deck-inter-bob', {
      slug: 'bob-deck-activity',
      deckName: 'Bob Deck',
      publishedAt: 1000,
    });
    await seedUserDeck(carol.id, 'deck-inter-carol', 'Carol Deck');
    await seedDeckPublication(carol.id, 'deck-inter-carol', {
      slug: 'carol-deck-activity',
      deckName: 'Carol Deck',
      publishedAt: 3000,
    });
    await createShare(bob.cookie, { kind: 'collection', audience: 'friends' });
    // createShare has no knob for created_at — backdate directly so the merge
    // order is deterministic instead of racing the real clock.
    await pool.query(`UPDATE shares SET created_at = $1 WHERE user_id = $2`, [2000, bob.id]);

    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    const order = (res.body.items as Array<{ occurredAt: number }>).map((i) => i.occurredAt);
    expect(order).toEqual([3000, 2000, 1000]);
  });

  it('a revoked share is dropped', async () => {
    const alice = await makeUserFull('act-revoke-alice');
    const bob = await makeUserFull('act-revoke-bob');
    await befriend(alice, bob);
    const { token } = await createShare(bob.cookie, { kind: 'collection', audience: 'friends' });
    await request(app).delete(`/api/shares/${token}`).set('Cookie', bob.cookie);

    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('a share whose underlying resource was since deleted (label resolves to null) is dropped', async () => {
    const alice = await makeUserFull('act-ghost-alice');
    const bob = await makeUserFull('act-ghost-bob');
    await befriend(alice, bob);
    await createShare(bob.cookie, {
      kind: 'deck',
      resourceId: 'ghost-deck-activity',
      audience: 'friends',
    });

    const res = await request(app).get('/api/friends/activity').set('Cookie', alice.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
