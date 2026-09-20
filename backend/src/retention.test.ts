import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import crypto from 'crypto';
import { createTestEnv } from './test-helpers';
import { runRetentionSweep } from './retention';

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

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeUser(username: string): Promise<string> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery', email: `${username}@example.test` });
  expect(reg.status).toBe(201);
  return reg.body.user.id as string;
}

async function countRows(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows[0].n);
}

describe('runRetentionSweep', () => {
  it("prunes only rows past each table's cutoff, leaves fresh rows and protected shares intact", async () => {
    const userId = await makeUser('retention-owner');

    // ai_reviews: one old row (>365d), one fresh row.
    await pool.query(
      `INSERT INTO ai_reviews (id, user_id, feature, input_hash, model, content, input_tokens, output_tokens, created_at)
       VALUES ($1, $2, 'deck-review', 'old-hash', 'test-model', 'old', 1, 1, $3),
              ($4, $2, 'deck-review', 'fresh-hash', 'test-model', 'fresh', 1, 1, $5)`,
      [
        crypto.randomUUID(),
        userId,
        Date.now() - 366 * DAY_MS,
        crypto.randomUUID(),
        Date.now() - 1 * DAY_MS,
      ]
    );

    // event/error/vital counts: one row 401 days old, one row 1 day old.
    await pool.query(
      `INSERT INTO event_counts (day, name, path, count) VALUES
         (CURRENT_DATE - 401, 'view', '/old', 3), (CURRENT_DATE - 1, 'view', '/fresh', 3)`
    );
    await pool.query(
      `INSERT INTO error_counts (day, path, kind, message, count) VALUES
         (CURRENT_DATE - 401, '/old', 'uncaught', 'boom', 1), (CURRENT_DATE - 1, '/fresh', 'uncaught', 'boom', 1)`
    );
    await pool.query(
      `INSERT INTO vital_counts (day, path, metric, rating, count) VALUES
         (CURRENT_DATE - 401, '/old', 'CLS', 'good', 1), (CURRENT_DATE - 1, '/fresh', 'CLS', 'good', 1)`
    );

    // shares: an old revoked share with no feedback (prunable), an old
    // revoked share WITH feedback attached (must survive — deck_feedback's
    // history is denormalized to outlive the share), a recently-revoked
    // share (too fresh to prune), and a never-revoked share.
    const prunableToken = 'tok-prunable';
    const protectedToken = 'tok-protected';
    const recentToken = 'tok-recent';
    const activeToken = 'tok-active';
    const oldRevokedAt = Date.now() - 31 * DAY_MS;
    await pool.query(
      `INSERT INTO shares (token, user_id, kind, resource_id, created_at, revoked_at) VALUES
         ($1, $5, 'deck', 'd1', $6, $2),
         ($3, $5, 'deck', 'd2', $6, $2),
         ($4, $5, 'deck', 'd3', $6, $7)`,
      [
        prunableToken,
        oldRevokedAt,
        protectedToken,
        recentToken,
        userId,
        Date.now() - 40 * DAY_MS,
        Date.now() - 5 * DAY_MS,
      ]
    );
    await pool.query(
      `INSERT INTO shares (token, user_id, kind, resource_id, created_at, revoked_at) VALUES ($1, $2, 'deck', 'd4', $3, NULL)`,
      [activeToken, userId, Date.now() - 40 * DAY_MS]
    );
    await pool.query(
      `INSERT INTO deck_feedback (id, share_token, owner_user_id, deck_id, author_name, suggestions, created_at, updated_at)
       VALUES ($1, $2, $3, 'd2', 'Someone', '[]'::jsonb, $4, $4)`,
      [crypto.randomUUID(), protectedToken, userId, Date.now()]
    );

    // game_sessions: one stale (>24h), one fresh.
    await pool.query(
      `INSERT INTO game_sessions (id, code, host_user_id, status, state, created_at, updated_at) VALUES
         ($1, 'STALE1', $5, 'active', '{}'::jsonb, $6, $6),
         ($2, 'FRESH1', $5, 'active', '{}'::jsonb, $3, $4)`,
      [
        crypto.randomUUID(),
        crypto.randomUUID(),
        Date.now(),
        Date.now(),
        userId,
        Date.now() - 25 * 60 * 60 * 1000,
      ]
    );

    await runRetentionSweep();

    expect(await countRows('ai_reviews')).toBe(1);
    expect((await pool.query('SELECT content FROM ai_reviews')).rows[0].content).toBe('fresh');

    expect(await countRows('event_counts')).toBe(1);
    expect(await countRows('error_counts')).toBe(1);
    expect(await countRows('vital_counts')).toBe(1);

    const remainingTokens = (await pool.query('SELECT token FROM shares ORDER BY token')).rows.map(
      (r: { token: string }) => r.token
    );
    expect(remainingTokens).toEqual([activeToken, protectedToken, recentToken].sort());
    // deck_feedback survived because its share was protected, not deleted.
    expect(await countRows('deck_feedback')).toBe(1);

    const remainingCodes = (await pool.query('SELECT code FROM game_sessions')).rows.map(
      (r: { code: string }) => r.code
    );
    expect(remainingCodes).toEqual(['FRESH1']);
  });
});
