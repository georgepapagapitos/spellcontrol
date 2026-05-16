// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authApi from './auth-api';
import * as combosApi from './api/combos';
import { startSync, stopSyncAndWipeLocal, flushSync } from './sync';
import { markDestructive } from './sync-intent';
import { saveCollection, clearCollection, loadCollection } from './local-cards';
import * as localCards from './local-cards';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';

beforeEach(async () => {
  // Detach any subscribers and reset module-level sync state left by a
  // previous test before we start mocking the next one.
  await stopSyncAndWipeLocal();
  await clearCollection();
  vi.restoreAllMocks();
  localStorage.clear();
  // Default: silent putSync; individual tests override.
  vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 1, updatedAt: 0 });
  useCollectionStore.setState({
    binders: [],
    cards: [],
    fileName: '',
    scryfallHits: 0,
    scryfallMisses: 0,
    uploadedAt: null,
    importHistory: [],
    hydrating: false,
  });
  useDecksStore.setState({ decks: [], hydrated: true });
  usePlayStore.setState({ history: [], local: null, hydrated: true });
});

describe('startSync', () => {
  it('overwrites stores with the server snapshot (no merge)', async () => {
    // Local has stale state that should be replaced wholesale.
    useCollectionStore.setState({
      binders: [
        { id: 'old', name: 'Local Stale', createdAt: 1, updatedAt: 1, position: 0 } as never,
      ],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'remote.csv',
        cards: [],
        scryfallHits: 0,
        scryfallMisses: 0,
        uploadedAt: 123,
        importHistory: [],
      },
      binders: [{ id: 'b1', name: 'Server binder', createdAt: 100, updatedAt: 100, position: 0 }],
      decks: [{ id: 'd1', name: 'Server deck', createdAt: 100, updatedAt: 100 }],
      version: 3,
      updatedAt: 999,
    });
    await startSync('user-1');
    expect(useCollectionStore.getState().binders).toHaveLength(1);
    expect(useCollectionStore.getState().binders[0]).toMatchObject({ name: 'Server binder' });
    expect(useCollectionStore.getState().fileName).toBe('remote.csv');
    expect(useDecksStore.getState().decks[0]).toMatchObject({ name: 'Server deck' });
  });

  it('pushes NON-blank locally dirty state before overwriting from server', async () => {
    // A surviving dirty flag after reload is only honored when the local state
    // is non-blank. The destructive-intent latch is in-memory and cannot
    // survive a reload, so a *blank* dirty state can no longer be told apart
    // from a bad empty hydrate — see the blank-push guard test below. A real
    // local change (a non-empty binder set) still propagates as before.
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-base-version', '2');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    useCollectionStore.setState({
      binders: [{ id: 'local', name: 'Edited', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });

    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 3, updatedAt: 100 });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 3,
      updatedAt: 100,
    });

    await startSync('user-1');

    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersion: 2,
        binders: [expect.objectContaining({ id: 'local' })],
      })
    );
    expect(localStorage.getItem('spellcontrol-sync-dirty')).toBeNull();
  });

  it('backfills oracleId on collection cards from /api/cards/oracle-ids', async () => {
    // Two cards present locally — one missing oracleId (should be backfilled)
    // and one already has it (should be left alone).
    useCollectionStore.setState({
      cards: [
        { copyId: 'c1', name: 'Old Card', scryfallId: 'sf-1', sourceFormat: 'manual' } as never,
        {
          copyId: 'c2',
          name: 'Newer',
          scryfallId: 'sf-2',
          oracleId: 'oracle-existing',
          sourceFormat: 'manual',
        } as never,
      ],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: 0,
    });
    const oracleSpy = vi
      .spyOn(combosApi, 'fetchOracleIds')
      .mockResolvedValue({ 'sf-1': 'oracle-new' });

    await startSync('user-1');
    // Backfill is fire-and-forget; flush microtasks until the patched cards land.
    for (let i = 0; i < 30 && !useCollectionStore.getState().cards[0].oracleId; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(oracleSpy).toHaveBeenCalledWith(['sf-1']);
    const after = useCollectionStore.getState().cards;
    expect(after[0].oracleId).toBe('oracle-new');
    expect(after[1].oracleId).toBe('oracle-existing');
  });

  it('skips the oracle-id backfill when every card already has an oracleId', async () => {
    useCollectionStore.setState({
      cards: [
        {
          copyId: 'c1',
          name: 'Has it',
          scryfallId: 'sf-1',
          oracleId: 'oracle-1',
          sourceFormat: 'manual',
        } as never,
      ],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: 0,
    });
    const oracleSpy = vi.spyOn(combosApi, 'fetchOracleIds').mockResolvedValue({});

    await startSync('user-1');
    await new Promise((r) => setTimeout(r, 20));

    expect(oracleSpy).not.toHaveBeenCalled();
  });

  it('keeps the original cards when the oracle-id backfill request rejects', async () => {
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', name: 'Old', scryfallId: 'sf-1', sourceFormat: 'manual' } as never],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: 0,
    });
    vi.spyOn(combosApi, 'fetchOracleIds').mockRejectedValue(new Error('boom'));
    // The backfill swallows + warns; suppress so the test output is clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await startSync('user-1');
    await new Promise((r) => setTimeout(r, 20));

    expect(useCollectionStore.getState().cards[0].oracleId).toBeUndefined();
  });

  it('wipes local state when the persisted owner differs from the current user', async () => {
    localStorage.setItem('spellcontrol-sync-owner', 'user-A');
    useCollectionStore.setState({
      binders: [{ id: 'b', name: 'A data', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [{ id: 'fresh', name: 'B data', createdAt: 2, updatedAt: 2, position: 0 }],
      decks: [],
      games: [],
      version: 1,
      updatedAt: 0,
    });

    await startSync('user-B');

    const binders = useCollectionStore.getState().binders;
    expect(binders).toHaveLength(1);
    expect(binders[0].id).toBe('fresh');
    expect(localStorage.getItem('spellcontrol-sync-owner')).toBe('user-B');
  });
});

