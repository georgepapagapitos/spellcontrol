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

/** Seeds a game_results row for `username` (as its sole participant) and
 *  mints a 'game-result' share of it. Returns the sharer's cookie/id and the
 *  share token — the token is what a game-result report's targetId is. */
async function makeGameResultShare(
  username: string,
  sessionId: string
): Promise<{ cookie: string; sharerId: string; token: string }> {
  const cookie = await makeUser(username);
  const sharerId = await userIdFromCookie(cookie);
  await pool.query(
    `INSERT INTO game_results
       (session_id, code, format, starting_life, winner_seat, winner_user_id,
        started_at, ended_at, duration_ms, participants, notable_events, created_at)
     VALUES ($1, 'CODE', 'commander', 40, 0, $2, 1000, 2000, 1000, $3, '[]', 2000)`,
    [
      sessionId,
      sharerId,
      JSON.stringify([
        {
          seat: 0,
          userId: sharerId,
          username: null,
          name: username,
          deckId: null,
          deckName: null,
          commander: null,
          colorIdentity: [],
          finalLife: 40,
          eliminated: false,
        },
      ]),
    ]
  );
  const share = await request(app)
    .post('/api/shares')
    .set('Cookie', cookie)
    .send({ kind: 'game-result', resourceId: sessionId });
  expect(share.status).toBe(201);
  return { cookie, sharerId, token: share.body.share.token as string };
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

  it('404s an unrecognized game-result token', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'game-result', targetId: 'session-1', reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('This content is no longer available.');
  });

  it('resolves a game-result report’s target_owner_id to the sharer via a live share token', async () => {
    const { token, sharerId } = await makeGameResultShare('rep-gr-sharer', 'rep-gr-session-1');

    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'game-result', targetId: token, reason: 'Toxic table talk.' });
    expect(res.status).toBe(201);

    const row = (
      await pool.query(
        `SELECT target_owner_id FROM content_reports WHERE target_id = $1 AND kind = 'game-result'`,
        [token]
      )
    ).rows[0];
    expect(row.target_owner_id).toBe(sharerId);
  });

  it('returns the distinct "no longer available" response for a revoked game-result share token', async () => {
    const { cookie, token } = await makeGameResultShare('rep-gr-revoked', 'rep-gr-session-2');
    const revoke = await request(app).delete(`/api/shares/${token}`).set('Cookie', cookie);
    expect(revoke.status).toBe(204);

    const res = await request(app)
      .post('/api/reports')
      .send({ kind: 'game-result', targetId: token, reason: 'x' });
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
