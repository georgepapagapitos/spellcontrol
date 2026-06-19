import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

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