describe('cache hydration safety', () => {
  it('hydrates IndexedDB cards into the store before pushing (the #153 regression)', async () => {
    // The scenario that wiped collections in prod: an existing authed user
    // refreshes after a deploy. zustand persist has binders; IndexedDB has
    // cards; the new OWNER_KEY/VERSION_KEY are absent. Previously, the auto-
    // dirty branch fired pushNow() before IndexedDB was read, so the push
    // sent collection: null and nuked the server.
    await saveCollection({
      fileName: 'mine.csv',
      cards: [{ copyId: 'c1', name: 'Lightning Bolt' } as never],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 100,
      importHistory: [],
    });
    // Pre-deploy state: binders persisted via zustand, but cards still in
    // IndexedDB and not yet loaded into the store.
    useCollectionStore.setState({
      binders: [{ id: 'b1', name: 'My binder', createdAt: 1, updatedAt: 1, position: 0 } as never],
      cards: [],
      fileName: '',
      uploadedAt: null,
    });
    // Server has the user's data already.
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'mine.csv',
        cards: [{ copyId: 'c1', name: 'Lightning Bolt' } as never],
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 100,
        importHistory: [],
      },
      binders: [{ id: 'b1', name: 'My binder', createdAt: 1, updatedAt: 1, position: 0 }],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 100 });

    await startSync('user-1');

    // Even if a push did fire for any reason, it MUST carry the cards from
    // IndexedDB — never null.
    for (const call of putSpy.mock.calls) {
      const payload = call[0];
      if (payload.collection !== null) {
        expect((payload.collection as { cards: unknown[] }).cards.length).toBeGreaterThan(0);
      }
    }
    // Store reflects the IndexedDB collection.
    expect(useCollectionStore.getState().cards).toHaveLength(1);
    expect(useCollectionStore.getState().fileName).toBe('mine.csv');
  });

  it('promotes local data to a fresh server account instead of wiping it', async () => {
    // Guest-promotion scenario: a user just signed up. Their local persist
    // and IndexedDB have content; the server account is empty.
    await saveCollection({
      fileName: 'guest.csv',
      cards: [{ copyId: 'c1' } as never],
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: 50,
      importHistory: [],
    });
    useCollectionStore.setState({
      binders: [
        { id: 'gb', name: 'Guest binder', createdAt: 1, updatedAt: 1, position: 0 } as never,
      ],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 1, updatedAt: 100 });

    await startSync('new-user');

    expect(putSpy).toHaveBeenCalled();
    const pushedAny = putSpy.mock.calls.some(
      (call) =>
        Array.isArray(call[0].binders) && call[0].binders.length > 0 && call[0].collection !== null
    );
    expect(pushedAny).toBe(true);
    // Store retains the local data — server's empty snapshot was NOT applied.
    expect(useCollectionStore.getState().binders).toHaveLength(1);
    expect(useCollectionStore.getState().cards).toHaveLength(1);
  });

  it('does not wipe IndexedDB when the server returns an empty snapshot and local has data', async () => {
    await saveCollection({
      fileName: 'mine.csv',
      cards: [{ copyId: 'c1' } as never],
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: 100,
      importHistory: [],
    });
    useCollectionStore.setState({
      binders: [{ id: 'b1', name: 'b', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: 0,
    });
    vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 1, updatedAt: 100 });

    await startSync('user-1');

    // The post-fetch guest-promotion path keeps local data, doesn't wipe.
    expect(useCollectionStore.getState().cards).toHaveLength(1);
    expect(useCollectionStore.getState().binders).toHaveLength(1);
  });

  it('server lost the collection but kept binders: keeps local cards and re-pushes them (the "loads then wipes after 2s" report)', async () => {
    // Exact production scenario from the [sync] logs: IndexedDB still has the
    // collection (it shows for ~2s after hydrate), but the server returns
    // collection=null with binders>0. isServerEmpty() is false because of the
    // binders, so the whole-snapshot promotion does NOT fire. Applying the
    // snapshot would blank the in-memory cards.
    await saveCollection({
      fileName: 'mine.csv',
      cards: [{ copyId: 'c1', name: 'Sol Ring' } as never],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 100,
      importHistory: [],
    });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [{ id: 'b1', name: 'Server binder', createdAt: 1, updatedAt: 1, position: 0 }],
      decks: [],
      games: [],
      version: 72,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 73, updatedAt: 0 });

    await startSync('user-1');

    // Collection is NOT wiped — kept from IndexedDB.
    expect(useCollectionStore.getState().cards).toHaveLength(1);
    expect(useCollectionStore.getState().fileName).toBe('mine.csv');
    // Server's other slices were still applied.
    expect(useCollectionStore.getState().binders).toHaveLength(1);
    expect(useCollectionStore.getState().binders[0]).toMatchObject({ name: 'Server binder' });
    // And the kept collection was pushed back up to repair the server — the
    // push must carry the real cards, never null, on the server's version.
    expect(putSpy).toHaveBeenCalled();
    const repair = putSpy.mock.calls.at(-1)![0];
    expect(repair.baseVersion).toBe(72);
    expect(repair.collection).not.toBeNull();
    expect((repair.collection as { cards: unknown[] }).cards).toHaveLength(1);
    // Local IndexedDB copy still intact.
    expect((await loadCollection())?.cards).toHaveLength(1);
  });
});

