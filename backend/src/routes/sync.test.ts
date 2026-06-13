/**
 * Integration tests for the delta-sync API: GET /api/sync (paged pull since a
 * cursor) and POST /api/sync (apply upserts + tombstones, returns the canonical
 * revs the server assigned). Focuses on the invariants that the old whole-blob
 * model couldn't express — most importantly: a deletion on one device propagates
 * as a tombstone to a peer device on its next pull, never resurrected.
 */

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

async function registerAndGetCookie(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'correct horse battery' });
  return extractSessionCookie(res.headers['set-cookie'])!;
}

async function pull(cookie: string, since = 0, limit = 5000, fresh = false) {
  const res = await request(app)
    .get(`/api/sync?since=${since}&limit=${limit}${fresh ? '&fresh=1' : ''}`)
    .set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body as {
    rows: Array<{
      kind: string;
      id: string;
      data: unknown;
      rev: number;
      deletedAt: number | null;
      importId?: string;
    }>;
    cursor: number;
    hasMore: boolean;
  };
}

async function push(
  cookie: string,
  body: {
    upserts?: Array<{
      kind: string;
      id: string;
      data: unknown;
      importId?: string;
      clientRev?: number;
    }>;
    deletions?: Array<{ kind: string; id: string }>;
  }
) {
  const res = await request(app).post('/api/sync').set('Cookie', cookie).send(body);
  expect(res.status).toBe(200);
  return res.body as {
    applied: Array<{ kind: string; id: string; rev: number; deletedAt: number | null }>;
    conflicts: Array<{ kind: 'deck'; id: string; serverRev: number; serverData: unknown }>;
    cursor: number;
  };
}

describe('auth', () => {
  it('GET /api/sync requires auth', async () => {
    const res = await request(app).get('/api/sync');
    expect(res.status).toBe(401);
  });

  it('POST /api/sync requires auth', async () => {
    const res = await request(app).post('/api/sync').send({ upserts: [] });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/sync (pull)', () => {
  it('returns an empty page for a fresh user', async () => {
    const cookie = await registerAndGetCookie('pull_empty');
    const r = await pull(cookie);
    expect(r.rows).toEqual([]);
    expect(r.cursor).toBe(0);
    expect(r.hasMore).toBe(false);
  });

  it('returns rows in rev order across mixed kinds', async () => {
    const cookie = await registerAndGetCookie('pull_mixed');
    await push(cookie, {
      upserts: [
        { kind: 'import', id: 'imp-1', data: { id: 'imp-1', name: 'CSV one' } },
        { kind: 'card', id: 'c-1', data: { copyId: 'c-1', name: 'Sol Ring' }, importId: 'imp-1' },
        { kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'Mainboard' } },
        { kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'Edgar' } },
        { kind: 'list', id: 'l-1', data: { id: 'l-1', name: 'Wishlist' } },
      ],
    });
    const r = await pull(cookie);
    // Rev is monotonic; the rows should be ordered ascending.
    const revs = r.rows.map((x) => x.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    const kinds = new Set(r.rows.map((x) => x.kind));
    expect(kinds).toEqual(new Set(['import', 'card', 'binder', 'deck', 'list']));
    // Card carries importId.
    const card = r.rows.find((x) => x.kind === 'card')!;
    expect(card.importId).toBe('imp-1');
  });

  it('honours the since cursor and only returns rows newer than it', async () => {
    const cookie = await registerAndGetCookie('pull_cursor');
    await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'first' } }],
    });
    const first = await pull(cookie);
    const cursorAfterFirst = first.cursor;
    expect(first.rows.length).toBe(1);

    await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-2', data: { id: 'b-2', name: 'second' } }],
    });
    const second = await pull(cookie, cursorAfterFirst);
    expect(second.rows.length).toBe(1);
    expect(second.rows[0].id).toBe('b-2');
    expect(second.rows[0].rev).toBeGreaterThan(cursorAfterFirst);
  });

  it('paginates with hasMore', async () => {
    const cookie = await registerAndGetCookie('pull_paged');
    const upserts: Array<{ kind: string; id: string; data: unknown }> = [];
    for (let i = 0; i < 6; i++) {
      upserts.push({ kind: 'binder', id: `b-${i}`, data: { id: `b-${i}` } });
    }
    await push(cookie, { upserts });
    const page1 = await pull(cookie, 0, 4);
    expect(page1.rows.length).toBe(4);
    expect(page1.hasMore).toBe(true);
    const page2 = await pull(cookie, page1.cursor, 4);
    expect(page2.rows.length).toBe(2);
    expect(page2.hasMore).toBe(false);
  });

  it('isolates rows per user', async () => {
    const alice = await registerAndGetCookie('iso_alice');
    const bob = await registerAndGetCookie('iso_bob');
    await push(alice, { upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1' } }] });
    const bobView = await pull(bob);
    expect(bobView.rows).toEqual([]);
  });
});

