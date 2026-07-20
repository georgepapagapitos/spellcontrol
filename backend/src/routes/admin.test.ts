import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createTestEnv, extractSessionCookie, setSnapshotViaSyncApi } from '../test-helpers';
import { getDb } from '../db';

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

/** Register a user, then promote them via direct DB write. */
async function registerAdmin(
  username: string,
  password = 'correct horse battery'
): Promise<string> {
  const reg = await request(app).post('/api/auth/register').send({ username, password });
  if (reg.status !== 201) throw new Error(`register admin failed: ${reg.status}`);
  await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = ${username}`);
  // Re-login so the new session cookie carries role='admin' in its JWT claims.
  const login = await request(app).post('/api/auth/login').send({ username, password });
  return extractSessionCookie(login.headers['set-cookie'])!;
}

async function registerUser(username: string, password = 'correct horse battery'): Promise<string> {
  const reg = await request(app).post('/api/auth/register').send({ username, password });
  if (reg.status !== 201) throw new Error(`register user failed: ${reg.status}`);
  return extractSessionCookie(reg.headers['set-cookie'])!;
}

async function userIdFromCookie(cookie: string): Promise<string> {
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return me.body.user.id as string;
}

function makeDeck(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Reports Fixture Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    cards: [],
    sideboard: [],
    color: '#888',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Registers `username`, sets a display name, publishes a fresh deck under
 *  it, and returns the cookie/deckId/ownerId/slug a report-resolve test needs. */
async function publishDeck(
  username: string,
  deckId: string
): Promise<{ cookie: string; deckId: string; ownerId: string; slug: string }> {
  const cookie = await registerUser(username);
  await request(app)
    .patch('/api/auth/profile')
    .set('Cookie', cookie)
    .send({ displayName: `${username} display` });
  await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck(deckId)] });
  const published = await request(app)
    .post(`/api/publications/decks/${deckId}`)
    .set('Cookie', cookie);
  if (published.status !== 201) {
    throw new Error(`publish fixture deck failed: ${published.status}`);
  }
  const ownerId = await userIdFromCookie(cookie);
  return { cookie, deckId, ownerId, slug: published.body.publication.slug as string };
}

/** Seeds an unresolved content_reports row directly (bypassing POST
 *  /api/reports, whose own coverage lives in reports.test.ts). */
async function seedReport(input: {
  kind: 'deck' | 'profile' | 'game-result';
  targetId: string;
  targetOwnerId: string;
  reason?: string;
}): Promise<string> {
  const id = `report_${Math.random().toString(36).slice(2)}`;
  await pool.query(
    `INSERT INTO content_reports (id, kind, target_id, target_owner_id, reporter_user_id, reason, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
    [id, input.kind, input.targetId, input.targetOwnerId, input.reason ?? 'Reported.', Date.now()]
  );
  return id;
}