describe('blank-push guard (the root invariant: empty != truth)', () => {
  it('refuses to push a blank-slate snapshot over the server and adopts server data instead', async () => {
    // Reproduces the production logs: a wiped/empty client (post sign-out
    // re-login) is dirty and would PUT collection=null binders=0 over a
    // populated server.
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-base-version', '74');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    // Store is empty (the beforeEach default) — nothing in IndexedDB either.

    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 99, updatedAt: 0 });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'mine.csv',
        cards: [{ copyId: 'c1', name: 'Sol Ring' } as never],
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 100,
        importHistory: [],
      },
      binders: [{ id: 'b1', name: 'Server binder', createdAt: 1, updatedAt: 1, position: 0 }],
      decks: [],
      games: [],
      version: 74,
      updatedAt: 0,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await startSync('user-1');

    // The blank push was refused — the server was never overwritten.
    expect(putSpy).not.toHaveBeenCalled();
    // And the device adopted the server's real data.
    expect(useCollectionStore.getState().cards).toHaveLength(1);
    expect(useCollectionStore.getState().binders[0]).toMatchObject({ name: 'Server binder' });
  });

  it('still pushes an empty snapshot when an explicit user deletion (clearCards) produced it', async () => {
    // The guard must NOT break a real "Clear all" — that emptiness is intended
    // and must propagate.
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'mine.csv',
        cards: [{ copyId: 'c1' }] as never,
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 1,
        importHistory: [],
      },
      binders: [],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 0 });

    await startSync('user-1');
    expect(useCollectionStore.getState().cards).toHaveLength(1);

    await useCollectionStore.getState().clearCards();
    await new Promise((r) => setTimeout(r, 50));

    // The intentional deletion DID push (collection: null), unblocked by the
    // destructive latch.
    expect(putSpy).toHaveBeenCalled();
    const last = putSpy.mock.calls.at(-1)![0];
    expect(last.collection).toBeNull();
  });
});