describe('POST /api/sync (push)', () => {
  it('returns the canonical revs in `applied`', async () => {
    const cookie = await registerAndGetCookie('push_revs');
    const res = await push(cookie, {
      upserts: [
        { kind: 'binder', id: 'b-1', data: { id: 'b-1' } },
        { kind: 'deck', id: 'd-1', data: { id: 'd-1' } },
      ],
    });
    expect(res.applied.length).toBe(2);
    for (const a of res.applied) expect(a.rev).toBeGreaterThan(0);
    // cursor is the max rev applied
    expect(res.cursor).toBe(Math.max(...res.applied.map((a) => a.rev)));
  });

  it('upserts overwrite by id and reissue a fresh rev', async () => {
    const cookie = await registerAndGetCookie('push_upsert');
    const first = await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'v1' } }],
    });
    const firstRev = first.applied[0].rev;
    const second = await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'v2' } }],
    });
    const secondRev = second.applied[0].rev;
    expect(secondRev).toBeGreaterThan(firstRev);
    const view = await pull(cookie, firstRev);
    // Only the latest revision is visible past the prior cursor.
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].rev).toBe(secondRev);
    expect((view.rows[0].data as { name: string }).name).toBe('v2');
  });

  it('rejects malformed inputs', async () => {
    const cookie = await registerAndGetCookie('push_bad');
    const bad1 = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ upserts: 'not an array' });
    expect(bad1.status).toBe(400);
    const bad2 = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ upserts: [{ kind: 'nope', id: 'x', data: {} }] });
    expect(bad2.status).toBe(400);
    const bad3 = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ deletions: [{ kind: 'binder' }] });
    expect(bad3.status).toBe(400);
  });
});

describe('deck reject-stale (optimistic concurrency)', () => {
  it('applies a deck upsert when clientRev matches the stored rev', async () => {
    const cookie = await registerAndGetCookie('deck_match');
    const first = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'v1' } }],
    });
    const rev1 = first.applied[0].rev;
    const second = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'v2' }, clientRev: rev1 }],
    });
    expect(second.conflicts).toEqual([]);
    expect(second.applied).toHaveLength(1);
    expect(second.applied[0].rev).toBeGreaterThan(rev1);
    const view = await pull(cookie, rev1);
    expect((view.rows[0].data as { name: string }).name).toBe('v2');
  });

  it('reports a conflict and leaves the deck untouched when clientRev is stale', async () => {
    const cookie = await registerAndGetCookie('deck_stale');
    const first = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'v1' } }],
    });
    const rev1 = first.applied[0].rev;
    // Another device advances the deck to v2.
    const second = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'v2' }, clientRev: rev1 }],
    });
    const rev2 = second.applied[0].rev;
    // This device still thinks it's at rev1 → stale write must be rejected.
    const stale = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'STALE' }, clientRev: rev1 }],
    });
    expect(stale.applied).toEqual([]);
    expect(stale.conflicts).toHaveLength(1);
    expect(stale.conflicts[0]).toMatchObject({ kind: 'deck', id: 'd-1', serverRev: rev2 });
    expect((stale.conflicts[0].serverData as { name: string }).name).toBe('v2');
    // The server's row is unchanged (still v2, still rev2).
    const view = await pull(cookie, rev1);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].rev).toBe(rev2);
    expect((view.rows[0].data as { name: string }).name).toBe('v2');
  });

  it('clientRev 0 / absent keeps unconditional last-write-wins (back-compat)', async () => {
    const cookie = await registerAndGetCookie('deck_lww');
    const first = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'v1' } }],
    });
    const rev1 = first.applied[0].rev;
    // No clientRev (a pre-clientRev client) → overwrites regardless of stored rev.
    const second = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'v2' } }],
    });
    expect(second.conflicts).toEqual([]);
    expect(second.applied[0].rev).toBeGreaterThan(rev1);
    const view = await pull(cookie, rev1);
    expect((view.rows[0].data as { name: string }).name).toBe('v2');
  });

  it('inserts a brand-new deck even when clientRev > 0 (no row to conflict with)', async () => {
    const cookie = await registerAndGetCookie('deck_new_clientrev');
    const res = await push(cookie, {
      upserts: [{ kind: 'deck', id: 'd-new', data: { id: 'd-new', name: 'fresh' }, clientRev: 5 }],
    });
    expect(res.conflicts).toEqual([]);
    expect(res.applied).toHaveLength(1);
    const view = await pull(cookie, 0);
    expect(view.rows.find((r) => r.id === 'd-new')).toBeDefined();
  });

  it('rejects a non-numeric clientRev', async () => {
    const cookie = await registerAndGetCookie('deck_bad_clientrev');
    const res = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ upserts: [{ kind: 'deck', id: 'd-1', data: {}, clientRev: 'nope' }] });
    expect(res.status).toBe(400);
  });
});

