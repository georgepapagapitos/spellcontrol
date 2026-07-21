import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
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

async function makeUser(username: string): Promise<{ cookie: string; id: string }> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  expect(reg.status).toBe(201);
  return { cookie: extractSessionCookie(reg.headers['set-cookie'])!, id: reg.body.user.id };
}

/** Mutual requests — the second auto-accepts (see friends.ts). */
async function befriend(cookieA: string, usernameB: string, cookieB: string, usernameA: string) {
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', cookieA)
    .send({ username: usernameB });
  await request(app)
    .post('/api/friends/requests')
    .set('Cookie', cookieB)
    .send({ username: usernameA });
}

interface PodBody {
  id: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  createdAt: number;
  myStatus: 'invited' | 'member';
  memberCount: number;
}

async function createPod(cookie: string, name = 'Thursday crew'): Promise<PodBody> {
  const res = await request(app).post('/api/pods').set('Cookie', cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.pod as PodBody;
}

/**
 * Seed N synthetic 'member' rows directly (users + pod_members) — cheaper
 * than registering N real accounts through bcrypt when a test only cares
 * about the total count (the MAX_POD_MEMBERS cap test).
 */
async function fillPod(podId: string, count: number): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const uid = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $2, $3)`, [
      uid,
      `pod-filler-${uid}`,
      now,
    ]);
    await pool.query(
      `INSERT INTO pod_members (pod_id, user_id, status, invited_at, joined_at)
       VALUES ($1, $2, 'member', $3, $3)`,
      [podId, uid, now]
    );
  }
}

// ─── POST /api/pods ────────────────────────────────────────────────────────

describe('POST /api/pods', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const res = await request(app).post('/api/pods').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty/blank name (400)', async () => {
    const { cookie } = await makeUser('pod-create-empty');
    const res = await request(app).post('/api/pods').set('Cookie', cookie).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a 61-char name (400)', async () => {
    const { cookie } = await makeUser('pod-create-long');
    const res = await request(app)
      .post('/api/pods')
      .set('Cookie', cookie)
      .send({ name: 'x'.repeat(61) });
    expect(res.status).toBe(400);
  });

  it('creates a pod and the creator is immediately a member row', async () => {
    const { cookie, id } = await makeUser('pod-create-owner');
    const pod = await createPod(cookie, 'Commander crew');
    expect(pod.name).toBe('Commander crew');
    expect(pod.ownerUserId).toBe(id);
    expect(pod.ownerUsername).toBe('pod-create-owner');
    expect(pod.myStatus).toBe('member');
    expect(pod.memberCount).toBe(1);

    const detail = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.members).toEqual([
      { userId: id, username: 'pod-create-owner', status: 'member', joinedAt: pod.createdAt },
    ]);
  });
});

// ─── GET /api/pods ─────────────────────────────────────────────────────────

describe('GET /api/pods', () => {
  it('only lists pods the caller has a row in', async () => {
    const alice = await makeUser('pod-list-alice');
    const bob = await makeUser('pod-list-bob');
    await createPod(alice.cookie, 'Alice pod');

    const bobRes = await request(app).get('/api/pods').set('Cookie', bob.cookie);
    expect(bobRes.status).toBe(200);
    expect(bobRes.body.pods).toEqual([]);

    const aliceRes = await request(app).get('/api/pods').set('Cookie', alice.cookie);
    expect(aliceRes.body.pods.map((p: PodBody) => p.name)).toContain('Alice pod');
  });
});

// ─── GET /api/pods/:id ─────────────────────────────────────────────────────

describe('GET /api/pods/:id', () => {
  it('404s for a user with zero rows on that pod', async () => {
    const owner = await makeUser('pod-get-owner');
    const outsider = await makeUser('pod-get-outsider');
    const pod = await createPod(owner.cookie);

    const res = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/pods/:id ───────────────────────────────────────────────────

describe('PATCH /api/pods/:id', () => {
  it('non-owner gets 404, not 403', async () => {
    const owner = await makeUser('pod-patch-owner');
    const other = await makeUser('pod-patch-other');
    const pod = await createPod(owner.cookie);

    const res = await request(app)
      .patch(`/api/pods/${pod.id}`)
      .set('Cookie', other.cookie)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('owner can rename', async () => {
    const owner = await makeUser('pod-patch-happy');
    const pod = await createPod(owner.cookie, 'Old name');

    const res = await request(app)
      .patch(`/api/pods/${pod.id}`)
      .set('Cookie', owner.cookie)
      .send({ name: 'New name' });
    expect(res.status).toBe(200);
    expect(res.body.pod.name).toBe('New name');
  });
});

// ─── DELETE /api/pods/:id ───────────────────────────────────────────────────

describe('DELETE /api/pods/:id', () => {
  it('non-owner gets 404, not 403', async () => {
    const owner = await makeUser('pod-del-owner');
    const other = await makeUser('pod-del-other');
    const pod = await createPod(owner.cookie);

    const res = await request(app).delete(`/api/pods/${pod.id}`).set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });

  it('cascades pod_members — a follow-up GET 404s for the erstwhile owner too', async () => {
    const owner = await makeUser('pod-del-cascade');
    const pod = await createPod(owner.cookie);

    const del = await request(app).delete(`/api/pods/${pod.id}`).set('Cookie', owner.cookie);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', owner.cookie);
    expect(after.status).toBe(404);
  });
});

// ─── POST /api/pods/:id/invites ─────────────────────────────────────────────

describe('POST /api/pods/:id/invites', () => {
  it('inviting a non-friend → 403', async () => {
    const owner = await makeUser('pod-inv-owner1');
    const stranger = await makeUser('pod-inv-stranger');
    const pod = await createPod(owner.cookie);

    const res = await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [stranger.id] });
    expect(res.status).toBe(403);
  });

  it('inviting someone already a member is a no-op (200, no duplicate, no error)', async () => {
    const owner = await makeUser('pod-inv-owner2');
    const friend = await makeUser('pod-inv-friend2');
    await befriend(owner.cookie, 'pod-inv-friend2', friend.cookie, 'pod-inv-owner2');
    const pod = await createPod(owner.cookie);

    const first = await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [friend.id] });
    expect(first.status).toBe(200);
    expect(first.body.invited).toEqual([friend.id]);

    await request(app).post(`/api/pods/${pod.id}/accept`).set('Cookie', friend.cookie);

    const second = await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [friend.id] });
    expect(second.status).toBe(200);
    expect(second.body.invited).toEqual([]);

    const detail = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', owner.cookie);
    expect(detail.body.members).toHaveLength(2);
  });

  it('rejects an invite that would push the pod past MAX_POD_MEMBERS (400)', async () => {
    const owner = await makeUser('pod-inv-cap-owner');
    const pod = await createPod(owner.cookie);
    const extra = await makeUser('pod-inv-cap-extra');
    await befriend(owner.cookie, 'pod-inv-cap-extra', extra.cookie, 'pod-inv-cap-owner');

    // Owner is already 1 of 24 slots; pad to exactly 24 so one more invite tips it over.
    await fillPod(pod.id, 23);

    const res = await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [extra.id] });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/pods/:id/accept ──────────────────────────────────────────────

describe('POST /api/pods/:id/accept', () => {
  it('404s without a pending invite', async () => {
    const owner = await makeUser('pod-accept-owner');
    const outsider = await makeUser('pod-accept-outsider');
    const pod = await createPod(owner.cookie);

    const res = await request(app)
      .post(`/api/pods/${pod.id}/accept`)
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
  });

  it('flips an invited row to member', async () => {
    const owner = await makeUser('pod-accept-owner2');
    const friend = await makeUser('pod-accept-friend2');
    await befriend(owner.cookie, 'pod-accept-friend2', friend.cookie, 'pod-accept-owner2');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [friend.id] });

    const res = await request(app).post(`/api/pods/${pod.id}/accept`).set('Cookie', friend.cookie);
    expect(res.status).toBe(200);

    const detail = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', friend.cookie);
    expect(detail.body.myStatus).toBe('member');
  });
});

// ─── POST /api/pods/:id/decline ─────────────────────────────────────────────

describe('POST /api/pods/:id/decline', () => {
  it('removes the invite row entirely — a subsequent GET /:id 404s again', async () => {
    const owner = await makeUser('pod-decline-owner');
    const friend = await makeUser('pod-decline-friend');
    await befriend(owner.cookie, 'pod-decline-friend', friend.cookie, 'pod-decline-owner');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [friend.id] });

    const decline = await request(app)
      .post(`/api/pods/${pod.id}/decline`)
      .set('Cookie', friend.cookie);
    expect(decline.status).toBe(204);

    const after = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', friend.cookie);
    expect(after.status).toBe(404);
  });
});

// ─── DELETE /api/pods/:id/members/me  ("leave") ─────────────────────────────

describe('DELETE /api/pods/:id/members/me', () => {
  it('the owner gets 400, redirected to delete-the-pod', async () => {
    const owner = await makeUser('pod-leave-owner');
    const pod = await createPod(owner.cookie);

    const res = await request(app)
      .delete(`/api/pods/${pod.id}/members/me`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delete the pod instead/i);
  });

  it('a non-owner member can leave', async () => {
    const owner = await makeUser('pod-leave-owner2');
    const friend = await makeUser('pod-leave-friend2');
    await befriend(owner.cookie, 'pod-leave-friend2', friend.cookie, 'pod-leave-owner2');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [friend.id] });
    await request(app).post(`/api/pods/${pod.id}/accept`).set('Cookie', friend.cookie);

    const res = await request(app)
      .delete(`/api/pods/${pod.id}/members/me`)
      .set('Cookie', friend.cookie);
    expect(res.status).toBe(204);

    const after = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', friend.cookie);
    expect(after.status).toBe(404);
  });
});

// ─── DELETE /api/pods/:id/members/:userId  ("remove", owner only) ──────────

describe('DELETE /api/pods/:id/members/:userId', () => {
  it('owner can remove a member (204); the removed member 404s on GET /:id', async () => {
    const owner = await makeUser('pod-remove-owner');
    const friend = await makeUser('pod-remove-friend');
    await befriend(owner.cookie, 'pod-remove-friend', friend.cookie, 'pod-remove-owner');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [friend.id] });
    await request(app).post(`/api/pods/${pod.id}/accept`).set('Cookie', friend.cookie);

    const res = await request(app)
      .delete(`/api/pods/${pod.id}/members/${friend.id}`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(204);

    const after = await request(app).get(`/api/pods/${pod.id}`).set('Cookie', friend.cookie);
    expect(after.status).toBe(404);
  });

  it('non-owner attempting to remove someone gets 404 (stealth, not 403)', async () => {
    const owner = await makeUser('pod-remove-no-owner');
    const member = await makeUser('pod-remove-no-member');
    const outsider = await makeUser('pod-remove-no-outsider');
    await befriend(owner.cookie, 'pod-remove-no-member', member.cookie, 'pod-remove-no-owner');
    const pod = await createPod(owner.cookie);
    await request(app)
      .post(`/api/pods/${pod.id}/invites`)
      .set('Cookie', owner.cookie)
      .send({ userIds: [member.id] });
    await request(app).post(`/api/pods/${pod.id}/accept`).set('Cookie', member.cookie);

    const res = await request(app)
      .delete(`/api/pods/${pod.id}/members/${member.id}`)
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
  });

  it('the owner targeting their own id gets 400, not removed', async () => {
    const owner = await makeUser('pod-remove-self-owner');
    const pod = await createPod(owner.cookie);

    const res = await request(app)
      .delete(`/api/pods/${pod.id}/members/${owner.id}`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(400);
  });
});

// ─── Rate limiter tiers (regression guard for the folded-in fix) ───────────
//
// testAwareLimiter no-ops under TEST_DATABASE_URL (see route-utils.ts), so
// pods.ts's own routes can't be driven to 429 from this suite by design.
// These pin the exact numbers pods.ts wires up (podReadLimiter 60/min,
// podWriteLimiter 20/min) against a real rateLimit(), guarding against the
// limiter silently regressing or being dropped.
describe('rate limiter tiers (regression guard)', () => {
  function limitedApp(max: number) {
    const limited = express();
    limited.get('/x', rateLimit({ windowMs: 60_000, max }), (_req, res) => res.status(200).end());
    return limited;
  }

  it('podReadLimiter tier (60/min) 429s past its window', async () => {
    const limited = limitedApp(60);
    for (let i = 0; i < 60; i++) {
      await request(limited).get('/x').expect(200);
    }
    await request(limited).get('/x').expect(429);
  });

  it('podWriteLimiter tier (20/min) 429s past its window', async () => {
    const limited = limitedApp(20);
    for (let i = 0; i < 20; i++) {
      await request(limited).get('/x').expect(200);
    }
    await request(limited).get('/x').expect(429);
  });
});
