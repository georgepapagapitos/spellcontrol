import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import {
  rankTrendingDecks,
  loadEngagementEvents,
  ACTION_WEIGHTS,
  DECAY_RATE,
  MIN_PLAYERS,
  PLAYED_COPY_BONUS,
  TRENDING_DECKS_LIMIT,
  type EngagementEvent,
  type EngagementKind,
} from './trending-decks';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-09-26T12:00:00.000Z');

function event(
  slug: string,
  actorId: string,
  kind: EngagementKind = 'like',
  opts: { ageDays?: number; ownerId?: string; played?: boolean } = {}
): EngagementEvent {
  return {
    slug,
    ownerId: opts.ownerId ?? `owner-of-${slug}`,
    deckName: `Deck ${slug}`,
    commanderName: null,
    actorId,
    kind,
    at: now - (opts.ageDays ?? 0) * DAY_MS,
    played: opts.played ?? false,
  };
}

/** `n` distinct players each doing `kind` to `slug`. */
function crowd(slug: string, n: number, kind: EngagementKind = 'like', ownerId?: string) {
  return Array.from({ length: n }, (_, i) => event(slug, `${slug}-player-${i}`, kind, { ownerId }));
}

describe('rankTrendingDecks', () => {
  it('needs MIN_PLAYERS different accounts: one account doing everything is not a trend', () => {
    const oneFan = [
      event('solo', 'fan', 'like'),
      event('solo', 'fan', 'save'),
      event('solo', 'fan', 'copy', { played: true }),
    ];
    expect(rankTrendingDecks(oneFan, now)).toEqual([]);
    expect(rankTrendingDecks(crowd('almost', MIN_PLAYERS - 1), now)).toEqual([]);
    expect(rankTrendingDecks(crowd('enough', MIN_PLAYERS), now)).toMatchObject([
      { slug: 'enough', players: MIN_PLAYERS },
    ]);
  });

  it('weights a copy above a save above a like, and a played copy above all', () => {
    const [played] = rankTrendingDecks(
      [...crowd('p', 2, 'like'), event('p', 'x', 'copy', { played: true })],
      now
    );
    const [unplayed] = rankTrendingDecks([...crowd('u', 2, 'like'), event('u', 'x', 'copy')], now);
    expect(played.score - unplayed.score).toBeCloseTo(PLAYED_COPY_BONUS);
    expect(ACTION_WEIGHTS.copy).toBeGreaterThan(ACTION_WEIGHTS.save);
    expect(ACTION_WEIGHTS.save).toBeGreaterThan(ACTION_WEIGHTS.like);

    const ranked = rankTrendingDecks(
      [...crowd('liked', 3, 'like'), ...crowd('saved', 3, 'save'), ...crowd('copied', 3, 'copy')],
      now
    );
    expect(ranked.map((d) => d.slug)).toEqual(['copied', 'saved', 'liked']);
  });

  it('decays by day and ignores anything outside the week', () => {
    const [fresh] = rankTrendingDecks(crowd('fresh', 3), now);
    const [older] = rankTrendingDecks(
      Array.from({ length: 3 }, (_, i) => event('older', `o-${i}`, 'like', { ageDays: 2 })),
      now
    );
    expect(fresh.score).toBeCloseTo(3);
    expect(older.score).toBeCloseTo(3 * DECAY_RATE ** 2);

    const stale = Array.from({ length: 5 }, (_, i) =>
      event('stale', `s-${i}`, 'like', { ageDays: 7 })
    );
    expect(rankTrendingDecks(stale, now)).toEqual([]);
  });

  it('shows one deck per author, their best one', () => {
    const ranked = rankTrendingDecks(
      [
        ...crowd('a-best', 5, 'copy', 'author-a'),
        ...crowd('a-second', 4, 'copy', 'author-a'),
        ...crowd('b-only', 3, 'like', 'author-b'),
      ],
      now
    );
    expect(ranked.map((d) => d.slug)).toEqual(['a-best', 'b-only']);
  });

  it('caps the list', () => {
    const events = Array.from({ length: TRENDING_DECKS_LIMIT + 3 }, (_, i) =>
      crowd(`d${i}`, 3)
    ).flat();
    expect(rankTrendingDecks(events, now)).toHaveLength(TRENDING_DECKS_LIMIT);
  });
});

describe('loadEngagementEvents (db)', () => {
  let pool: Pool;
  let cleanup: () => Promise<void>;
  const t = Date.now();

  beforeAll(async () => {
    const env = await createTestEnv();
    pool = env.pool;
    cleanup = env.cleanup;
    for (const id of ['owner', 'liker', 'saver', 'copier', 'late-copier']) {
      await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $1, 1)`, [id]);
    }
    await pool.query(
      `INSERT INTO deck_publications (user_id, deck_id, slug, deck_name, commander_name, format, published_at, updated_at)
       VALUES ('owner', 'live', 'live', 'Live Deck', 'Atraxa', 'commander', 1, 1)`
    );
    await pool.query(
      `INSERT INTO deck_publications (user_id, deck_id, slug, deck_name, format, published_at, updated_at, unpublished_at)
       VALUES ('owner', 'gone', 'gone', 'Gone Deck', 'commander', 1, 1, 2)`
    );
    const like = `INSERT INTO deck_likes (user_id, slug, deck_owner_id, created_at) VALUES ($1, $2, 'owner', $3)`;
    await pool.query(like, ['liker', 'live', t]);
    await pool.query(like, ['owner', 'live', t]); // self-like
    await pool.query(like, ['liker', 'gone', t]); // unpublished deck
    await pool.query(like, ['saver', 'live', t - 8 * DAY_MS]); // outside the week
    await pool.query(
      `INSERT INTO deck_bookmarks (user_id, slug, deck_owner_id, created_at) VALUES ('saver', 'live', 'owner', $1)`,
      [t]
    );
    const copy = `INSERT INTO user_decks (user_id, id, data, rev, deleted_at, updated_at) VALUES ($1, $2, $3, 1, $4, 1)`;
    const fork = (createdAt: unknown) =>
      JSON.stringify({ createdAt, forkedFrom: { slug: 'live' } });
    await pool.query(copy, ['copier', 'copy-1', fork(t), null]);
    await pool.query(copy, ['late-copier', 'copy-old', fork(t - 9 * DAY_MS), null]);
    await pool.query(copy, ['late-copier', 'copy-bad', fork('yesterday'), null]); // malformed
    await pool.query(copy, ['owner', 'own-copy', fork(t), null]); // owner copying own deck
    await pool.query(
      `INSERT INTO user_games (user_id, id, data, rev, updated_at) VALUES ('copier', 'g1', $1, 1, 1)`,
      [
        JSON.stringify({
          players: [
            { deckId: 'copy-1', name: 'me' },
            { deckId: null, name: 'guest' },
          ],
        }),
      ]
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('reads likes, saves and played copies by other players on live decks in the window', async () => {
    const events = await loadEngagementEvents(t + 1000);
    const summary = events.map((e) => `${e.actorId}:${e.kind}:${e.played}`).sort();
    expect(summary).toEqual(['copier:copy:true', 'liker:like:false', 'saver:save:false']);
    expect(events[0]).toMatchObject({
      slug: 'live',
      ownerId: 'owner',
      deckName: 'Live Deck',
      commanderName: 'Atraxa',
    });
  });

  it('reports an unplayed copy as unplayed', async () => {
    await pool.query(`UPDATE user_games SET deleted_at = 5, data = NULL WHERE id = 'g1'`);
    const events = await loadEngagementEvents(t + 1000);
    expect(events.find((e) => e.kind === 'copy')?.played).toBe(false);
  });
});
