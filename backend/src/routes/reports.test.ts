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

function makeDeck(id: string): Record<string, unknown> {
  return {
    id,
    name: 'Reported Deck',
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
 *  it, and returns the cookie/deckId/ownerId a report test needs. */
async function publishDeck(
  username: string,
  deckId: string
): Promise<{ cookie: string; deckId: string; ownerId: string }> {
  const cookie = await makeUser(username);
  await request(app)
    .patch('/api/auth/profile')
    .set('Cookie', cookie)
    .send({ displayName: `${username} display` });
  await setSnapshotViaSyncApi(request(app), cookie, { decks: [makeDeck(deckId)] });
  const published = await request(app)
    .post(`/api/publications/decks/${deckId}`)
    .set('Cookie', cookie);
  expect(published.status).toBe(201);
  const ownerId = await userIdFromCookie(cookie);
  return { cookie, deckId, ownerId };
}

describe('POST /api/reports', () => {
  it('rejects an unknown kind', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'bogus', targetId: 'x', reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects an empty reason', async () => {
    const { deckId } = await publishDeck('rep-owner-empty', 'deck-empty-reason');
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'deck', targetId: deckId, reason: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a reason over 500 characters', async () => {
    const { deckId } = await publishDeck('rep-owner-long', 'deck-long-reason');
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'deck', targetId: deckId, reason: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('accepts an unauthenticated report on a live public deck, resolving target_owner_id server-side', async () => {
    const { deckId, ownerId } = await publishDeck('rep-owner-anon', 'deck-anon-report');

    // No owner/target-owner id is ever sent — only kind/targetId/reason.
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'deck', targetId: deckId, reason: 'This is plagiarized.' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });

    const row = (
      await pool.query(
        `SELECT target_owner_id, reporter_user_id, reason FROM content_reports WHERE target_id = $1`,
        [deckId]
      )
    ).rows[0];
    expect(row.target_owner_id).toBe(ownerId);
    expect(row.reporter_user_id).toBeNull();
    expect(row.reason).toBe('This is plagiarized.');
  });

  it('stores reporter_user_id when the caller is signed in', async () => {
    const { deckId } = await publishDeck('rep-owner-authed', 'deck-authed-report');
    const reporterCookie = await makeUser('rep-reporter-authed');
    const reporterId = await userIdFromCookie(reporterCookie);

    const res = await request(app)
      .post('/api/reports')
      .set('Cookie', reporterCookie)
      .send({ kind: 'deck', targetId: deckId, reason: 'Stolen decklist.' });
    expect(res.status).toBe(201);

    const row = (
      await pool.query(`SELECT reporter_user_id FROM content_reports WHERE target_id = $1`, [
        deckId,
      ])
    ).rows[0];
    expect(row.reporter_user_id).toBe(reporterId);
  });

  it('returns the distinct "no longer available" response for an unknown deck target — not a bare 404', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'deck', targetId: 'no-such-deck', reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('This content is no longer available.');
  });

  it('returns the same distinct response for an unpublished deck (no longer live)', async () => {
    const { cookie, deckId } = await publishDeck('rep-owner-unpub', 'deck-unpub-report');
    const unpub = await request(app)
      .delete(`/api/publications/decks/${deckId}`)
      .set('Cookie', cookie);
    expect(unpub.status).toBe(204);

    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'deck', targetId: deckId, reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('This content is no longer available.');
  });

  it("reports a profile by username, resolving to that user's id", async () => {
    const targetCookie = await makeUser('rep-profile-target');
    const targetId = await userIdFromCookie(targetCookie);

    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'profile', targetId: 'rep-profile-target', reason: 'Impersonation.' });
    expect(res.status).toBe(201);

    const row = (
      await pool.query(
        `SELECT target_owner_id FROM content_reports WHERE target_id = $1 AND kind = 'profile'`,
        ['rep-profile-target']
      )
    ).rows[0];
    expect(row.target_owner_id).toBe(targetId);
  });

  it('404s the distinct message for an unknown username', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'profile', targetId: 'no-such-user', reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('This content is no longer available.');
  });

  it('404s a game-result target — no live public surface exists yet', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'game-result', targetId: 'session-1', reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('This content is no longer available.');
  });
});

describe('content_reports cascade on account deletion', () => {
  it("removes reports whose target owner's account is deleted", async () => {
    const { cookie, deckId } = await publishDeck('rep-cascade-owner', 'deck-cascade');
    const submitted = await request(app)
      .post('/api/reports')
      .send({ kind: 'deck', targetId: deckId, reason: 'x' });
    expect(submitted.status).toBe(201);

    const before = await pool.query(`SELECT id FROM content_reports WHERE target_id = $1`, [
      deckId,
    ]);
    expect(before.rows.length).toBe(1);

    const del = await request(app).delete('/api/auth/me').set('Cookie', cookie);
    expect(del.status).toBe(200);

    const after = await pool.query(`SELECT id FROM content_reports WHERE target_id = $1`, [deckId]);
    expect(after.rows.length).toBe(0);
  });
});