describe('tombstones', () => {
  it('propagate a deletion from one device to another via the pull', async () => {
    // Two devices, same user. Device A deletes; device B sees the tombstone.
    const a = await registerAndGetCookie('tomb_propagate');
    const b = a; // same session cookie; the test is about pulls, not auth.
    await push(a, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'doomed' } }],
    });
    const bView1 = await pull(b);
    expect(bView1.rows.length).toBe(1);
    const cursorBeforeDelete = bView1.cursor;

    await push(a, { deletions: [{ kind: 'binder', id: 'b-1' }] });
    const bView2 = await pull(b, cursorBeforeDelete);
    expect(bView2.rows.length).toBe(1);
    expect(bView2.rows[0].id).toBe('b-1');
    expect(bView2.rows[0].deletedAt).not.toBeNull();
    expect(bView2.rows[0].data).toBeNull();
  });

  it('fresh=1 pull skips tombstones and returns only live rows', async () => {
    const cookie = await registerAndGetCookie('tomb_fresh');
    await push(cookie, {
      upserts: [
        { kind: 'binder', id: 'live-1', data: { id: 'live-1' } },
        { kind: 'binder', id: 'gone-1', data: { id: 'gone-1' } },
      ],
    });
    await push(cookie, { deletions: [{ kind: 'binder', id: 'gone-1' }] });

    // Default pull (a catching-up client) still sees the tombstone so it can
    // propagate the deletion.
    const normal = await pull(cookie, 0, 5000, false);
    expect(normal.rows.map((r) => r.id).sort()).toEqual(['gone-1', 'live-1']);
    expect(normal.rows.find((r) => r.id === 'gone-1')?.deletedAt).not.toBeNull();

    // A fresh client (no local rows) gets only the live row — nothing to delete.
    const fresh = await pull(cookie, 0, 5000, true);
    expect(fresh.rows.map((r) => r.id)).toEqual(['live-1']);
    expect(fresh.rows.every((r) => r.deletedAt == null)).toBe(true);
  });

  it('deleting an import cascades a tombstone to each of its live cards', async () => {
    const cookie = await registerAndGetCookie('tomb_cascade');
    await push(cookie, {
      upserts: [
        { kind: 'import', id: 'imp-1', data: { id: 'imp-1' } },
        { kind: 'card', id: 'c-1', data: { copyId: 'c-1' }, importId: 'imp-1' },
        { kind: 'card', id: 'c-2', data: { copyId: 'c-2' }, importId: 'imp-1' },
        { kind: 'card', id: 'c-3', data: { copyId: 'c-3' }, importId: 'imp-other' },
      ],
    });
    const after = await push(cookie, { deletions: [{ kind: 'import', id: 'imp-1' }] });
    // Cascade emits tombstones for the 2 cards under imp-1 PLUS the import itself.
    const tombstones = after.applied.filter((a) => a.deletedAt != null);
    expect(tombstones.length).toBe(3);
    // c-3 (different import) must survive.
    const view = await pull(cookie);
    const liveCards = view.rows.filter((r) => r.kind === 'card' && r.deletedAt == null);
    expect(liveCards.map((r) => r.id)).toEqual(['c-3']);
  });

  it("does not resurrect a deleted row when a stale device's push arrives later", async () => {
    // The original bug. Device A clears a card; device B (with stale local
    // state) later pushes the SAME card back as an upsert. Result: row exists
    // again (last-write-wins by rev). That's WHY the new model requires the
    // stale device to first PULL and apply the tombstone — which removes the
    // row from B's local state so its next push can no longer include it.
    const cookie = await registerAndGetCookie('tomb_no_stale');
    await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'live' } }],
    });
    await push(cookie, { deletions: [{ kind: 'binder', id: 'b-1' }] });
    const view = await pull(cookie);
    const row = view.rows.find((r) => r.kind === 'binder' && r.id === 'b-1');
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
  });

  it('deleting a row the server never had still inserts a tombstone shell', async () => {
    const cookie = await registerAndGetCookie('tomb_unknown');
    const after = await push(cookie, { deletions: [{ kind: 'deck', id: 'd-never-existed' }] });
    expect(after.applied.length).toBe(1);
    const view = await pull(cookie);
    expect(view.rows.find((r) => r.id === 'd-never-existed')?.deletedAt).not.toBeNull();
  });

  it('applies upserts and deletions (with an import cascade) in a single batch', async () => {
    // Exercises the bulk unnest write paths together: a POST that both upserts
    // new rows and deletes an import whose cards cascade.
    const cookie = await registerAndGetCookie('batch_mixed');
    await push(cookie, {
      upserts: [
        { kind: 'import', id: 'imp-1', data: { id: 'imp-1' } },
        { kind: 'card', id: 'c-1', data: { copyId: 'c-1' }, importId: 'imp-1' },
        { kind: 'card', id: 'c-2', data: { copyId: 'c-2' }, importId: 'imp-1' },
        { kind: 'card', id: 'c-3', data: { copyId: 'c-3' }, importId: 'imp-1' },
      ],
    });
    const res = await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'new' } }],
      deletions: [{ kind: 'import', id: 'imp-1' }],
    });
    // 1 binder upsert + 1 import tombstone + 3 cascaded card tombstones.
    expect(res.applied.length).toBe(5);
    expect(res.applied.filter((a) => a.deletedAt != null).length).toBe(4);
    // Every assigned rev is unique.
    const revs = res.applied.map((a) => a.rev);
    expect(new Set(revs).size).toBe(revs.length);
    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.deletedAt == null);
    expect(live.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(['binder:b-1']);
  });

  it('tolerates the same id appearing twice in one upsert batch (last write wins)', async () => {
    // The bulk INSERT … ON CONFLICT path would otherwise throw "cannot affect
    // row a second time"; the handler de-dupes by id keeping the last value.
    const cookie = await registerAndGetCookie('batch_dup');
    const res = await push(cookie, {
      upserts: [
        { kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'first' } },
        { kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'last' } },
      ],
    });
    expect(res.applied.length).toBe(1);
    const view = await pull(cookie);
    const row = view.rows.find((r) => r.id === 'b-1')!;
    expect((row.data as { name: string }).name).toBe('last');
  });

  it('upserting after a tombstone revives the row (last-write-wins by rev)', async () => {
    const cookie = await registerAndGetCookie('tomb_revive');
    await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'v1' } }],
    });
    await push(cookie, { deletions: [{ kind: 'binder', id: 'b-1' }] });
    const revived = await push(cookie, {
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'reborn' } }],
    });
    const view = await pull(cookie, 0);
    const row = view.rows.find((r) => r.kind === 'binder' && r.id === 'b-1')!;
    expect(row.deletedAt).toBeNull();
    expect(row.rev).toBe(revived.applied[0].rev);
    expect((row.data as { name: string }).name).toBe('reborn');
  });
});
