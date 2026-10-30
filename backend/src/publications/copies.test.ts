import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import { forkedFromSlug, recountDeckCopies } from './copies';
import { refreshDeckPublications } from './sync-hook';

const SRC = path.resolve(__dirname, '..');

let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function seedUser(id: string): Promise<void> {
  await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $1, $2)`, [
    id,
    Date.now(),
  ]);
}

async function publish(ownerId: string, slug: string, copyCount = 0): Promise<void> {
  await pool.query(
    `INSERT INTO deck_publications
       (user_id, deck_id, slug, deck_name, format, copy_count, published_at, updated_at)
     VALUES ($1, $2, $2, 'A deck', 'commander', $3, 1, 1)`,
    [ownerId, slug, copyCount]
  );
}

/** A deck in `userId`'s account copied from `slug`, as a sync push lands it. */
async function copyInto(userId: string, deckId: string, slug: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_decks (user_id, id, data, rev, updated_at) VALUES ($1, $2, $3, 1, 1)`,
    [
      userId,
      deckId,
      JSON.stringify({
        name: 'Copy',
        forkedFrom: { slug, ownerUsername: 'o', deckName: 'A deck' },
      }),
    ]
  );
}

async function copyCount(slug: string): Promise<number> {
  const { rows } = await pool.query<{ copy_count: number }>(
    `SELECT copy_count FROM deck_publications WHERE slug = $1`,
    [slug]
  );
  return rows[0].copy_count;
}

describe('recountDeckCopies', () => {
  it('counts other accounts holding a live copy, once each, and never the owner', async () => {
    for (const id of ['cp-owner', 'cp-a', 'cp-b']) await seedUser(id);
    await publish('cp-owner', 'cp-deck', 1000); // a pumped count from the old beacon
    await copyInto('cp-a', 'a-1', 'cp-deck');
    await copyInto('cp-a', 'a-2', 'cp-deck'); // the same player twice
    await copyInto('cp-b', 'b-1', 'cp-deck');
    await copyInto('cp-owner', 'o-1', 'cp-deck'); // the owner copying their own deck

    await recountDeckCopies();
    expect(await copyCount('cp-deck')).toBe(2);
  });

  it('stops counting a copy once it is deleted', async () => {
    await seedUser('del-owner');
    await seedUser('del-a');
    await publish('del-owner', 'del-deck');
    await copyInto('del-a', 'del-copy', 'del-deck');
    await recountDeckCopies(['del-deck']);
    expect(await copyCount('del-deck')).toBe(1);

    await pool.query(
      `UPDATE user_decks SET data = NULL, deleted_at = 2 WHERE user_id = 'del-a' AND id = 'del-copy'`
    );
    await recountDeckCopies();
    expect(await copyCount('del-deck')).toBe(0);
  });

  it('leaves decks outside the given slugs alone', async () => {
    await seedUser('scope-owner');
    await publish('scope-owner', 'scope-in', 7);
    await publish('scope-owner', 'scope-out', 7);
    await recountDeckCopies(['scope-in']);
    expect(await copyCount('scope-in')).toBe(0);
    expect(await copyCount('scope-out')).toBe(7);
  });
});

describe('the sync hook recounts copies', () => {
  it('counts a copy the moment it syncs, and drops it when the copy is deleted', async () => {
    await seedUser('hook-owner');
    await seedUser('hook-a');
    await publish('hook-owner', 'hook-deck');
    await copyInto('hook-a', 'hook-copy', 'hook-deck');

    await refreshDeckPublications('hook-a', [
      { kind: 'deck', id: 'hook-copy', rev: 1, deletedAt: null },
    ]);
    expect(await copyCount('hook-deck')).toBe(1);

    await pool.query(
      `UPDATE user_decks SET data = NULL, deleted_at = 2 WHERE user_id = 'hook-a' AND id = 'hook-copy'`
    );
    await refreshDeckPublications('hook-a', [
      { kind: 'deck', id: 'hook-copy', rev: 2, deletedAt: 2 },
    ]);
    expect(await copyCount('hook-deck')).toBe(0);
  });
});

describe('user_decks.forked_from_slug', () => {
  async function storedSlug(userId: string, deckId: string): Promise<string | null> {
    const { rows } = await pool.query<{ forked_from_slug: string | null }>(
      `SELECT forked_from_slug FROM user_decks WHERE user_id = $1 AND id = $2`,
      [userId, deckId]
    );
    return rows[0].forked_from_slug;
  }

  it('follows the data blob through insert, edit and delete', async () => {
    await seedUser('gen-a');
    await copyInto('gen-a', 'gen-1', 'gen-deck');
    expect(await storedSlug('gen-a', 'gen-1')).toBe('gen-deck');

    await pool.query(`UPDATE user_decks SET data = $1 WHERE user_id = 'gen-a' AND id = 'gen-1'`, [
      JSON.stringify({ name: 'No longer a copy' }),
    ]);
    expect(await storedSlug('gen-a', 'gen-1')).toBeNull();

    await pool.query(
      `UPDATE user_decks SET data = NULL, deleted_at = 2 WHERE user_id = 'gen-a' AND id = 'gen-1'`
    );
    expect(await storedSlug('gen-a', 'gen-1')).toBeNull();
  });

  // The copy and trending scans read the generated column. Reading the slug
  // out of the blob at query time detoasts every deck in the table, which the
  // planner can't see (it costed that seq scan at ~8 against 150 ms real).
  it('is the only way a query reads the fork slug', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          const src = readFileSync(full, 'utf8');
          if (/data\s*->\s*'forkedFrom'/.test(src)) offenders.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    // The generated column's own definition is the one allowed reader.
    expect(offenders).toEqual(['db/schema-deck-fork-slug.ts']);
  });
});

describe('forkedFromSlug', () => {
  it('reads the slug a deck was copied from, and nothing else', () => {
    expect(forkedFromSlug({ forkedFrom: { slug: 'korvold' } })).toBe('korvold');
    expect(forkedFromSlug({ forkedFrom: { slug: '' } })).toBeNull();
    expect(forkedFromSlug({ forkedFrom: { slug: 3 } })).toBeNull();
    expect(forkedFromSlug({ name: 'no lineage' })).toBeNull();
    expect(forkedFromSlug(null)).toBeNull();
  });
});