describe('failed cache hydrate (IndexedDB unreadable: iOS cold-start / quota / private mode)', () => {
  it('never pushes collection: null and recovers from the server when the cache cannot be read', async () => {
    // IndexedDB has the user's collection, but the read THROWS (not returns
    // null) — the unguarded #153-class hole. The store stays empty for the
    // wrong reason; it must not drive a destructive reconcile.
    await saveCollection({
      fileName: 'mine.csv',
      cards: [{ copyId: 'c1', name: 'Lightning Bolt' } as never],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 100,
      importHistory: [],
    });
    // A stale dirty flag survived from a pre-background import.
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    vi.spyOn(localCards, 'loadCollection').mockRejectedValue(
      new Error('Could not load your saved collection.')
    );
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 100 });
    // Server is the source of truth and still has the data.
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'mine.csv',
        cards: [{ copyId: 'c1', name: 'Lightning Bolt' } as never],
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 100,
        importHistory: [],
      },
      binders: [],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });

    await startSync('user-1');

    // The destructive collection: null push MUST NOT have happened, even
    // though the dirty flag was set.
    for (const call of putSpy.mock.calls) {
      expect(call[0].collection).not.toBeNull();
    }
    // Recovered from the server.
    expect(useCollectionStore.getState().cards).toHaveLength(1);
    expect(useCollectionStore.getState().fileName).toBe('mine.csv');
  });

  it('does not wipe IndexedDB or push null when both the read fails and the server is empty', async () => {
    await saveCollection({
      fileName: 'mine.csv',
      cards: [{ copyId: 'c1', name: 'Sol Ring' } as never],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 100,
      importHistory: [],
    });
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    const readSpy = vi
      .spyOn(localCards, 'loadCollection')
      .mockRejectedValue(new Error('IndexedDB unavailable'));
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 1, updatedAt: 0 });
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      games: [],
      version: 0,
      updatedAt: 0,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await startSync('user-1');

    // No push at all — a failed hydrate must not let an empty store overwrite
    // the server with collection: null.
    expect(putSpy).not.toHaveBeenCalled();
    // The local IndexedDB copy is left intact so a future boot can recover it.
    readSpy.mockRestore();
    const survived = await loadCollection();
    expect(survived?.cards).toHaveLength(1);
    // The user is told, rather than silently losing data.
    expect(useCollectionStore.getState().error).toMatch(/could not read/i);
  });
});

