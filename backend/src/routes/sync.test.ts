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

async function pull(cookie: string, since = 0, limit = 5000) {
  const res = await request(app)
    .get(`/api/sync?since=${since}&limit=${limit}`)
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
    upserts?: Array<{ kind: string; id: string; data: unknown; importId?: string }>;
    deletions?: Array<{ kind: string; id: string }>;
  }
) {
  const res = await request(app).post('/api/sync').set('Cookie', cookie).send(body);
  expect(res.status).toBe(200);
  return res.body as {
    applied: Array<{ kind: string; id: string; rev: number; deletedAt: number | null }>;
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
