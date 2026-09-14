/**
 * Integration tests for the delta-sync API: GET /api/sync (paged pull since a
 * cursor) and POST /api/sync (apply upserts + tombstones, returns the canonical
 * revs the server assigned). Focuses on the invariants that the old whole-blob
 * model couldn't express — most importantly: a deletion on one device propagates
 * as a tombstone to a peer device on its next pull, never resurrected.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestEnv, extractSessionCookie } from '../test-helpers';

// Only the fire-and-forget test below overrides this (via mockRejectedValueOnce);
// every other test in this file falls through to the real hook, unmocked.
const { mockRefreshDeckPublications } = vi.hoisted(() => ({
  mockRefreshDeckPublications: vi.fn(),
}));
vi.mock('../publications/sync-hook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publications/sync-hook')>();
  mockRefreshDeckPublications.mockImplementation(actual.refreshDeckPublications);
  return { ...actual, refreshDeckPublications: mockRefreshDeckPublications };
});

let app: Server;
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
    counts?: Record<string, number>;
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
    cardGroupChecks?: Array<{ scryfallId: string; finish: string; baseline: string[] }>;
  }
) {
  const res = await request(app).post('/api/sync').set('Cookie', cookie).send(body);
  expect(res.status).toBe(200);
  return res.body as {
    applied: Array<{ kind: string; id: string; rev: number; deletedAt: number | null }>;
    conflicts: Array<{
      kind: 'deck' | 'card';
      id: string;
      serverRev: number;
      serverData: unknown;
      importId?: string;
    }>;
    cursor: number;
  };
}

/** Card row shape used by the E129 tests below — enough for a group check. */
function cardRow(copyId: string, scryfallId: string, finish = 'nonfoil') {
  return { kind: 'card', id: copyId, data: { copyId, scryfallId, finish }, importId: 'imp-1' };
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

  // `kind` used to be validated with `in`, which walks the prototype chain —
  // so these resolved to an Object.prototype member and got interpolated into
  // `INSERT INTO ${…}`, yielding a Postgres syntax error and a 500.
  it('rejects Object.prototype keys as a kind (400, never a 500)', async () => {
    const cookie = await registerAndGetCookie('push_proto_kind');
    for (const kind of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const upsert = await request(app)
        .post('/api/sync')
        .set('Cookie', cookie)
        .send({ upserts: [{ kind, id: 'x', data: {} }] });
      expect(upsert.status, `upsert kind=${kind}`).toBe(400);

      const del = await request(app)
        .post('/api/sync')
        .set('Cookie', cookie)
        .send({ deletions: [{ kind, id: 'x' }] });
      expect(del.status, `deletion kind=${kind}`).toBe(400);
    }
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

describe('live row counts on the pull (E291 drift detection)', () => {
  const SID = 'cccccccc-0000-0000-0000-000000000001';

  it('reports live rows per kind so a client can check itself against the account', async () => {
    const cookie = await registerAndGetCookie('pull_counts');
    await push(cookie, {
      upserts: [
        cardRow('c-1', SID),
        cardRow('c-2', SID),
        { kind: 'deck', id: 'd-1', data: { id: 'd-1', cards: [] } },
        { kind: 'binder', id: 'b-1', data: { id: 'b-1' } },
      ],
    });
    const view = await pull(cookie);
    expect(view.counts).toMatchObject({ card: 2, deck: 1, binder: 1, list: 0, cube: 0 });
  });

  it('counts live rows only — tombstones do not inflate it', async () => {
    const cookie = await registerAndGetCookie('pull_counts_tombstones');
    await push(cookie, { upserts: [cardRow('c-1', SID), cardRow('c-2', SID)] });
    await push(cookie, { deletions: [{ kind: 'card', id: 'c-1' }] });
    const view = await pull(cookie);
    expect(view.counts?.card).toBe(1);
  });

  it('reports the account total, not what this delta happened to carry', async () => {
    // The whole point: a client that pulled nothing still learns the real size.
    const cookie = await registerAndGetCookie('pull_counts_delta');
    await push(cookie, { upserts: [cardRow('c-1', SID), cardRow('c-2', SID)] });
    const first = await pull(cookie);
    const delta = await pull(cookie, first.cursor);
    expect(delta.rows).toHaveLength(0);
    expect(delta.counts?.card).toBe(2);
  });

  it('omits counts on a page that has more to come', async () => {
    // Counting on every page of a bootstrap would be wasted work.
    const cookie = await registerAndGetCookie('pull_counts_paged');
    await push(cookie, {
      upserts: [cardRow('c-1', SID), cardRow('c-2', SID), cardRow('c-3', SID)],
    });
    const page = await pull(cookie, 0, 2);
    expect(page.hasMore).toBe(true);
    expect(page.counts).toBeUndefined();
  });

  it("counts only the requesting user's rows", async () => {
    const mine = await registerAndGetCookie('pull_counts_mine');
    const theirs = await registerAndGetCookie('pull_counts_theirs');
    await push(mine, { upserts: [cardRow('c-1', SID)] });
    await push(theirs, { upserts: [cardRow('c-1', SID), cardRow('c-2', SID)] });
    expect((await pull(mine)).counts?.card).toBe(1);
    expect((await pull(theirs)).counts?.card).toBe(2);
  });
});

describe('POST /api/sync/clear-collection', () => {
  const SID = 'bbbbbbbb-0000-0000-0000-000000000001';

  it('requires auth', async () => {
    const res = await request(app).post('/api/sync/clear-collection');
    expect(res.status).toBe(401);
  });

  it('tombstones every card, import and list, and leaves decks and binders alone', async () => {
    const cookie = await registerAndGetCookie('clear_collection');
    await push(cookie, {
      upserts: [
        cardRow('c-1', SID),
        cardRow('c-2', SID),
        cardRow('c-3', SID),
        { kind: 'import', id: 'imp-1', data: { id: 'imp-1' } },
        { kind: 'list', id: 'l-1', data: { id: 'l-1' } },
        { kind: 'deck', id: 'd-1', data: { id: 'd-1', cards: [] } },
        { kind: 'binder', id: 'b-1', data: { id: 'b-1' } },
      ],
    });

    const res = await request(app).post('/api/sync/clear-collection').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.cleared).toEqual({ card: 3, import: 1, list: 1 });

    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.deletedAt == null);
    // The collection is gone; the account's decks and binders are not.
    expect(live.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(['binder:b-1', 'deck:d-1']);
  });

  it('clears rows this device could never have enumerated, and is idempotent', async () => {
    // The whole point: the client does not name the rows. Whatever the account
    // holds goes, including rows below any client's cursor.
    const cookie = await registerAndGetCookie('clear_collection_blind');
    await push(cookie, { upserts: [cardRow('c-1', SID), cardRow('c-2', SID)] });
    const first = await request(app).post('/api/sync/clear-collection').set('Cookie', cookie);
    expect(first.body.cleared.card).toBe(2);
    // Nothing left to clear — a repeat is a no-op, not an error.
    const second = await request(app).post('/api/sync/clear-collection').set('Cookie', cookie);
    expect(second.status).toBe(200);
    expect(second.body.cleared).toEqual({ card: 0, import: 0, list: 0 });
  });

  it('gives each tombstone its own rev so a delta pull delivers them in order', async () => {
    const cookie = await registerAndGetCookie('clear_collection_revs');
    await push(cookie, {
      upserts: [cardRow('c-1', SID), cardRow('c-2', SID), cardRow('c-3', SID)],
    });
    const before = await pull(cookie);
    const res = await request(app).post('/api/sync/clear-collection').set('Cookie', cookie);
    // Every tombstone is newer than the pre-clear cursor, so a device sitting at
    // that cursor picks the whole clear up as a normal delta.
    const delta = await pull(cookie, before.cursor);
    expect(delta.rows).toHaveLength(3);
    expect(delta.rows.every((r) => r.deletedAt != null && r.data == null)).toBe(true);
    const revs = delta.rows.map((r) => r.rev);
    expect([...revs].sort((a, b) => a - b)).toEqual(revs);
    expect(new Set(revs).size).toBe(3);
    expect(res.body.cursor).toBe(Math.max(...revs));
  });

  it("does not touch another user's collection", async () => {
    const mine = await registerAndGetCookie('clear_collection_mine');
    const theirs = await registerAndGetCookie('clear_collection_theirs');
    await push(mine, { upserts: [cardRow('c-1', SID)] });
    await push(theirs, { upserts: [cardRow('c-1', SID)] });
    await request(app).post('/api/sync/clear-collection').set('Cookie', mine);
    const view = await pull(theirs);
    expect(view.rows.filter((r) => r.deletedAt == null)).toHaveLength(1);
  });
});

describe('card printing-group reject-stale (E129)', () => {
  // Card rows are per-copy (one row per copyId); quantity is derived row
  // cardinality for a (scryfallId, finish) group. These cover the audit's
  // exact drift scenario: two devices add/remove DIFFERENT copyIds from a
  // stale shared baseline, which the server would otherwise silently union
  // to a total matching neither device's intent.
  const SCRYFALL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

  it('rejects the second device when a two-device quantity race is checked, instead of silently unioning', async () => {
    const cookie = await registerAndGetCookie('card_group_race');
    // Shared baseline: both devices last saw 3 copies of the same printing.
    const seed = await push(cookie, {
      upserts: [
        cardRow('c-1', SCRYFALL_ID),
        cardRow('c-2', SCRYFALL_ID),
        cardRow('c-3', SCRYFALL_ID),
      ],
    });
    expect(seed.applied).toHaveLength(3);
    const baseline = ['c-1', 'c-2', 'c-3'];

    // Device A: sets quantity 3 -> 5 (adds 2 copies), asserting the baseline.
    const a = await push(cookie, {
      upserts: [cardRow('c-4', SCRYFALL_ID), cardRow('c-5', SCRYFALL_ID)],
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline }],
    });
    expect(a.conflicts).toEqual([]);
    expect(a.applied).toHaveLength(2);

    // Device B: sets quantity 3 -> 4 (adds 1 copy) from the SAME stale
    // baseline — it pushes after A but doesn't know A already landed.
    const b = await push(cookie, {
      upserts: [cardRow('c-6', SCRYFALL_ID)],
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline }],
    });
    // B's baseline no longer matches the live group (A already grew it to 5)
    // — rejected as a conflict, never silently unioned to 6.
    expect(b.applied).toEqual([]);
    expect(b.conflicts).toHaveLength(1);
    expect(b.conflicts[0]).toMatchObject({
      kind: 'card',
      id: 'c-6',
      serverRev: 0,
      serverData: null,
    });

    // Final state matches a deterministic winner (A, who pushed first) — not
    // a union matching neither device's intent (6, or 7 per the audit's own
    // repro numbers).
    const view = await pull(cookie);
    const live = view.rows.filter(
      (r) =>
        r.kind === 'card' &&
        r.deletedAt == null &&
        (r.data as { scryfallId: string }).scryfallId === SCRYFALL_ID
    );
    expect(live.map((r) => r.id).sort()).toEqual(['c-1', 'c-2', 'c-3', 'c-4', 'c-5']);
  });

  it('checks many groups in one request independently — one stale group does not taint the rest', async () => {
    // A collection-wide delete sends up to 500 checks per batch, resolved by a
    // single grouped query. Every group must still be judged on its own
    // baseline, and a group the client under-claims must not spill staleness
    // onto its neighbours.
    const cookie = await registerAndGetCookie('card_group_many');
    const sid = (n: number) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
    await push(cookie, {
      upserts: [
        cardRow('a-1', sid(1)),
        cardRow('a-2', sid(1)),
        cardRow('b-1', sid(2)),
        cardRow('c-1', sid(3)),
      ],
    });
    // Another device already removed a-2, so group 1 is genuinely stale for a
    // client that still believes in it. Groups 2 and 3 are untouched.
    await push(cookie, { deletions: [{ kind: 'card', id: 'a-2' }] });
    const res = await push(cookie, {
      deletions: [
        { kind: 'card', id: 'a-1' },
        { kind: 'card', id: 'b-1' },
        { kind: 'card', id: 'c-1' },
      ],
      cardGroupChecks: [
        { scryfallId: sid(1), finish: 'nonfoil', baseline: ['a-1', 'a-2'] },
        { scryfallId: sid(2), finish: 'nonfoil', baseline: ['b-1'] },
        { scryfallId: sid(3), finish: 'nonfoil', baseline: ['c-1'] },
      ],
    });
    expect(res.conflicts.map((c) => c.id)).toEqual(['a-1']);
    expect(res.applied.map((r) => r.id).sort()).toEqual(['b-1', 'c-1']);
    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.kind === 'card' && r.deletedAt == null);
    expect(live.map((r) => r.id).sort()).toEqual(['a-1']);
  });

  it('applies normally when the asserted baseline still matches (no concurrent change)', async () => {
    const cookie = await registerAndGetCookie('card_group_ok');
    await push(cookie, { upserts: [cardRow('c-1', SCRYFALL_ID), cardRow('c-2', SCRYFALL_ID)] });
    const res = await push(cookie, {
      upserts: [cardRow('c-3', SCRYFALL_ID)],
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline: ['c-1', 'c-2'] }],
    });
    expect(res.conflicts).toEqual([]);
    expect(res.applied).toHaveLength(1);
  });

  it('rejects a delete when a copy the client believes in was already removed elsewhere', async () => {
    const cookie = await registerAndGetCookie('card_group_delete_race');
    await push(cookie, { upserts: [cardRow('c-1', SCRYFALL_ID), cardRow('c-2', SCRYFALL_ID)] });
    // Another device already took c-1 (its intended quantity: 2 -> 1).
    await push(cookie, { deletions: [{ kind: 'card', id: 'c-1' }] });

    // This device still believes the group is {c-1, c-2} and drops c-2, also
    // meaning 2 -> 1. Applying both would land on 0, which neither intended.
    const del = await push(cookie, {
      deletions: [{ kind: 'card', id: 'c-2' }],
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline: ['c-1', 'c-2'] }],
    });
    expect(del.applied).toEqual([]);
    expect(del.conflicts).toHaveLength(1);
    expect(del.conflicts[0]).toMatchObject({ kind: 'card', id: 'c-2', importId: 'imp-1' });
    expect((del.conflicts[0].serverData as { copyId: string }).copyId).toBe('c-2');

    // c-2 is still live server-side — the delete never landed.
    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.kind === 'card' && r.deletedAt == null);
    expect(live.map((r) => r.id).sort()).toEqual(['c-2']);
  });

  it('applies a delete from a client that only knows SOME of the group', async () => {
    // The user reported this as "select all, delete, it repopulates". A client
    // whose local view is a subset of the account named copies it really owns;
    // rejecting because the server holds others it never heard of made deleting
    // impossible, and a delta-pull client can be permanently partial (E291).
    const cookie = await registerAndGetCookie('card_group_partial_view');
    await push(cookie, {
      upserts: [
        cardRow('c-1', SCRYFALL_ID),
        cardRow('c-2', SCRYFALL_ID),
        cardRow('c-3', SCRYFALL_ID),
        cardRow('c-4', SCRYFALL_ID),
      ],
    });
    const del = await push(cookie, {
      deletions: [
        { kind: 'card', id: 'c-1' },
        { kind: 'card', id: 'c-2' },
      ],
      // Knows only the two it is deleting.
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline: ['c-1', 'c-2'] }],
    });
    expect(del.conflicts).toEqual([]);
    expect(del.applied.map((r) => r.id).sort()).toEqual(['c-1', 'c-2']);
    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.kind === 'card' && r.deletedAt == null);
    expect(live.map((r) => r.id).sort()).toEqual(['c-3', 'c-4']);
  });

  it('still rejects an ADD from that same partial view', async () => {
    // Adds are unchanged: the client is expressing a total, so an incomplete
    // view genuinely cannot compute the one it means.
    const cookie = await registerAndGetCookie('card_group_partial_add');
    await push(cookie, {
      upserts: [
        cardRow('c-1', SCRYFALL_ID),
        cardRow('c-2', SCRYFALL_ID),
        cardRow('c-3', SCRYFALL_ID),
      ],
    });
    const add = await push(cookie, {
      upserts: [cardRow('c-4', SCRYFALL_ID)],
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline: ['c-1', 'c-2'] }],
    });
    expect(add.applied).toEqual([]);
    expect(add.conflicts.map((c) => c.id)).toEqual(['c-4']);
  });

  it('judges an add and a delete in the same batch on their own terms', async () => {
    const cookie = await registerAndGetCookie('card_group_mixed_batch');
    await push(cookie, {
      upserts: [
        cardRow('c-1', SCRYFALL_ID),
        cardRow('c-2', SCRYFALL_ID),
        cardRow('c-3', SCRYFALL_ID),
      ],
    });
    const res = await push(cookie, {
      upserts: [cardRow('c-9', SCRYFALL_ID)],
      deletions: [{ kind: 'card', id: 'c-1' }],
      // Partial view: fine for the delete, fatal for the add.
      cardGroupChecks: [{ scryfallId: SCRYFALL_ID, finish: 'nonfoil', baseline: ['c-1', 'c-2'] }],
    });
    expect(res.conflicts.map((c) => c.id)).toEqual(['c-9']);
    expect(res.applied.map((r) => r.id)).toEqual(['c-1']);
    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.kind === 'card' && r.deletedAt == null);
    expect(live.map((r) => r.id).sort()).toEqual(['c-2', 'c-3']);
  });

  it('absent cardGroupChecks keeps unconditional last-write-wins (back-compat)', async () => {
    // An old client (or any push that opts out) never sends cardGroupChecks —
    // both devices' additions land unconditionally, reproducing the pre-E129
    // union exactly as before. Documents the behavior this PR does NOT change
    // for non-participating clients — mixed-version rollout stays safe.
    const cookie = await registerAndGetCookie('card_group_no_check');
    await push(cookie, {
      upserts: [
        cardRow('c-1', SCRYFALL_ID),
        cardRow('c-2', SCRYFALL_ID),
        cardRow('c-3', SCRYFALL_ID),
      ],
    });
    const a = await push(cookie, {
      upserts: [cardRow('c-4', SCRYFALL_ID), cardRow('c-5', SCRYFALL_ID)],
    });
    expect(a.conflicts).toEqual([]);
    const b = await push(cookie, { upserts: [cardRow('c-6', SCRYFALL_ID)] });
    expect(b.conflicts).toEqual([]);

    const view = await pull(cookie);
    const live = view.rows.filter((r) => r.kind === 'card' && r.deletedAt == null);
    // The union — 6, matching neither device's intended 5 or 4 — is exactly
    // the E129 audit's bug, deliberately preserved for clients that don't
    // opt in by sending cardGroupChecks.
    expect(live).toHaveLength(6);
  });

  it('rejects malformed cardGroupChecks', async () => {
    const cookie = await registerAndGetCookie('card_group_bad');
    const res = await request(app)
      .post('/api/sync')
      .set('Cookie', cookie)
      .send({ cardGroupChecks: [{ scryfallId: '', finish: 'nonfoil', baseline: [] }] });
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

  it('cascades a card upserted in the same batch as its import deletion (E67)', async () => {
    // The delete wins over the same-batch upsert — matching what would happen
    // if the upsert had landed in an earlier batch. The old pre-SELECT cascade
    // resolved cascade targets before applying upserts, so this card survived
    // as a live orphan under a tombstoned import.
    const cookie = await registerAndGetCookie('tomb_cascade_same_batch');
    await push(cookie, {
      upserts: [{ kind: 'import', id: 'imp-r', data: { id: 'imp-r' } }],
    });
    await push(cookie, {
      upserts: [{ kind: 'card', id: 'c-raced', data: { copyId: 'c-raced' }, importId: 'imp-r' }],
      deletions: [{ kind: 'import', id: 'imp-r' }],
    });
    const view = await pull(cookie);
    const card = view.rows.find((r) => r.kind === 'card' && r.id === 'c-raced');
    expect(card).toBeDefined();
    expect(card!.deletedAt).not.toBeNull();
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

describe('cube kind', () => {
  it('upserts a cube and retrieves it via delta pull', async () => {
    const cookie = await registerAndGetCookie('cube_upsert');
    const res = await push(cookie, {
      upserts: [{ kind: 'cube', id: 'cube-1', data: { id: 'cube-1', name: 'My Cube' } }],
    });
    expect(res.applied).toHaveLength(1);
    expect(res.applied[0].kind).toBe('cube');
    expect(res.applied[0].id).toBe('cube-1');
    expect(res.applied[0].rev).toBeGreaterThan(0);
    expect(res.applied[0].deletedAt).toBeNull();

    const view = await pull(cookie);
    const row = view.rows.find((r) => r.kind === 'cube' && r.id === 'cube-1')!;
    expect(row).toBeDefined();
    expect((row.data as { name: string }).name).toBe('My Cube');
    expect(row.deletedAt).toBeNull();
  });

  it('deletion tombstones a cube and propagates via delta pull', async () => {
    const cookie = await registerAndGetCookie('cube_delete');
    await push(cookie, {
      upserts: [{ kind: 'cube', id: 'cube-del', data: { id: 'cube-del', name: 'Doomed Cube' } }],
    });
    const afterUpsert = await pull(cookie);
    const cursorAfterUpsert = afterUpsert.cursor;

    await push(cookie, { deletions: [{ kind: 'cube', id: 'cube-del' }] });
    const afterDelete = await pull(cookie, cursorAfterUpsert);
    expect(afterDelete.rows).toHaveLength(1);
    expect(afterDelete.rows[0].id).toBe('cube-del');
    expect(afterDelete.rows[0].deletedAt).not.toBeNull();
    expect(afterDelete.rows[0].data).toBeNull();
  });
});

describe('publications refresh hook (fire-and-forget)', () => {
  it('still returns its normal 200 body for a deck upsert even when the hook throws', async () => {
    const cookie = await registerAndGetCookie('sync_hook_throws');
    const patch = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Hook Thrower' });
    expect(patch.status).toBe(200);
    await push(cookie, {
      upserts: [{ kind: 'deck', id: 'deck-hook', data: { id: 'deck-hook', name: 'Hook Deck' } }],
    });
    const published = await request(app)
      .post('/api/publications/decks/deck-hook')
      .set('Cookie', cookie);
    expect(published.status).toBe(201);

    mockRefreshDeckPublications.mockRejectedValueOnce(new Error('simulated hook failure'));
    const res = await push(cookie, {
      upserts: [
        { kind: 'deck', id: 'deck-hook', data: { id: 'deck-hook', name: 'Renamed Hook Deck' } },
      ],
    });
    expect(res.applied).toHaveLength(1);
    expect(res.applied[0].kind).toBe('deck');
    expect(res.cursor).toBeGreaterThan(0);
  });
});