describe('mutation flow', () => {
  it('destructive mutator triggers immediate push without waiting on the debounce', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [{ id: 'b1', name: 'Will be deleted', createdAt: 1, updatedAt: 1, position: 0 }],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 100 });

    await startSync('user-1');
    expect(useCollectionStore.getState().binders).toHaveLength(1);

    // Delete the binder via the destructive mutator path.
    useCollectionStore.getState().deleteBinder('b1');

    // No timer wait: destructive ops should already have kicked the push.
    await new Promise((r) => setTimeout(r, 50));
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][0]).toMatchObject({ baseVersion: 5, binders: [] });
  });

  it('clearCards triggers immediate push so a fast refresh cannot resurrect the collection', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: {
        fileName: 'mine.csv',
        cards: [{ copyId: 'c1' }] as never,
        scryfallHits: 1,
        scryfallMisses: 0,
        uploadedAt: 1,
        importHistory: [],
      },
      binders: [],
      decks: [],
      games: [],
      version: 5,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 6, updatedAt: 100 });

    await startSync('user-1');
    expect(useCollectionStore.getState().cards).toHaveLength(1);

    await useCollectionStore.getState().clearCards();

    await new Promise((r) => setTimeout(r, 50));
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][0]).toMatchObject({ baseVersion: 5, collection: null });
  });

  it('user mutation during fetch window skips applyServerSnapshot', async () => {
    let resolveFetch: ((v: never) => void) | null = null;
    const fetchPromise = new Promise<never>((resolve) => {
      resolveFetch = resolve as never;
    });
    vi.spyOn(authApi, 'fetchSync').mockReturnValue(fetchPromise as never);
    vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 2, updatedAt: 100 });

    const syncPromise = startSync('user-1');

    // Wait a tick for startSync to reach the fetchSync await.
    await new Promise((r) => setTimeout(r, 10));

    // User mutation during the fetch window.
    useCollectionStore.setState({
      binders: [{ id: 'mine', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    await new Promise((r) => setTimeout(r, 10));

    // Now let the server respond with conflicting state.
    resolveFetch!({
      collection: null,
      binders: [{ id: 'remote', createdAt: 100, updatedAt: 100, position: 0 } as never],
      decks: [],
      games: [],
      version: 9,
      updatedAt: 100,
    } as never);

    await syncPromise;
    await new Promise((r) => setTimeout(r, 50));

    // The server snapshot must NOT have overwritten the user's mutation.
    const binders = useCollectionStore.getState().binders;
    expect(binders).toHaveLength(1);
    expect(binders[0].id).toBe('mine');
  });
});

describe('flushSync', () => {
  it('PUTs the current state with the tracked baseVersion', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      version: 4,
      updatedAt: 0,
    });
    const putSpy = vi.spyOn(authApi, 'putSync').mockResolvedValue({ version: 5, updatedAt: 100 });

    await startSync('user-1');
    useCollectionStore.setState({
      binders: [{ id: 'b9', name: 'New', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    await flushSync();
    await new Promise((r) => setTimeout(r, 50));

    expect(putSpy).toHaveBeenCalled();
    const firstCall = putSpy.mock.calls[0][0];
    expect(firstCall).toMatchObject({ baseVersion: 4 });
    expect(firstCall.binders).toEqual([expect.objectContaining({ id: 'b9', name: 'New' })]);
  });

  it('on 409 conflict, re-bases on the server version and retries with local state', async () => {
    vi.spyOn(authApi, 'fetchSync').mockResolvedValue({
      collection: null,
      binders: [],
      decks: [],
      version: 0,
      updatedAt: 0,
    });
    const conflictErr = Object.assign(new Error('conflict'), {
      status: 409,
      current: {
        collection: null,
        binders: [{ id: 'remote', createdAt: 100, updatedAt: 100, position: 0 } as never],
        decks: [],
        version: 7,
        updatedAt: 100,
      },
    });
    const putSpy = vi
      .spyOn(authApi, 'putSync')
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({ version: 8, updatedAt: 200 });

    await startSync('user-1');
    markDestructive();
    useCollectionStore.setState({
      binders: [{ id: 'local', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    await flushSync();
    // Allow retry kicked off after the 409 to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy.mock.calls[1][0].baseVersion).toBe(7);
    expect(putSpy.mock.calls[1][0].binders).toEqual([expect.objectContaining({ id: 'local' })]);
  });
});

describe('stopSyncAndWipeLocal', () => {
  it('clears stores and removes localStorage entries', async () => {
    localStorage.setItem('spellcontrol', '{"binders":[]}');
    localStorage.setItem('mtg-decks', '{"decks":[]}');
    localStorage.setItem('spellcontrol-sync-meta', '{}');
    localStorage.setItem('spellcontrol-sync-dirty', '1');
    localStorage.setItem('spellcontrol-sync-owner', 'user-1');
    localStorage.setItem('spellcontrol-sync-base-version', '5');
    useCollectionStore.setState({
      binders: [{ id: 'x', name: 'leftover', createdAt: 1, updatedAt: 1, position: 0 } as never],
    });
    useDecksStore.setState({ decks: [{ id: 'y' }] as never });

    await stopSyncAndWipeLocal();

    expect(useCollectionStore.getState().binders).toEqual([]);
    expect(useDecksStore.getState().decks).toEqual([]);
    expect(localStorage.getItem('spellcontrol')).toBeNull();
    expect(localStorage.getItem('mtg-decks')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-meta')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-dirty')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-owner')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-base-version')).toBeNull();
  });
});