describe('GET /api/admin/users', () => {
  it('401s without a session', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('lia');
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('returns the user list for an admin', async () => {
    const cookie = await registerAdmin('mara');
    await registerUser('nick');
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const usernames = res.body.users.map((u: { username: string }) => u.username);
    expect(usernames).toContain('mara');
    expect(usernames).toContain('nick');
    // Role-aware projection: admin's role comes back as admin, others as user.
    const mara = res.body.users.find((u: { username: string }) => u.username === 'mara');
    const nick = res.body.users.find((u: { username: string }) => u.username === 'nick');
    expect(mara.role).toBe('admin');
    expect(nick.role).toBe('user');
    expect(typeof mara.dataBytes).toBe('number');
  });

  it('surfaces profile fields — null by default, populated after a profile PATCH', async () => {
    const cookie = await registerAdmin('opal');
    const targetCookie = await registerUser('petra');
    let res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    let petra = res.body.users.find((u: { username: string }) => u.username === 'petra');
    expect(petra.displayName).toBeNull();
    expect(petra.bio).toBeNull();
    expect(petra.avatarCardName).toBeNull();

    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', targetCookie)
      .send({
        displayName: 'Petra',
        bio: 'Cube drafter',
        avatar: {
          cardId: '56ebc372-aabd-4174-a943-c7bf59e5049f',
          cardName: 'Sol Ring',
          imageUrl:
            'https://cards.scryfall.io/art_crop/front/5/6/56ebc372-aabd-4174-a943-c7bf59e5049f.jpg',
        },
      });

    res = await request(app).get('/api/admin/users').set('Cookie', cookie);
    petra = res.body.users.find((u: { username: string }) => u.username === 'petra');
    expect(petra.displayName).toBe('Petra');
    expect(petra.bio).toBe('Cube drafter');
    expect(petra.avatarCardName).toBe('Sol Ring');
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('owen');
    const res = await request(app).delete('/api/admin/users/some-id').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('refuses to delete the admin themselves', async () => {
    const cookie = await registerAdmin('pria');
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    const myId = me.body.user.id;
    const res = await request(app).delete(`/api/admin/users/${myId}`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  it('404s for an unknown user id', async () => {
    const cookie = await registerAdmin('quinn');
    const res = await request(app).delete('/api/admin/users/does-not-exist').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('deletes a target user and their user_data', async () => {
    const adminCookie = await registerAdmin('riya');
    const victimCookie = await registerUser('sam');
    const me = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    const victimId = me.body.user.id;

    const del = await request(app)
      .delete(`/api/admin/users/${victimId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(200);

    // Victim's session should no longer load a user (account is gone).
    const victimMe = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    expect(victimMe.status).toBe(401);
  });
});

describe('POST /api/admin/users/:id/clear-profile', () => {
  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('ravi');
    const res = await request(app)
      .post('/api/admin/users/some-id/clear-profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('404s for an unknown user id', async () => {
    const cookie = await registerAdmin('sana');
    const res = await request(app)
      .post('/api/admin/users/does-not-exist/clear-profile')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('clears a set profile', async () => {
    const adminCookie = await registerAdmin('tomas');
    const victimCookie = await registerUser('uma');
    const me = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    const victimId = me.body.user.id;

    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', victimCookie)
      .send({
        displayName: 'Uma',
        bio: 'Playgroup regular',
        avatar: {
          cardId: '56ebc372-aabd-4174-a943-c7bf59e5049f',
          cardName: 'Sol Ring',
          imageUrl:
            'https://cards.scryfall.io/art_crop/front/5/6/56ebc372-aabd-4174-a943-c7bf59e5049f.jpg',
        },
      });

    const res = await request(app)
      .post(`/api/admin/users/${victimId}/clear-profile`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Verify ALL 5 profile columns were nulled, not just the 3 the admin
    // list surfaces — read back through the victim's own /me.
    const victimMe = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
    expect(victimMe.body.profile).toEqual({
      displayName: null,
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    });
  });
});

describe('/api/auth/me returns role', () => {
  it('reflects a promotion done after the JWT was issued', async () => {
    const cookie = await registerUser('tess');
    // Pre-promotion: role=user.
    let me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.user.role).toBe('user');
    // Promote in-place; cookie still carries old role, but /auth/me reads DB.
    await getDb().execute(sql`UPDATE users SET role = 'admin' WHERE username = 'tess'`);
    me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.user.role).toBe('admin');
  });
});

describe('GET /api/admin/reports', () => {
  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('vik');
    const res = await request(app).get('/api/admin/reports').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('lists an unresolved report for an admin, with a best-effort target label and reporter', async () => {
    const adminCookie = await registerAdmin('wren');
    const { deckId, ownerId } = await publishDeck('xena', 'deck-report-list');
    await seedReport({ kind: 'deck', targetId: deckId, targetOwnerId: ownerId, reason: 'spam' });

    const res = await request(app).get('/api/admin/reports').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    const row = res.body.reports[0];
    expect(row.kind).toBe('deck');
    expect(row.targetLabel).toBe('Reports Fixture Deck by xena');
    expect(row.reporterUsername).toBeNull();
    expect(row.reason).toBe('spam');
    expect(typeof row.createdAt).toBe('number');
  });

  it('never lists an already-resolved report', async () => {
    const adminCookie = await registerAdmin('yara');
    const { deckId, ownerId } = await publishDeck('zack', 'deck-report-resolved');
    const reportId = await seedReport({ kind: 'deck', targetId: deckId, targetOwnerId: ownerId });
    await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set('Cookie', adminCookie)
      .send({ action: 'dismiss' });

    const res = await request(app).get('/api/admin/reports').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.reports.find((r: { id: string }) => r.id === reportId)).toBeUndefined();
  });
});

describe('POST /api/admin/reports/:id/resolve', () => {
  it('403s for a non-admin session', async () => {
    const cookie = await registerUser('amir');
    const res = await request(app)
      .post('/api/admin/reports/some-id/resolve')
      .set('Cookie', cookie)
      .send({ action: 'dismiss' });
    expect(res.status).toBe(403);
  });

  it('400s an invalid action', async () => {
    const adminCookie = await registerAdmin('bree');
    const res = await request(app)
      .post('/api/admin/reports/some-id/resolve')
      .set('Cookie', adminCookie)
      .send({ action: 'delete-everything' });
    expect(res.status).toBe(400);
  });

  it('404s an unknown report id', async () => {
    const adminCookie = await registerAdmin('carl');
    const res = await request(app)
      .post('/api/admin/reports/does-not-exist/resolve')
      .set('Cookie', adminCookie)
      .send({ action: 'dismiss' });
    expect(res.status).toBe(404);
  });

  it('dismiss only stamps resolved_at/resolution — no side effect on the deck', async () => {
    const adminCookie = await registerAdmin('dana');
    const { deckId, ownerId, slug } = await publishDeck('erin', 'deck-report-dismiss');
    const reportId = await seedReport({ kind: 'deck', targetId: deckId, targetOwnerId: ownerId });

    const res = await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set('Cookie', adminCookie)
      .send({ action: 'dismiss' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const row = (
      await pool.query(`SELECT resolved_at, resolution FROM content_reports WHERE id = $1`, [
        reportId,
      ])
    ).rows[0];
    expect(row.resolved_at).not.toBeNull();
    expect(row.resolution).toBe('dismissed');

    // The deck itself is untouched — still publicly readable.
    const publicRead = await request(app).get(`/api/public/decks/${slug}`);
    expect(publicRead.status).toBe(200);
  });

  it('hide on a deck report unpublishes it — the public read then 404s', async () => {
    const adminCookie = await registerAdmin('finn');
    const { deckId, ownerId, slug } = await publishDeck('gwen', 'deck-report-hide');
    const reportId = await seedReport({ kind: 'deck', targetId: deckId, targetOwnerId: ownerId });

    const res = await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set('Cookie', adminCookie)
      .send({ action: 'hide' });
    expect(res.status).toBe(200);

    const pub = (
      await pool.query(`SELECT unpublished_at FROM deck_publications WHERE deck_id = $1`, [deckId])
    ).rows[0];
    expect(pub.unpublished_at).not.toBeNull();

    const publicRead = await request(app).get(`/api/public/decks/${slug}`);
    expect(publicRead.status).toBe(404);
  });

  it('hide on a profile report sets profile_hidden_at AND cascades to unpublish every one of that user’s live decks', async () => {
    const adminCookie = await registerAdmin('hana');
    const targetUsername = 'ivan';
    const deckA = await publishDeck(targetUsername, 'deck-report-cascade-a');
    // A second deck published under the SAME already-registered user. A raw
    // additive /api/sync upsert (not setSnapshotViaSyncApi, which diffs
    // against — and would tombstone — deck-report-cascade-a since it's
    // absent from a fresh desired-state snapshot).
    const secondSync = await request(app)
      .post('/api/sync')
      .set('Cookie', deckA.cookie)
      .send({
        upserts: [
          { kind: 'deck', id: 'deck-report-cascade-b', data: makeDeck('deck-report-cascade-b') },
        ],
        deletions: [],
      });
    expect(secondSync.status).toBe(200);
    const secondPublish = await request(app)
      .post('/api/publications/decks/deck-report-cascade-b')
      .set('Cookie', deckA.cookie);
    expect(secondPublish.status).toBe(201);
    const slugB = secondPublish.body.publication.slug as string;

    const reportId = await seedReport({
      kind: 'profile',
      targetId: targetUsername,
      targetOwnerId: deckA.ownerId,
    });

    const res = await request(app)
      .post(`/api/admin/reports/${reportId}/resolve`)
      .set('Cookie', adminCookie)
      .send({ action: 'hide' });
    expect(res.status).toBe(200);

    const userRow = (
      await pool.query(`SELECT profile_hidden_at FROM users WHERE id = $1`, [deckA.ownerId])
    ).rows[0];
    expect(userRow.profile_hidden_at).not.toBeNull();

    const pubs = await pool.query(
      `SELECT deck_id, unpublished_at FROM deck_publications WHERE user_id = $1`,
      [deckA.ownerId]
    );
    expect(pubs.rows).toHaveLength(2);
    for (const row of pubs.rows) {
      expect(row.unpublished_at).not.toBeNull();
    }

    const publicReadA = await request(app).get(`/api/public/decks/${deckA.slug}`);
    const publicReadB = await request(app).get(`/api/public/decks/${slugB}`);
    expect(publicReadA.status).toBe(404);
    expect(publicReadB.status).toBe(404);
  });
});
